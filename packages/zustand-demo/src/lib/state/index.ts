/**
 * lib/state —— 面向「大型 React + TypeScript 项目」的 zustand 薄封装。
 *
 * 定位:不是替代 zustand,而是把「中间件编排 + 订阅纪律」收敛成统一入口:
 * - createStore:普通 store,devtools + 可选 persist;
 * - createImmerStore:复杂嵌套状态,devtools + immer + 可选 persist(draft 直改);
 * - 每个 store 都免费自带 reset(回到 initial),适合登出/切换账号时统一复位。
 *
 * 新建一组状态的最小模板(一个文件即可):
 *   export const useCounterStore = createStore({
 *     name: 'CounterStore',
 *     initial: { count: 0 },
 *     actions: ({ set }) => ({
 *       inc: () => set((s) => ({ count: s.count + 1 })),
 *     }),
 *   })
 *   export const useCount = () => useCounterStore((s) => s.count)
 * 组件统一从每个 store 文件导出的 selector 钩子订阅;登出要复位的 store
 * 去 app/session.ts 里登记一行。
 *
 * 依赖(zustand/immer)为 peer 级设计:调用方自行安装;persist 不传即关。
 */

export { createStore } from './createStore'
export { createImmerStore } from './createImmerStore'
export type {
  BoundStore,
  ImmerSetFn,
  ImmerStoreDef,
  PersistPart,
  ResetAction,
  SetFn,
  StoreDef,
} from './types'
