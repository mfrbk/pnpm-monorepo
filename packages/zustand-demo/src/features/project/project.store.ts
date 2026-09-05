/**
 * Project Store —— 客户端 UI 态(createStore 示范:无 persist)。
 *
 * 只存 id、不存实体:currentProjectId / selectedProjectIds。
 * 项目数据本身来自 react-query(useProjects,见 project.hooks.ts),组件取实体 =
 * query 结果.find(id) —— 这就是 Server/Client State 的边界。
 * reset 由工厂注入(登出/401 复位,见 app/session.ts),无需手写。
 */
import { useShallow } from 'zustand/react/shallow'
import { createStore } from '../../lib/state'

export interface ProjectState {
  currentProjectId: string | null
  selectedProjectIds: string[]
}

export interface ProjectActions {
  setCurrentProject: (projectId: string | null) => void
  toggleSelect: (projectId: string) => void
  clearSelection: () => void
}

export const useProjectStore = createStore<ProjectState, ProjectActions>({
  name: 'ProjectStore',
  initial: {
    currentProjectId: null,
    selectedProjectIds: [],
  },
  actions: ({ set }) => ({
    setCurrentProject: (projectId) =>
      set({
        currentProjectId: projectId,
      }),
    toggleSelect: (projectId) =>
      set((state) => ({
        selectedProjectIds: state.selectedProjectIds.includes(projectId)
          ? state.selectedProjectIds.filter((id) => id !== projectId)
          : [...state.selectedProjectIds, projectId],
      })),
    clearSelection: () =>
      set({
        selectedProjectIds: [],
      }),
  }),
})

// ---- Selectors:组件只订阅所需字段。数组用 useShallow 订阅,否则 store 里
// 其它字段变化导致 selector 重算时,新数组引用会让组件无谓重渲染。 ----

export const useCurrentProjectId = () => useProjectStore((state) => state.currentProjectId)

export const useSelectedProjectIds = () =>
  useProjectStore(useShallow((state) => state.selectedProjectIds))
