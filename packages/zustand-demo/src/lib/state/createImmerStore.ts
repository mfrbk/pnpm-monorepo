/**
 * immer store 工厂入口:devtools(恒开)+ immer + 可选 persist(localStorage)。
 *
 * actions 里的 set 为 ImmerSetFn:既可传整体 partial,也可传 (draft) => void 直改。
 * 适合复杂嵌套状态(撤销/重做、深层更新);中间件编排与 reset 在 factory.ts。
 */
import { createStoreWith } from './factory'
import type { BoundStore, ImmerStoreDef, ResetAction } from './types'

export function createImmerStore<S, A extends object>(
  def: ImmerStoreDef<S, A>,
): BoundStore<S & A & ResetAction> {
  return createStoreWith(def, 'immer')
}
