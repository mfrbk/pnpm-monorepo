/**
 * 假后端(mock server):内存 + localStorage 持久化,setTimeout 模拟网络延迟。
 * 这里模拟真实服务端的职责:账号校验、签发/作废 token、项目/文档存取。
 * 对上层只暴露 serverRoute / ServerError;由 services/http.ts 统一调度。
 */
import type { AuthSession, AuthUser } from '../features/auth/auth.types'
import type { Project, ProjectDetail } from '../features/project/project.types'
import type { EditorDocument } from '../features/editor/editor.types'

export class ServerError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ServerError'
  }
}

// ---------------------------------------------------------------------------
// 种子数据
// ---------------------------------------------------------------------------

const SEED_USERS: AuthUser[] = [
  { id: 'u_1', name: 'Mia', email: 'demo@mzy1120.dev' },
  { id: 'u_2', name: 'Kol', email: 'kol@mzy1120.dev' },
]

const PASSWORD_BY_EMAIL: Record<string, string> = {
  'demo@mzy1120.dev': '123456',
  'kol@mzy1120.dev': '123456',
}

const SEED_PROJECTS: Project[] = [
  { id: 'p_docs', name: 'Docs 平台', description: '文档中心整体重构' },
  { id: 'p_editor', name: 'AI 编辑器', description: 'Markdown 块编辑器' },
  { id: 'p_admin', name: '权限后台', description: 'RBAC 管理台' },
]

const DEFAULT_DOC_BLOCKS = [
  { id: 'b1', type: 'text' as const, text: '双击块文字进行编辑;失焦提交一次 = 一个历史点' },
  { id: 'b2', type: 'text' as const, text: '用工具栏的 撤销 / 重做 回退;块在服务端也有存档' },
]

function makeDefaultDocument(): EditorDocument {
  return { blocks: DEFAULT_DOC_BLOCKS.map((b) => ({ ...b, id: b.id })) }
}

// ---------------------------------------------------------------------------
// 服务端状态(localStorage 持久化,保证「刷新后 token 仍有效」且文档不丢)
// ---------------------------------------------------------------------------

const DB_KEY = 'zustand-demo.server.v1'

interface DbShape {
  /** 当前有效的 token 列表(模拟服务端会话表) */
  tokens: string[]
  /** 每个项目已保存的文档 */
  documents: Record<string, EditorDocument>
}

function readDb(): DbShape {
  try {
    const raw = localStorage.getItem(DB_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DbShape
      return {
        tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
        documents: parsed.documents ?? {},
      }
    }
  } catch {
    // 忽略损坏数据,重建种子
  }
  return { tokens: [], documents: {} }
}

function writeDb(db: DbShape): void {
  localStorage.setItem(DB_KEY, JSON.stringify(db))
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function assert(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new ServerError(status, message)
}

// ---------------------------------------------------------------------------
// 登录 / token
// ---------------------------------------------------------------------------

export function createToken(email: string): string {
  return `t_${Date.now().toString(36)}_${email}`
}

export function expireAllTokens(): void {
  const db = readDb()
  writeDb({ ...db, tokens: [] })
}

// ---------------------------------------------------------------------------
// 路由分发(模拟 REST 端点)
// ---------------------------------------------------------------------------

interface RouteContext {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  token?: string
}

export async function serverRoute(path: string, ctx: RouteContext): Promise<unknown> {
  await wait(320)

  // ---- 登录(不需要已登录) ----
  if (path === '/auth/login' && ctx.method === 'POST') {
    const { email, password } = (ctx.body ?? {}) as { email?: string; password?: string }
    const user = SEED_USERS.find((u) => u.email === email)
    assert(user && PASSWORD_BY_EMAIL[email ?? ''] === password, 401, '邮箱或密码错误')

    const token = createToken(email ?? '')
    const db = readDb()
    writeDb({ ...db, tokens: [...db.tokens, token] })
    return { token, user } satisfies AuthSession
  }

  // ---- 主动作废当前会话(模拟 token 过期场景) ----
  if (path === '/auth/expire' && ctx.method === 'POST') {
    ensureAuthenticated(ctx.token)
    expireAllTokens()
    return { ok: true }
  }

  ensureAuthenticated(ctx.token)

  if (path === '/projects' && ctx.method === 'GET') {
    return SEED_PROJECTS
  }

  const detailMatch = path.match(/^\/projects\/([^/]+)\/detail$/)
  if (detailMatch && ctx.method === 'GET') {
    const project = SEED_PROJECTS.find((p) => p.id === detailMatch[1])
    assert(project, 404, '项目不存在')
    return {
      ...project,
      ownerName: 'Mia',
      memberCount: 6,
      updatedAt: '2026-09-02',
    } satisfies ProjectDetail
  }

  const docMatch = path.match(/^\/projects\/([^/]+)\/document$/)
  if (docMatch) {
    const projectId = docMatch[1]
    const db = readDb()
    if (ctx.method === 'GET') {
      return db.documents[projectId] ?? makeDefaultDocument()
    }
    if (ctx.method === 'PUT') {
      const document = (ctx.body ?? {}) as EditorDocument
      assert(document && Array.isArray(document.blocks), 400, '文档格式不正确')
      writeDb({ ...db, documents: { ...db.documents, [projectId]: { blocks: document.blocks } } })
      return { ok: true }
    }
  }

  throw new ServerError(404, `Not Found: ${ctx.method} ${path}`)
}

function ensureAuthenticated(token?: string): void {
  const db = readDb()
  assert(token && db.tokens.includes(token), 401, '未登录或登录已过期')
}
