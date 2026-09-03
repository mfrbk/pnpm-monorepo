/**
 * ==============================================================================
 * 2. 核心任务类 (Task)
 *
 * MultiApiTask：编排单条数据的多个子接口，维护细粒度 subStates，
 * 支持整体取消与「按子接口」手动重试。
 *
 * 设计约定：
 * - 任务状态机 PENDING -> RUNNING -> (SUCCESS | PARTIAL_SUCCESS | ERROR)，任意时刻可
 *   cancel() 进入 CANCELLED（终态、静默）。终态任务可对失败子接口 retrySubApi 回到 RUNNING。
 * - 「每个子接口结算后立即通知一次 UI」，从而支撑细粒度进度展示。
 * - 任务内部的所有子接口一并并发发起，不受并发上限约束（上限由 BatchProcessor 管「任务」）；
 *   inFlight 只用于防同 key 重复执行，不是并发限制器。
 *
 * 类型约定：
 * - TData 由调用方声明「该条目所有子接口返回数据拼成的形状」；数据聚合存储时为承接
 *   多个类型不同的子接口结果，统一收敛到 SubApiData<TData>，不引入宽泛的顶层逃逸类型。
 * ==============================================================================
 */

import { SubApiStatus, TaskStatus } from './types'
import type {
  ApiRequestConfig,
  DataItemViewModel,
  SubApiData,
  SubApiState,
  TaskHandle,
} from './types'

export class MultiApiTask<TData extends object, TInfo> implements TaskHandle {
  public readonly id: string | number
  private readonly info: TInfo
  private readonly configs: Map<string, ApiRequestConfig<SubApiData<TData>, TInfo>>

  // 每个子接口的运行状态快照，键为该子接口 key；
  // 多个子接口返回值类型不同，统一以 SubApiData<TData>（各 key 类型之联合）承接
  private subStates: Record<string, SubApiState<SubApiData<TData>>> = {}
  // 任务级取消控制器：cancel() 时 abort，signal 透传给每个 fetcher
  private abortController: AbortController | null = null
  // 整条任务的状态机（见 TaskStatus），由 recomputeStatus() 依据 subStates 推导
  private status: TaskStatus = TaskStatus.PENDING
  // 0-100，已完成（成功 + 失败）的子接口占比，随每次结算更新
  private progress: number = 0

  // 回调
  private readonly onUpdate?: (vm: DataItemViewModel<TData, TInfo>) => void

  // 正在执行中的子接口 key，防止同 key 重复并发执行
  private readonly inFlight: Set<string> = new Set()

  constructor(
    id: string | number,
    info: TInfo,
    configs: ReadonlyArray<ApiRequestConfig<SubApiData<TData>, TInfo>>,
    onUpdate?: (vm: DataItemViewModel<TData, TInfo>) => void,
  ) {
    this.id = id
    this.info = info
    this.onUpdate = onUpdate

    // 初始化配置和状态
    this.configs = new Map()
    configs.forEach((cfg) => {
      this.configs.set(cfg.key, cfg)
      this.subStates[cfg.key] = {
        key: cfg.key,
        status: SubApiStatus.PENDING,
        retryCount: 0,
        lastUpdated: Date.now(),
      }
    })
  }

  /**
   * 启动所有请求。仅允许从 PENDING 启动：可防止重复 start()，也禁止对已完成任务整任务重启
   * （恢复/重试请走 retrySubApi）。
   */
  public async start(): Promise<void> {
    if (this.status !== TaskStatus.PENDING) return

    this.status = TaskStatus.RUNNING
    this.abortController = new AbortController()
    this.notifyUpdate()

    const runs = Array.from(this.configs.values()).map((config) => this.runSubApi(config))
    await Promise.allSettled(runs)

    // 空配置任务没有子请求会触发逐子结算，这里收尾到终态；
    // 非空任务的终态已由最后一个结算的子请求通知。
    if (this.configs.size === 0) {
      this.recomputeStatus()
      if (!this.isCancelled()) this.notifyUpdate()
    }
  }

  private isCancelled(): boolean {
    return this.status === TaskStatus.CANCELLED
  }

  /**
   * 取消当前任务的所有进行中的请求。
   * 故意不通知 UI：避免与 DataLoaderService「同 id 取消后立刻替换新任务」产生的
   * RUNNING 通知互相覆盖造成闪烁，UI 会由新任务的状态刷回。
   */
  public cancel(): void {
    this.abortController?.abort('Task Cancelled')
    this.abortController = null
    this.status = TaskStatus.CANCELLED
  }

  /**
   * 单独重试某个子接口（手动触发）。
   * 未启动(PENDING)、已取消(CANCELLED)或该 key 正在请求中时均为安全的 no-op。
   */
  public async retrySubApi(key: string): Promise<void> {
    const config = this.configs.get(key)
    if (!config) return
    // 任务从未启动或已取消 → 不允许多次/复活
    if (this.status === TaskStatus.PENDING || this.status === TaskStatus.CANCELLED) return
    // 该子接口仍在请求中 → 忽略本次重试，避免同 key 并发重复执行
    if (this.inFlight.has(key)) return

    // 重置该子接口状态
    this.subStates[key] = {
      ...this.subStates[key],
      status: SubApiStatus.PENDING,
      error: undefined,
      retryCount: this.subStates[key].retryCount + 1,
      lastUpdated: Date.now(),
    }
    // 无条件回到 RUNNING：进度与状态由 recomputeStatus 统一推导
    this.status = TaskStatus.RUNNING
    this.recomputeStatus()
    this.notifyUpdate()

    await this.runSubApi(config)
  }

  /**
   * 执行单个子接口：登记 inFlight -> 请求 -> 结算（成功/失败）-> 逐子通知 UI。
   */
  private async runSubApi(config: ApiRequestConfig<SubApiData<TData>, TInfo>): Promise<void> {
    const { key } = config
    // 防御性双保险
    if (this.inFlight.has(key)) return

    // 同步登记，必须在任何 await 之前，防止同 key 并发穿透
    this.inFlight.add(key)
    try {
      try {
        const data = await config.fetcher(this.info, this.abortController?.signal)
        this.subStates[key] = {
          key,
          status: SubApiStatus.SUCCESS,
          data,
          retryCount: this.subStates[key].retryCount,
          lastUpdated: Date.now(),
        }
      } catch (err) {
        // 仅当我们自己 cancel() 时任务才会进入 CANCELLED：此时子请求因取消而终止，
        // 保持其原状态（不写 ERROR、不通知），由任务整体维持 CANCELLED。
        // 注：cancel() 会先把 abortController 置空，故此处依据任务状态而非 signal 判断。
        if (this.status === TaskStatus.CANCELLED) return

        this.subStates[key] = {
          key,
          status: SubApiStatus.ERROR,
          error: err instanceof Error ? err.message : String(err),
          retryCount: this.subStates[key].retryCount,
          lastUpdated: Date.now(),
        }
      }

      // 结算可能恰好落在 cancel() 之后：此后一律不再写状态/通知
      if (this.status === TaskStatus.CANCELLED) return

      this.recomputeStatus()
      this.notifyUpdate() // 每个子接口完成即上抛一次，UI 可逐个子接口刷新
    } finally {
      this.inFlight.delete(key)
    }
  }

  /**
   * 依据当前所有子接口的状态推导整体 status 与 progress。
   * 会随每次子接口结算被调用（不再只是「最终」状态），故更名为 recompute。
   */
  private recomputeStatus(): void {
    // 已被取消的任务状态不可被覆盖
    if (this.status === TaskStatus.CANCELLED) return

    const states = Object.values(this.subStates)
    const total = states.length
    if (total === 0) {
      this.status = TaskStatus.SUCCESS
      this.progress = 100
      return
    }

    const successCount = states.filter((state) => state.status === SubApiStatus.SUCCESS).length
    const errorCount = states.filter((state) => state.status === SubApiStatus.ERROR).length
    // 含仍在请求中的（PENDING）以及被取消前残留的 pending
    const pendingCount = total - successCount - errorCount

    this.progress = Math.round(((successCount + errorCount) / total) * 100)

    if (pendingCount > 0) {
      this.status = TaskStatus.RUNNING
    } else if (errorCount === 0) {
      this.status = TaskStatus.SUCCESS
    } else if (successCount === 0) {
      this.status = TaskStatus.ERROR
    } else {
      this.status = TaskStatus.PARTIAL_SUCCESS
    }
  }

  private notifyUpdate(): void {
    if (!this.onUpdate) return

    // 把成功的子接口数据按 key 收敛进 TData 形状。
    // TData 的键通常是具名字面量，无法用 string 直接索引，因此先写入可索引的中间
    // 形态（值均为 SubApiData 成员，Partial<TData> 可赋值于它），再转回 Partial<TData>。
    const merged: Record<string, SubApiData<TData>> = {}
    Object.values(this.subStates).forEach((state) => {
      if (state.status === SubApiStatus.SUCCESS && state.data !== undefined) {
        merged[state.key] = state.data
      }
    })
    const data = merged as Partial<TData>

    this.onUpdate({
      id: this.id,
      info: this.info,
      status: this.status,
      progress: this.progress,
      subStates: { ...this.subStates }, // 浅拷贝，防止外部修改
      data,
    })
  }
}
