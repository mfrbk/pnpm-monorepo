/**
 * 普通 store 工厂入口:devtools(恒开,无扩展时自动 no-op)+ 可选 persist(localStorage)。
 *
 * 中间件编排与免费的 reset 动作都在 factory.ts 里实现,这里只负责收窄类型。
 * 返回的是 zustand `UseBoundStore`,`.getState()/.setState()/.subscribe()`
 * 与 `useXxxStore(s => s)` 全部照常可用。
 */
import { createStoreWith } from './factory'
import type { BoundStore, ResetAction, StoreDef } from './types'

export function createStore<S, A extends object>(
  def: StoreDef<S, A>,
): BoundStore<S & A & ResetAction> {
  return createStoreWith(def, 'plain')
}
