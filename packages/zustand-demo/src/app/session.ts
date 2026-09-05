/**
 * 应用层会话编排:把「登出 / 登录过期后要复位哪些客户端状态」收敛到唯一入口。
 *
 * 之前这份清单散落在 services/http.ts(401)与 auth.hooks.ts(主动登出)里,
 * 各写一遍容易漏、容易不一致;现在它们都只调 clearSessionState。
 * 以后新增业务 store,若希望在登出时一并复位,在这里加一行 reset 即可。
 *
 * 传输层想读当前 token 也走这里(getSessionToken),让 infra 不再依赖具体 feature。
 */
import { useAuthStore } from '../features/auth/auth.store'
import { useProjectStore } from '../features/project/project.store'
import { useEditorStore } from '../features/editor/editor.store'
import { useUIStore } from './ui.store'

/** 供 services/http.ts 注入 Authorization(登录请求本身传 auth:false,不走这里)。 */
export const getSessionToken = (): string | null => useAuthStore.getState().token

/** 清空“与登录态相关”的客户端 store。401 自动登出与主动登出共用。 */
export function clearSessionState(): void {
  // reset 由 store 工厂免费注入,等价于“回到 initial”
  useAuthStore.getState().reset() // 会话:token / user
  useProjectStore.getState().reset() // 项目选中(客户端只存 id)
  useEditorStore.getState().reset() // 编辑器草稿
  // UI:只回默认视图;theme 属于用户偏好,故意不 reset
  useUIStore.getState().setActiveView('projects')
}
