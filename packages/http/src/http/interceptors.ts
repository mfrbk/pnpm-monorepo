import axios from 'axios'
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import type { FeedbackStore, LoadingController } from './feedback'
import { notifyError } from './feedback'
import { isRawResponse, unwrapEnvelope } from './envelope'
import { BizError, resolveHttpError } from './error'
import type { AuthConfig, HttpRequestConfig, ResolvedEnvelope } from './types'

/** 客户端可变运行态(configure 时更新,拦截器实时读取) */
export interface ClientState {
  dedupe: boolean
  showLoading: boolean
  envelope: ResolvedEnvelope
  auth: Required<AuthConfig>
}

/** 拦截器运行依赖:由 createHttpClient 装配并注入 */
export interface InterceptorDeps {
  state: ClientState
  feedback: FeedbackStore
  loading: LoadingController
  /** 请求发出前登记在途并绑定 AbortSignal */
  trackPending(config: InternalAxiosRequestConfig): void
  /** 请求结束(成功 / 失败 / 取消)释放在途登记 */
  untrackPending(config: InternalAxiosRequestConfig): void
}

/** GET 等只读请求:若误把 data 放请求体,则并入 params 走 URL 查询串 */
function isPlainData(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  if (typeof FormData !== 'undefined' && value instanceof FormData) return false
  if (typeof Blob !== 'undefined' && value instanceof Blob) return false
  return Object.prototype.toString.call(value) === '[object Object]'
}

function normalizeGet(config: InternalAxiosRequestConfig): void {
  const method = (config.method ?? 'get').toLowerCase()
  if (method !== 'get' || !isPlainData(config.data)) return
  config.params = { ...((config.params ?? {}) as Record<string, unknown>), ...config.data }
  delete config.data
}

/** 注入 Authorization;token 为空 / 未配置 getToken 则跳过 */
function injectAuth(config: InternalAxiosRequestConfig, deps: InterceptorDeps): void {
  const { getToken } = deps.feedback.get()
  if (!getToken) return
  const token = getToken()
  if (!token) return
  const { headerName, scheme } = deps.state.auth
  config.headers.set(headerName, `${scheme}${token}`)
}

function shouldShowLoading(cfg: HttpRequestConfig, deps: InterceptorDeps): boolean {
  return deps.state.showLoading && !cfg.hideLoading
}

export function buildRequestInterceptor(deps: InterceptorDeps) {
  return function requestInterceptor(
    config: InternalAxiosRequestConfig,
  ): InternalAxiosRequestConfig {
    const cfg = config as HttpRequestConfig

    // 1. 注入 Token(可自定义头名 / 前缀)
    injectAuth(config, deps)

    // 2. GET 语义兜底:data 并入 params
    normalizeGet(config)

    // 3. 全局 loading(可 hideLoading 单次关闭;引用计数支持嵌套)
    if (shouldShowLoading(cfg, deps)) deps.loading.show()

    // 4. 登记在途请求(防重复 / 支持统一取消;晚于转换,保证 key 命中最终参数)
    deps.trackPending(config)

    return config
  }
}

export function buildResponseInterceptor(deps: InterceptorDeps) {
  function handleSuccess(response: AxiosResponse): unknown {
    const { config } = response
    const cfg = config as HttpRequestConfig

    deps.untrackPending(config)
    if (shouldShowLoading(cfg, deps)) deps.loading.hide()

    // 二进制 / 文档 / 流等原始响应:不做信封解包,直接返回 body
    if (isRawResponse(cfg)) return response.data

    const result = unwrapEnvelope<unknown>(response.data, deps.state.envelope)
    if (result.ok) return result.data

    // 业务失败:提示 + 401 触发登出回调 + 抛出 BizError
    notifyError(deps.feedback, result.message)
    if (result.unauthorized) {
      deps.feedback
        .get()
        .onUnauthorized?.({ source: 'biz', code: result.code, httpStatus: response.status })
    }
    throw new BizError(result.code, result.message, {
      httpStatus: response.status,
      data: response.data,
      unauthorized: result.unauthorized,
    })
  }

  function handleError(error: unknown): Promise<never> {
    // 网络层(传输 / 超时 / 取消)错误,从 axios error 还原 config 清理登记与 loading
    if (axios.isAxiosError(error) && error.config) {
      const cfg = error.config as HttpRequestConfig
      deps.untrackPending(error.config)
      if (shouldShowLoading(cfg, deps)) deps.loading.hide()
    }

    const info = resolveHttpError(error)
    // 主动取消(dedupe 接替 / abortAll / 并发熔断):静默,不提示
    if (info.canceled) return Promise.reject(error)

    // HTTP 401:触发登出回调后统一提示
    if (info.httpStatus === 401) {
      deps.feedback.get().onUnauthorized?.({ source: 'http', httpStatus: info.httpStatus })
    }
    notifyError(deps.feedback, info.message)
    return Promise.reject(error)
  }

  return { handleSuccess, handleError }
}
