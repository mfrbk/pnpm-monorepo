import type { Feedback } from './types'

/**
 * 反馈适配器仓库:持有当前生效的 Feedback 并在运行时替换。
 * set 做浅层 + message/loading 两层合并,支持增量注入。
 */
export class FeedbackStore {
  private feedback: Feedback

  constructor(feedback?: Feedback) {
    this.feedback = feedback ?? {}
  }

  set(partial: Feedback): void {
    this.feedback = {
      ...this.feedback,
      ...partial,
      message: { ...this.feedback.message, ...partial.message },
      loading: { ...this.feedback.loading, ...partial.loading },
    }
  }

  get(): Readonly<Feedback> {
    return this.feedback
  }
}

/** 全局 loading 控制器(引用计数,支持请求嵌套,计数归零才真正 hide) */
export interface LoadingController {
  show(content?: string): void
  hide(): void
}

export function createLoadingController(store: FeedbackStore): LoadingController {
  let active = 0
  return {
    show(content?: string): void {
      if (active === 0) store.get().loading?.show?.(content)
      active += 1
    },
    hide(): void {
      active = Math.max(active - 1, 0)
      if (active === 0) store.get().loading?.hide?.()
    },
  }
}

/**
 * 统一错误提示:优先 message.error,其次 message.warning;
 * 两者皆未注入时兜底 console.error —— 错误绝不清单静默吞掉。
 */
export function notifyError(store: FeedbackStore, content: string): void {
  const msg = store.get().message
  if (msg?.error) {
    msg.error(content)
    return
  }
  if (msg?.warning) {
    msg.warning(content)
    return
  }
  console.error(`[@mfr/http] ${content}`)
}
