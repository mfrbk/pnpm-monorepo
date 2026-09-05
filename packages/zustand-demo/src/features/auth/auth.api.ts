/**
 * Auth API:只描述「请求-响应」,不含任何 store 写入。
 * 登录成功后写 store 的动作在 auth.hooks.ts 的 useLogin 里完成(业务封装层)。
 */
import { request } from '../../services/http'
import type { AuthSession } from './auth.types'

export interface LoginParams {
  email: string
  password: string
}

export function loginApi(params: LoginParams): Promise<AuthSession> {
  // auth:false —— 登录请求本身不需要已登录,401(账号密码错误)不应触发全局登出
  return request<AuthSession>('/auth/login', { method: 'POST', body: params, auth: false })
}

/** 主动作废服务端 token(演示 401 自动登出用;成功后下一次受保护请求会 401) */
export function expireSessionApi(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/auth/expire', { method: 'POST' })
}
