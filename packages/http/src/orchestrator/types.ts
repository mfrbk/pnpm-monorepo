/**
 * ==============================================================================
 * 1. 基础类型定义 (Types)
 *
 * 仅承载纯类型与枚举，不依赖任何业务模块。
 * 外部统一从 `@mfr/http` 引用，无需感知这里。
 *
 * 类型约定：本模块不引入宽泛的顶层逃逸类型。各子接口的返回值由调用方声明的
 * 「数据形状」泛型 TData 描述，聚合存储需要承接多个子接口结果时收敛到
 * SubApiData<TData>（各 key 返回类型之联合），键一律保持运行时 string。
 * ==============================================================================
 */

/**
 * 单个子接口的状态
 */
export enum SubApiStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  ERROR = 'error',
}

/**
 * 单条数据整体任务的状态机
 */
export enum TaskStatus {
  PENDING,
  RUNNING,
  PARTIAL_SUCCESS,
  SUCCESS,
  ERROR,
  CANCELLED,
}

/**
 * 一条数据所有子接口成功返回值的可能类型：即 TData 各 key 值类型的联合。
 *
 * TData 由调用方声明：每个 key 对应一个子接口名，value 为该子接口成功后的数据
 * （可含任意个 key，运行时的 configFactory 只取其中一部分）。
 * 多个子接口聚合存储时，彼此类型不同、键为运行时 string，无法静态到逐 key，
 * 故用一个可索引的「联合类型」承接，而不是退回宽泛的顶层类型。
 * @typeParam TData - 调用方给出的数据形状
 */
export type SubApiData<TData extends object> = TData[keyof TData]

/**
 * 单个子接口的配置
 * @typeParam TResult - 该子接口返回的数据类型（由调用方声明；聚合处收敛为 SubApiData<TData>）
 * @typeParam TInfo   - 业务载荷类型（由上层 `info` 传入并透传给每个 fetcher）
 */
export interface ApiRequestConfig<TResult, TInfo> {
  key: string
  /** 执行单个子请求；需响应第二个参数 signal，以支持任务整体取消 */
  fetcher: (info: TInfo, signal?: AbortSignal) => Promise<TResult>
}

/**
 * 子接口运行时的状态快照
 * @typeParam TResult - 该子接口成功后的数据
 */
export interface SubApiState<TResult> {
  key: string
  status: SubApiStatus
  data?: TResult
  error?: string
  /** 手动重试次数 */
  retryCount: number
  lastUpdated: number
}

/**
 * 暴露给 UI 的完整数据项视图
 * @typeParam TData - 各子接口数据合并后的形状（键即 config.key），供渲染直接取用
 * @typeParam TInfo - 业务载荷类型，原样回传
 */
export interface DataItemViewModel<TData extends object, TInfo> {
  id: string | number
  info: TInfo
  status: TaskStatus
  /** 0-100，已完成（成功 + 失败）的子接口占比 */
  progress: number
  /** 细粒度状态：每个子接口一份（数值收敛为 SubApiData<TData>，读取推荐走 data 字段） */
  subStates: Record<string, SubApiState<SubApiData<TData>>>
  /** 仅包含成功的数据，键为子接口名，可直接按 key 读取精确类型 */
  data: Partial<TData>
}

/**
 * 与数据形状无关的任务最小视图。
 *
 * BatchProcessor / DataLoaderService 只需持有该接口即可 start / cancel /
 * retrySubApi，不必为了容纳「多种泛型实例」而擦除 MultiApiTask 的类型参数。
 */
export interface TaskHandle {
  readonly id: string | number
  start(): Promise<void>
  cancel(): void
  retrySubApi(key: string): Promise<void>
}
