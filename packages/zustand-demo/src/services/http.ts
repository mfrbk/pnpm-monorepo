/**
 * 传输层(fetch 模拟):统一延迟、自动注入 token、集中处理 401。
 *
 * #8 Store 外部调用示范:这里不在 React 组件内,因此不能用 useAuthStore(),
 * 而是经 app/session.ts 的 getSessionToken() / clearSessionState() 读写会话——
 * Axios/WebSocket/事件监听等非 React 环境同理,不依赖具体 feature。
 *
 * 注:真实项目里 token 一般经「适配器」注入(见 @mzy1120/http 的反馈适配器),
 * demo 集中走 app/session 以保持代码最短。
 */
import { serverRoute } from '../mock/db'
import { clearSessionState, getSessionToken } from '../app/session'

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  /** 该请求是否需要已登录;登录接口传 false,避免 401 误触发登出 */
  auth?: boolean
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options
  const token = auth ? (getSessionToken() ?? undefined) : undefined

  try {
    const data = await serverRoute(path, { method, body, token })
    return data as T
  } catch (error) {
    const status = (error as { status?: number }).status ?? 0
    if (auth && status === 401) {
      // 传输层统一兜底:登出并复位业务 store(具体复位哪些见 app/session.ts)
      clearSessionState()
    }
    throw error
  }
}
