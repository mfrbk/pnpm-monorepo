import axios from 'axios'

/** HTTP 状态码 → 默认提示文案 */
export const HTTP_STATUS_TEXT: Readonly<Record<number, string>> = {
  400: '请求参数错误 (400)',
  401: '未授权,请重新登录 (401)',
  403: '拒绝访问 (403)',
  404: '请求资源不存在 (404)',
  408: '请求超时 (408)',
  500: '服务器内部错误 (500)',
  502: '网关错误 (502)',
  503: '服务不可用 (503)',
  504: '网关超时 (504)',
}

/**
 * 业务层错误:信封解包失败时抛出,携带业务码 / 原始 body 供上层细粒度处理。
 */
export class BizError<T = unknown> extends Error {
  override readonly name = 'BizError'

  /** 业务码(如 401 / 50001) */
  code: number
  /** 触发时的 HTTP 状态码(若有) */
  httpStatus?: number
  /** 后端返回的原始 body(含 data,便于降级使用) */
  data: T
  /** 是否未授权(命中 unauthorizedCodes) */
  unauthorized: boolean

  constructor(
    code: number,
    message: string,
    options?: { httpStatus?: number; data?: T; unauthorized?: boolean },
  ) {
    super(message)
    this.code = code
    this.httpStatus = options?.httpStatus
    this.data = options?.data as T
    this.unauthorized = options?.unauthorized ?? false
    Object.setPrototypeOf(this, BizError.prototype)
  }
}

/** 判断错误是否为业务层错误(BizError) */
export function isBizError<T = unknown>(value: unknown): value is BizError<T> {
  return value instanceof BizError
}

/** 判断是否为主动取消的请求(axios CanceledError) */
export function isAxiosCancel(value: unknown): boolean {
  return axios.isCancel(value)
}

/** 归一化后的错误信息 */
export interface ErrorInfo {
  /** 是否主动取消(取消不应弹出错误提示) */
  canceled: boolean
  /** 可展示的错误文案 */
  message: string
  /** HTTP 状态码(若有) */
  httpStatus?: number
}

/**
 * 把网络层(传输 / 超时 / 取消)错误归一化为可读文案。
 * 区分:HTTP 状态码、超时、网络断开、主动取消、其它兜底。
 */
export function resolveHttpError(error: unknown): ErrorInfo {
  // 主动取消(手动 abort / dedupe / 并发熔断):静默,不提示
  if (axios.isCancel(error)) return { canceled: true, message: '请求已取消' }

  // axios 层错误:优先按 HTTP 状态码取文案
  if (axios.isAxiosError(error)) {
    const httpStatus = error.response?.status
    if (httpStatus) {
      return {
        canceled: false,
        message: HTTP_STATUS_TEXT[httpStatus] ?? `连接错误 (${httpStatus})`,
        httpStatus,
      }
    }
    const raw = error.message ?? ''
    if (raw.includes('timeout') || error.code === 'ECONNABORTED') {
      return { canceled: false, message: '请求超时,请检查网络' }
    }
    if (raw.includes('Network Error'))
      return { canceled: false, message: '网络连接异常,请检查网络' }
    return { canceled: false, message: raw || '请求失败' }
  }

  // 其它未知错误(非 axios):直接暴露 message
  if (error instanceof Error) return { canceled: false, message: error.message || '请求失败' }
  return { canceled: false, message: '请求失败' }
}
