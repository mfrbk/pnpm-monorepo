/**
 * lib/state 工厂体系的公共类型。
 *
 * 调用方(store 文件)只面向「裸 set / get」写 actions,
 * 完全感知不到 devtools / persist / immer 的 mutator 元组。
 */
import type { UseBoundStore, StoreApi } from 'zustand'
import type { WritableDraft } from 'immer'

/** 普通工厂的 set:与 zustand 原生 set 对齐(整体 partial / 函数返回 partial)。 */
export type SetFn<S> = (partial: Partial<S> | ((state: S) => Partial<S>)) => void

/** immer 工厂的 set:既接受整体 partial,也接受 draft 直改 recipe。 */
export type ImmerSetFn<S> = {
  (partial: Partial<S>): void
  (recipe: (draft: WritableDraft<S>) => void): void
}

export interface PersistPart<S> {
  /** localStorage key */
  key: string
  /** 持久化 schema 版本,破坏性变更时 +1 并配合 migrate */
  version?: number
  /** 只持久化可序列化的数据子集(actions 是函数,必须剔除) */
  partialize: (state: S) => Partial<S>
}

/** 每个 store 由工厂免费注入的动作:一键回到 initial(登出/切换账号时复位用)。 */
export interface ResetAction {
  reset: () => void
}

/** 普通 store 定义:actions 里的 set 是裸 set(整体 partial / 函数返回 partial)。 */
export interface StoreDef<S, A extends object> {
  /** devtools store 名称(Redux DevTools 里可见) */
  name: string
  /** 初始数据字段(需可 JSON 序列化,reset 靠它克隆出全新默认值) */
  initial: S
  /** 可选持久化;persist 中间件只在本工厂内编排,调用方无需接触 */
  persist?: PersistPart<S & A>
  actions: (ctx: { set: SetFn<S & A>; get: () => S & A }) => A
}

/** immer store 定义:actions 里的 set 是 ImmerSetFn(支持 draft 直改)。 */
export interface ImmerStoreDef<S, A extends object> extends Omit<StoreDef<S, A>, 'actions'> {
  actions: (ctx: { set: ImmerSetFn<S & A>; get: () => S & A }) => A
}

export type BoundStore<S> = UseBoundStore<StoreApi<S>>
