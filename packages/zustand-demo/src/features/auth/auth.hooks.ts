/**
 * Auth 业务 Hook(应用用例层):组件只依赖这里的函数,不直接碰 store。
 *
 * 登录/登出这类「异步动作 + 跨 store 复位」的流程放在这里,而不是塞进 store:
 * - useLogin:调 api → 写 auth store;
 * - useLogout:统一走 app/session.clearSessionState()(清 auth/project/editor/ui)
 *   再清 react-query 缓存;
 * - useExpireSession:作废服务端 token,下一次受保护请求 401 → http 自动登出。
 */
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { expireSessionApi, loginApi } from './auth.api'
import type { LoginParams } from './auth.api'
import { useAuthStore } from './auth.store'
import { clearSessionState } from '../../app/session'

export function useLogin() {
  return useCallback(async (params: LoginParams) => {
    const session = await loginApi(params)
    useAuthStore.getState().setSession(session)
    return session
  }, [])
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    clearSessionState()
    queryClient.clear()
  }, [queryClient])
}

export function useExpireSession() {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await expireSessionApi()
    // 触发一次受保护请求(如项目列表)→ services/http.ts 收到 401 → clearSessionState()
    await queryClient.invalidateQueries()
  }, [queryClient])
}
