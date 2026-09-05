/**
 * Project 业务 Hook:服务端数据(react-query)与客户端状态(Zustand,只存 ID)在此汇合。
 *
 * - useProjects / useProjectDetail:Server State → TanStack Query;
 * - useSelectProject:写 currentProjectId(client state)并切到编辑器视图;
 * - useCurrentProjectEntity:ID + query 数据 → 实体,组件无需自己 find。
 */
import { useQuery } from '@tanstack/react-query'
import { fetchProjectDetailApi, fetchProjectsApi } from './project.api'
import { useCurrentProjectId, useProjectStore } from './project.store'
import { useUIStore } from '../../app/ui.store'

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjectsApi,
  })
}

export function useProjectDetail(projectId: string | null) {
  return useQuery({
    queryKey: ['project', projectId, 'detail'],
    queryFn: () => fetchProjectDetailApi(projectId as string),
    enabled: Boolean(projectId),
  })
}

/** 选择当前项目:只写 ID 到 Zustand,再切到编辑器视图 */
export function useSelectProject() {
  return (projectId: string) => {
    useProjectStore.getState().setCurrentProject(projectId)
    useUIStore.getState().setActiveView('editor')
  }
}

/** 由 currentProjectId + react-query 项目列表解析出实体(体现「只存 ID」的收益) */
export function useCurrentProjectEntity() {
  const currentProjectId = useCurrentProjectId()
  const { data: projects } = useProjects()
  return projects?.find((project) => project.id === currentProjectId) ?? null
}
