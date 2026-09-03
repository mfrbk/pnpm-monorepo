/**
 * ==============================================================================
 * 4. 服务层 (Service)
 *
 * DataLoaderService：按 item id 管理活跃任务的门面。
 * - load() 负责「同批内去重」与「对活跃任务取消后替换」。
 * - 已完成的任务会保留在 activeTasks 中以便后续手动重试，随下一次 load()/destroy() 回收。
 *
 * 类型约定：
 * - TData / TInfo 只在 load() 调用处以显式泛型给出，TData 描述该条目各子接口数据
 *   拼成的形状；activeTasks 只登记与形状无关的 TaskHandle，不做类型擦除。
 * ==============================================================================
 */

import { BatchProcessor } from './batch'
import { MultiApiTask } from './task'
import type { ApiRequestConfig, DataItemViewModel, SubApiData, TaskHandle } from './types'

interface LoadItem<TInfo> {
  id: string | number
  info: TInfo
}

export class DataLoaderService {
  private readonly processor: BatchProcessor
  // 活跃任务以 Item ID 为键；此处只需 TaskHandle，不必持有各任务的类型参数
  private readonly activeTasks: Map<string | number, TaskHandle> = new Map()

  constructor(concurrency: number = 5) {
    this.processor = new BatchProcessor(concurrency)
  }

  /**
   * 加载/刷新一批数据
   * @param list          列表数据
   * @param configFactory 根据单条 info 生成该条目的子接口配置
   * @param onUpdate      单条数据每次状态变化（含逐子接口结算）的回调
   * @typeParam TData    该条目所有子接口数据拼成的形状（configFactory 里使用的 key 需包含在 TData 中）
   * @typeParam TInfo    业务载荷类型
   */
  public load<TData extends object, TInfo>(
    list: LoadItem<TInfo>[],
    configFactory: (info: TInfo) => ApiRequestConfig<SubApiData<TData>, TInfo>[],
    onUpdate: (vm: DataItemViewModel<TData, TInfo>) => void,
  ): void {
    // 1. 同一批内按 id 去重（后者覆盖前者）：重复 id 只允许创建一个任务，
    //    否则同一 id 会跑多个任务并向 UI 重复通知。
    const unique = new Map<string | number, LoadItem<TInfo>>()
    list.forEach((item) => unique.set(item.id, item))

    const tasks: TaskHandle[] = []
    unique.forEach((item) => {
      // 2. 若该 id 已有任务在加载中，先取消并移除旧任务，避免资源浪费与数据竞态
      const existing = this.activeTasks.get(item.id)
      if (existing) {
        existing.cancel()
        this.activeTasks.delete(item.id)
      }

      // 3. 创建新任务并登记（实现 TaskHandle，可同时放入队列与注册表）
      const task = new MultiApiTask<TData, TInfo>(
        item.id,
        item.info,
        configFactory(item.info),
        onUpdate,
      )
      this.activeTasks.set(item.id, task)
      tasks.push(task)
    })

    // 4. 提交给处理器执行
    this.processor.addTasks(tasks)
  }

  /**
   * 手动重试某个子接口（fire-and-forget）
   */
  public retrySubApi(itemId: string | number, apiKey: string): void {
    const task = this.activeTasks.get(itemId)
    if (task) {
      task.retrySubApi(apiKey)
    }
  }

  /**
   * 销毁服务，取消所有请求
   */
  public destroy(): void {
    this.processor.clearAll()
    this.activeTasks.clear()
  }
}
