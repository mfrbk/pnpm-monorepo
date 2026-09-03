import axios from 'axios'
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import type { ClientState, InterceptorDeps } from './interceptors'
import { buildRequestInterceptor, buildResponseInterceptor } from './interceptors'
import { createLoadingController, FeedbackStore } from './feedback'
import { PendingManager } from './pending'
import { generateRequestKey } from './key'
import { resolveEnvelopeConfig } from './envelope'
import type { HttpClient, HttpClientOptions, HttpRequestConfig, UploadConfig } from './types'

/** 默认 baseURL 前缀(可经 options.baseURL 覆盖) */
const DEFAULT_BASE_URL = '/api'
/** 默认超时(ms) */
const DEFAULT_TIMEOUT = 15000
/** 默认 JSON 请求头 */
const DEFAULT_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json;charset=UTF-8',
}
/** configure() 允许在运行时覆盖的 axios 默认值 */
const RUNTIME_AXIOS_KEYS = [
  'baseURL',
  'timeout',
  'withCredentials',
  'responseType',
  'params',
] as const

/** upload 专用配置(field / filename 为库内字段,其余透传 axios) */
type UploadConfigParam = UploadConfig

/**
 * 创建一个独立的请求客户端。
 *
 * 宿主 app 接入 UI 反馈(以 antd 为例,ElementPlus 同理):
 * ```ts
 * const http = createHttpClient({ baseURL: '/api' })
 * http.setFeedback({
 *   message: { error: (t) => message.error(t), success: (t) => message.success(t) },
 *   loading: { show: () => loading.show(), hide: () => loading.hide() },
 *   getToken: () => localStorage.getItem('access_token'),
 *   onUnauthorized: () => { location.href = '/login' },
 * })
 * ```
 */
export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const { dedupe, showLoading, envelope, feedback, auth, ...axiosLike } = options

  // 可变运行态:configure() 更新,拦截器每次读取最新值
  const state: ClientState = {
    dedupe: dedupe ?? false,
    showLoading: showLoading ?? true,
    envelope: resolveEnvelopeConfig(envelope),
    auth: {
      headerName: auth?.headerName ?? 'Authorization',
      scheme: auth?.scheme ?? 'Bearer ',
    },
  }

  const feedbackStore = new FeedbackStore(feedback)
  const loading = createLoadingController(feedbackStore)
  const pending = new PendingManager()

  const instance = axios.create({
    ...axiosLike,
    baseURL: axiosLike.baseURL ?? DEFAULT_BASE_URL,
    timeout: axiosLike.timeout ?? DEFAULT_TIMEOUT,
    headers: { ...DEFAULT_HEADERS, ...(axiosLike.headers as unknown as Record<string, unknown>) },
  })

  // 在途登记:以 config 对象身份记录,释放时校验控制器身份,避免误删接替者
  const tracked = new WeakMap<object, { key: string; controller: AbortController }>()
  const trackPending = (config: InternalAxiosRequestConfig): void => {
    // 外部已给 signal(调用方 / 并发熔断共享信号):本库不接管取消权
    if (config.signal) return
    const cfg = config as HttpRequestConfig
    const key = generateRequestKey(cfg)
    const controller = pending.acquire(key, { dedupe: cfg.dedupe ?? state.dedupe })
    if (!controller) return // 在途重复且未开 dedupe:放行但不重复登记
    config.signal = controller.signal
    tracked.set(config, { key, controller })
  }
  const untrackPending = (config: InternalAxiosRequestConfig): void => {
    const entry = tracked.get(config)
    if (!entry) return
    tracked.delete(config)
    pending.release(entry.key, entry.controller)
  }

  const deps: InterceptorDeps = {
    state,
    feedback: feedbackStore,
    loading,
    trackPending,
    untrackPending,
  }

  instance.interceptors.request.use(buildRequestInterceptor(deps))
  const { handleSuccess, handleError } = buildResponseInterceptor(deps)
  instance.interceptors.response.use(
    (response: AxiosResponse) => handleSuccess(response) as unknown as AxiosResponse,
    (error: unknown) => handleError(error),
  )

  /** 统一入口:拦截器链解包后,Promise 直接 resolve 业务数据 */
  const send = <T>(config: HttpRequestConfig): Promise<T> =>
    instance.request(config) as unknown as Promise<T>

  const client: HttpClient = {
    get instance() {
      return instance
    },

    request: <T>(config: HttpRequestConfig): Promise<T> => send<T>(config),

    get: <T>(url: string, params?: object, config?: HttpRequestConfig): Promise<T> =>
      send<T>({ method: 'get', url, params, ...config }),

    post: <T>(url: string, data?: unknown, config?: HttpRequestConfig): Promise<T> =>
      send<T>({ method: 'post', url, data, ...config }),

    put: <T>(url: string, data?: unknown, config?: HttpRequestConfig): Promise<T> =>
      send<T>({ method: 'put', url, data, ...config }),

    patch: <T>(url: string, data?: unknown, config?: HttpRequestConfig): Promise<T> =>
      send<T>({ method: 'patch', url, data, ...config }),

    delete: <T>(url: string, params?: object, config?: HttpRequestConfig): Promise<T> =>
      send<T>({ method: 'delete', url, params, ...config }),

    upload: <T>(url: string, file: Blob, config?: UploadConfigParam): Promise<T> => {
      const {
        field = 'file',
        filename = typeof File !== 'undefined' && file instanceof File ? file.name : undefined,
        ...rest
      } = config ?? {}
      const form = new FormData()
      form.append(field, file, filename)
      return send<T>({ method: 'post', url, data: form, ...rest })
    },

    download: (url: string, params?: object, config?: HttpRequestConfig): Promise<Blob> =>
      send<Blob>({ method: 'get', url, params, responseType: 'blob', ...config }),

    all: async <T>(requests: Array<HttpRequestConfig>): Promise<T[]> => {
      // 并发熔断:全部共享同一 signal,任一失败即取消其余并 reject
      const controller = new AbortController()
      const attempts = requests.map((cfg) => send<T>({ ...cfg, signal: controller.signal }))
      try {
        return await Promise.all(attempts)
      } catch (error) {
        controller.abort()
        throw error
      }
    },

    abortAll: (reason?: string) => pending.abortAll(reason),

    setFeedback: (partial) => feedbackStore.set(partial),

    configure: (partial: Partial<HttpClientOptions>) => {
      const {
        dedupe: nextDedupe,
        showLoading: nextShow,
        envelope: nextEnvelope,
        feedback: nextFeedback,
        auth: nextAuth,
        ...rest
      } = partial
      if (nextDedupe !== undefined) state.dedupe = nextDedupe
      if (nextShow !== undefined) state.showLoading = nextShow
      if (nextEnvelope !== undefined) state.envelope = resolveEnvelopeConfig(nextEnvelope)
      if (nextAuth) {
        state.auth = {
          headerName: nextAuth.headerName ?? state.auth.headerName,
          scheme: nextAuth.scheme ?? state.auth.scheme,
        }
      }
      if (nextFeedback) feedbackStore.set(nextFeedback)
      for (const key of RUNTIME_AXIOS_KEYS) {
        const value = (rest as Partial<Record<(typeof RUNTIME_AXIOS_KEYS)[number], unknown>>)[key]
        if (value !== undefined) {
          ;(instance.defaults as unknown as Record<string, unknown>)[key] = value
        }
      }
    },
  }

  return client
}
