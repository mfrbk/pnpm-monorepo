import type { AxiosInstance, AxiosRequestConfig } from 'axios'

/**
 * 后端统一业务信封(可按 EnvelopeConfig 自定义字段名)。
 *
 * 形如 `{ code: 200, message: 'success', data: ... }`。
 */
export interface BizResult<T = unknown> {
  code: number
  message: string
  data: T
  [key: string]: unknown
}

/**
 * 业务信封解析配置。
 * 默认后端约定:`{ code, message, data }`,code === 200 视为成功。
 */
export interface EnvelopeConfig {
  /** 是否启用业务信封解包;为 false 时直接把响应体原样返回 */
  enabled?: boolean
  /** 业务码字段名,默认 `code` */
  codeKey?: string
  /** 提示信息字段名,默认 `message` */
  messageKey?: string
  /** 业务数据字段名,默认 `data` */
  dataKey?: string
  /** 视为成功的业务码集合,默认 `[200]` */
  successCodes?: number[]
  /** 触发 onUnauthorized 回调的业务码集合,默认 `[401]` */
  unauthorizedCodes?: number[]
}

/** 归一化后的信封配置(运行时必填项已补齐) */
export type ResolvedEnvelope = Required<EnvelopeConfig>

/**
 * 单次请求配置 = axios 配置 + @mfr/http 私有开关。
 * hideLoading / dedupe 仅用于本库拦截器,axios 会忽略未知字段。
 */
export interface HttpRequestConfig<D = unknown> extends AxiosRequestConfig<D> {
  /** 关闭本次请求的全局 loading(默认展示,配合客户端 showLoading 使用) */
  hideLoading?: boolean
  /** 开启本次请求防重复:同 key 在途时取消旧请求并重新发起;缺省继承客户端 dedupe */
  dedupe?: boolean
}

/** 文件上传配置:在 HttpRequestConfig 基础上补充 form 字段信息 */
export interface UploadConfig<D = unknown> extends HttpRequestConfig<D> {
  /** formData 字段名,默认 `file` */
  field?: string
  /** 上传文件名,默认取 file.name(普通 Blob 无 name 时可不传) */
  filename?: string
}

/**
 * 全局反馈适配器(注入而非内置,保持零 UI 依赖)。
 *
 * 宿主 app 接入示例(antd):
 * ```ts
 * http.setFeedback({
 *   message: { error: (t) => message.error(t), ... },
 *   loading: { show: () => loading.show(), hide: () => loading.hide() },
 *   getToken: () => localStorage.getItem('access_token'),
 *   onUnauthorized: () => { /* 登出并跳转登录页 *\/ },
 * })
 * ```
 */
export interface Feedback {
  /** 消息提示(错误必用;缺省时 error 兜底 console.error,不静默吞错) */
  message?: {
    error?: (content: string) => void
    success?: (content: string) => void
    info?: (content: string) => void
    warning?: (content: string) => void
  }
  /** 全局 loading(内部做引用计数,支持嵌套请求) */
  loading?: {
    show?: (content?: string) => void
    hide?: () => void
  }
  /** 获取请求头中的 token;返回空则跳过注入 */
  getToken?: () => string | null | undefined
  /** 未授权回调(HTTP 401 或业务码命中 unauthorizedCodes),通常用于登出/跳登录 */
  onUnauthorized?: (detail: UnauthorizedDetail) => void
}

/** 未授权触发来源 */
export interface UnauthorizedDetail {
  /** http:HTTP 状态码 401;biz:业务码命中 unauthorizedCodes */
  source: 'http' | 'biz'
  /** HTTP 状态码(若有) */
  httpStatus?: number
  /** 业务码(若有) */
  code?: number
}

/** Authorization 注入定制 */
export interface AuthConfig {
  /** 请求头名称,默认 `Authorization` */
  headerName?: string
  /** token 前缀,默认 `Bearer ` */
  scheme?: string
}

/**
 * 创建客户端时的总配置。
 * 除下方专有开关外,其余字段为 axios 创建参数(baseURL/timeout/headers/...)。
 * 注:axios 原生 `auth`(basic)与本库 `auth`(Authorization 注入)同名冲突,已从父类型剔除,
 * 需要 basic auth 时请在单次请求 config 中传入。
 */
export interface HttpClientOptions extends Omit<AxiosRequestConfig, 'auth'> {
  /** 全局默认是否防重复,单次请求可传 config.dedupe 覆盖;默认 false */
  dedupe?: boolean
  /** 全局默认是否展示 loading,单次请求可传 config.hideLoading 覆盖;默认 true */
  showLoading?: boolean
  /** 业务信封配置;传 false 关闭解包 */
  envelope?: EnvelopeConfig | false
  /** 初始反馈适配器 */
  feedback?: Feedback
  /** Authorization 注入定制 */
  auth?: AuthConfig
}

/**
 * 客户端暴露的 RESTful 语义化接口。
 * 泛型 T 指向「信封解包后」的业务数据,即后端实际载荷。
 */
export interface HttpClient {
  /** 底层 axios 实例(保留用于极端定制) */
  readonly instance: AxiosInstance

  /** 发起任意请求(兼容 axios 底层能力) */
  request<T = unknown>(config: HttpRequestConfig): Promise<T>

  /** GET:获取资源,如 `http.get<User>('/users/123')` */
  get<T = unknown>(url: string, params?: object, config?: HttpRequestConfig): Promise<T>

  /** POST:创建资源 */
  post<T = unknown>(url: string, data?: unknown, config?: HttpRequestConfig): Promise<T>

  /** PUT:全量更新资源 */
  put<T = unknown>(url: string, data?: unknown, config?: HttpRequestConfig): Promise<T>

  /** PATCH:部分更新资源 */
  patch<T = unknown>(url: string, data?: unknown, config?: HttpRequestConfig): Promise<T>

  /** DELETE:删除资源 */
  delete<T = unknown>(url: string, params?: object, config?: HttpRequestConfig): Promise<T>

  /** multipart/form-data 上传(axios 自动补 boundary,无需手设 Content-Type) */
  upload<T = unknown>(url: string, file: Blob, config?: UploadConfig): Promise<T>

  /** 文件下载:responseType 固定为 blob,返回 Blob 由调用方落盘 */
  download(url: string, params?: object, config?: HttpRequestConfig): Promise<Blob>

  /** 并发熔断:同一信号发起多个请求,任一失败则取消其余全部并 reject */
  all<T = unknown>(requests: Array<HttpRequestConfig>): Promise<T[]>

  /** 取消客户端当前所有在途请求(仅取消通过本客户端登记过的请求) */
  abortAll(reason?: string): void

  /** 覆盖反馈适配器(与 createHttpClient 的 feedback 深浅合并) */
  setFeedback(feedback: Feedback): void

  /**
   * 运行时更新客户端配置:信封 / 防重复 / loading 开关 / auth / feedback,
   * 以及 axios 层最常用的 baseURL / timeout / withCredentials / responseType / params。
   */
  configure(options: Partial<HttpClientOptions>): void
}
