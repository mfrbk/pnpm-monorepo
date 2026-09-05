/** 当前登录用户(纯类型;服务端数据只存在于 react-query / auth 会话,不重复放列表缓存) */
export interface AuthUser {
  id: string
  name: string
  email: string
  avatar?: string
}

/** 登录成功后的会话:token 交给 persist,user 供 UI 直接读取 */
export interface AuthSession {
  token: string
  user: AuthUser
}
