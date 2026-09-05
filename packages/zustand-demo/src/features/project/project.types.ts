/** 项目(服务端实体)。只存在于 react-query 缓存,Zustand 里永远只存 id。 */
export interface Project {
  id: string
  name: string
  description?: string
}

/** 项目详情(服务端实体,按需查询) */
export interface ProjectDetail extends Project {
  ownerName: string
  memberCount: number
  updatedAt: string
}
