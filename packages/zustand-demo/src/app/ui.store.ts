/**
 * 全局 UI Store —— 跨 feature 的纯客户端态(store + selectors 同文件的示范)。
 *
 * 组件只 import 这里导出的 selector 钩子(useTheme / useActiveView …),不裸写
 * useUIStore(s => s.xxx);新增一个字段 = state 加字段 + 下方加一行 selector。
 *
 * reset 已由工厂自动注入;注意登出时不要 reset 本 store——theme 是用户偏好,
 * 应保留,登出只回默认视图(见 app/session.ts)。
 */
import { createStore } from '../lib/state'

export type ActiveView = 'projects' | 'editor'
export type Theme = 'light' | 'dark'

export interface UIState {
  sidebarCollapsed: boolean
  theme: Theme
  activeModal: string | null
  activeView: ActiveView
}

export interface UIActions {
  toggleSidebar: () => void
  setTheme: (theme: Theme) => void
  openModal: (modalId: string) => void
  closeModal: () => void
  setActiveView: (view: ActiveView) => void
}

export const useUIStore = createStore<UIState, UIActions>({
  name: 'UIStore',
  initial: {
    sidebarCollapsed: false,
    theme: 'light',
    activeModal: null,
    activeView: 'projects',
  },
  // 第二个持久化示例:partialize 只存 theme,证明 persist 可与业务无关地复用
  persist: {
    key: 'zustand-demo.ui.v1',
    partialize: (state) => ({
      theme: state.theme,
    }),
  },
  actions: ({ set }) => ({
    toggleSidebar: () =>
      set((state) => ({
        sidebarCollapsed: !state.sidebarCollapsed,
      })),
    setTheme: (theme) =>
      set({
        theme,
      }),
    openModal: (modalId) =>
      set({
        activeModal: modalId,
      }),
    closeModal: () =>
      set({
        activeModal: null,
      }),
    setActiveView: (view) =>
      set({
        activeView: view,
      }),
  }),
})

// ---- Selectors:组件只订阅所需字段(粒度订阅的示范) ----

export const useSidebarCollapsed = () => useUIStore((state) => state.sidebarCollapsed)

export const useTheme = () => useUIStore((state) => state.theme)

export const useActiveView = () => useUIStore((state) => state.activeView)

export const useActiveModal = () => useUIStore((state) => state.activeModal)
