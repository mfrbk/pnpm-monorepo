/** Project API:服务端数据的唯一来源(配合 react-query)。 */
import { request } from '../../services/http'
import type { Project, ProjectDetail } from './project.types'

export function fetchProjectsApi(): Promise<Project[]> {
  return request<Project[]>('/projects')
}

export function fetchProjectDetailApi(projectId: string): Promise<ProjectDetail> {
  return request<ProjectDetail>(`/projects/${projectId}/detail`)
}
