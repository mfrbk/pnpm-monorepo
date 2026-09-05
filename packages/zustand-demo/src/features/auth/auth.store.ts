/**
 * Auth Store —— 客户端会话状态(createStore 示范:devtools + persist)。
 *
 * 只存“当前是谁”,不发起任何请求;登录/登出这类业务流程在 auth.hooks.ts。
 * 这里不写 logout —— 清会话等价于 reset(工厂免费注入),
 * 主动登出 / 401 统一由 app/session.ts 调 reset,避免多处手写复位清单。
 */
import { useShallow } from 'zustand/react/shallow'
import { createStore } from '../../lib/state'
import type { AuthSession, AuthUser } from './auth.types'

export interface AuthState {
  token: string | null
  user: AuthUser | null
}

export interface AuthActions {
  setSession: (session: AuthSession) => void
}

export const useAuthStore = createStore<AuthState, AuthActions>({
  name: 'AuthStore',
  initial: {
    token: null,
    user: null,
  },
  // partialize 只存 token/user,刷新后保持登录;actions/reset 是函数,不入 storage
  persist: {
    key: 'zustand-demo.auth.v1',
    partialize: (state) => ({
      token: state.token,
      user: state.user,
    }),
  },
  actions: ({ set }) => ({
    setSession: (session) =>
      set({
        token: session.token,
        user: session.user,
      }),
  }),
})

// ---- Selectors:组件统一从这里订阅,不裸写 useAuthStore(s => s.user) ----
// 多字段聚合用 useShallow,避免「值相等但引用变化」造成的多余渲染。

export const useCurrentUser = () => useAuthStore((state) => state.user)

export const useAuthToken = () => useAuthStore((state) => state.token)

export const useIsAuthenticated = () => useAuthStore((state) => Boolean(state.token))

export const useAuthSession = () =>
  useAuthStore(
    useShallow((state) => ({
      token: state.token,
      user: state.user,
    })),
  )
