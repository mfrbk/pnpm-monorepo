# Zustand × React:渲染绑定与 useSyncExternalStore

> 解剖问题单「问四·变更如何传导到 UI」在 Zustand 的答案:选择器 + 订阅如何做到"只重渲染用到的",并发下为什么不撕裂。· [← 返回总纲](./README.md)

内核只做**存 + 全量通知**,不认识 React。本篇读 React 入口(约 20 行)+ `useShallow`,回答"改了一个字段,为什么只有用到它的组件重渲染",以及并发渲染下的 **tearing(数据撕裂)** 问题。

## 一、React 桥的完整源码

`zustand` React 入口(发行版 `esm/react.mjs`):

```ts
const identity = (arg) => arg

function useStore(api, selector = identity) {
  const slice = React.useSyncExternalStore(
    api.subscribe, // subscribe
    React.useCallback(() => selector(api.getState()), [api, selector]), // getSnapshot
    React.useCallback(() => selector(api.getInitialState()), [api, selector]), // getServerSnapshot
  )
  React.useDebugValue(slice)
  return slice
}

const createImpl = (createState) => {
  const api = createStore(createState) // ① 先建 vanilla 内核
  const useBoundStore = (selector) => useStore(api, selector) // ② 再包成 hook
  Object.assign(useBoundStore, api) // ③ 把 api 抄到 hook 上
  return useBoundStore
}
export const create = (createState) => (createState ? createImpl(createState) : createImpl)
```

### ① `create` = 建内核 + 包 hook + 抄 api

- 先用 vanilla 的 `createStore` 造出 api;
- 定义 `useBoundStore(selector)`——它是 hook,本质是 `useStore(api, selector)` 的固定参调用;
- `Object.assign(useBoundStore, api)` 把 `getState / setState / subscribe / getInitialState` **直接复制到 hook 函数身上**。

所以一个 `useXxx` 既能在组件里当 hook 调,又能在组件外当 api 调(`useXxx.getState()`),**同一份引用、两副用法**,不需要任何 Provider。store 是模块级单例,谁 import 谁拿得到。

### ② `useStore`:一行 `useSyncExternalStore`

```ts
useSyncExternalStore(
  api.subscribe, // 订阅函数
  () => selector(api.getState()), // 取"当前快照"
  () => selector(api.getInitialState()), // SSR 用的"服务器快照"
)
```

**`useSyncExternalStore` 是 React 18 提供给"外部 store"的官方桥**:外部 store 一变,订阅过的组件会**以 React 的方式**重新渲染,而不是各自 `forceUpdate`。放进 React 生命周期:

| React 侧环节 | `useSyncExternalStore` 做的事                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| 渲染时       | 调用 `getSnapshot()`(即 `selector(api.getState())`)读当前快照,并**缓存**它                                       |
| 订阅         | 用 `subscribe` 挂上监听;store 一变就触发一次"需要重渲染"的调度                                                   |
| 提交前       | React **重新调用 `getSnapshot()`**,若与缓存快照 `Object.is` 不同 → 渲染期间数据变了 → 丢弃本次渲染、用新快照重来 |
| 每次渲染     | 返回的 `slice` 供组件使用                                                                                        |

三个函数各有讲究:

- **`getSnapshot` 必须引用稳定**:React 把这次快照与上次做 `Object.is`。若 store 没变但两次返回的**引用**不同,React 会认为"永远在变"而无限重渲染并告警——selector 必须**返回稳定引用**的原因(见第三节);
- **`getServerSnapshot` 专供 SSR**:服务端首屏没订阅、没 store 变更,直接返回初始状态对应切片,保证 `hydrate` 前后一致;
- **订阅与取快照指向同一个 store 状态**:`api.subscribe` 与 `api.getState` 天然同源,不会"订了 A 的变更、读了 B 的快照"。

### ③ 为什么要包 `useCallback`?

`getSnapshot` 每次渲染都被 React 调用,若是新函数不影响正确性,但 `useSyncExternalStore` 对快照的缓存基于返回值而非函数。`useCallback` 保证依赖 `[api, selector]`:api 永远稳定,selector 稳定则 `getSnapshot` 稳定。注意:**内联写 `(s) => s.count` 时 selector 每次渲染都是新函数**,但返回同一快照值仍安全——真正必须稳定的是**返回值**,不是函数本身。

## 二、为什么并发渲染下不撕裂

React 18+ 渲染**可中断**(见本仓库 [React 并发调度笔记](../react-hooks-scheduling.md)):一次更新在 Commit 前可暂停、让位给高优任务、再回来重算。这给"外部 store + 自行订阅"的老方案埋了坑:

**tearing(数据撕裂)**——组件树不同部分各自在不同时刻读 store,UI 里一半新数据一半旧数据。坏实现是:组件里 `subscribe` 后 `setState`(强制重渲染),渲染里再 `getState()` 读:

```tsx
// ❌ 自己订阅的老写法:渲染与订阅不是一体,并发下可能撕裂
function BadCounter() {
  const [, force] = React.useReducer((c) => c + 1, 0)
  React.useEffect(() => api.subscribe(() => force()), [])
  return <div>{api.getState().count}</div> // 渲染时去读,读到的是"当时"的 state
}
```

问题在于:并发渲染途中若 store 被别处更新,读到的新旧值不可控;React 也不知道该拿哪个版本对齐。

`useSyncExternalStore` 把"读"和"订阅"收编为 React 自己的原语,从机制上消除撕裂:

1. **渲染与订阅同源**:渲染时读的快照、store 变化时触发的调度,都走 React 内部;
2. **提交前一致性检查**:渲染结束、真正上屏前,React 重读一次 `getSnapshot`;若发现渲染期间 store 又变了(快照与缓存不一致),就**丢弃这次渲染重来**,保证最终上屏的 UI 全部来自**同一个 store 版本**。

**只要外部 store 走 `useSyncExternalStore`,React 就把它当成"渲染输入"来对齐**;Zustand 恰好把桥建在这条原语上,所以它在 `startTransition`、并发渲染下天然正确——不是它写得多聪明,是选对了 React 给的标准答案。

> 对比 Vue 侧 Pinia:Vue 没有"可中断渲染",store 本身是响应式对象,靠依赖追踪通知(见 [Pinia 内核](./pinia-core.md))。[对位篇](./contrast.md) 逐维对照。

## 三、selector 的引用稳定:重渲染粒度的命门

"返回值引用必须稳定"的三种写法:

```tsx
// ✅ 选原始值:Object.is 精确比较,count 变了才重渲染
const count = useCounter((s) => s.count)

// ✅ 选一个"未变的引用字段":store 没换引用时 s.user 是同一对象 → 稳定
const user = useCounter((s) => s.user)

// ❌ 每次渲染都 new 一个新对象/数组:Object.is 永远不等 → 死循环警告
const { a, b } = useCounter((s) => ({ a: s.a, b: s.b }))
```

第三条是 Zustand 使用者**最常踩的坑**,触发"getSnapshot 应缓存"警告并无限重渲染。正确姿势是 `useShallow`:

```tsx
import { useShallow } from 'zustand/react/shallow'
const { a, b } = useCounter(useShallow((s) => ({ a: s.a, b: s.b })))
```

`useShallow` 源码(发行版 `esm/react/shallow.mjs`):

```ts
function useShallow(selector) {
  const prev = React.useRef(undefined)
  return (state) => {
    const next = selector(state)
    return shallow(prev.current, next) ? prev.current : (prev.current = next)
  }
}
```

它返回一个**包装过的快照函数**:算出 `next` 后与上一次做**浅比较**(`shallow`:逐层顶层 key 用 `Object.is`)。各字段都相同 → 返回上一次**旧引用**(稳定,React 不重渲染);任一字段真变了 → 赋入新引用。于是"多字段选取"既取到多个值,又不会因每次 new 对象而空转。

**重渲染粒度结论**:Zustand 的重渲染**精确度 = selector 返回值的引用是否变化**,由两部分拼接——① React 只认引用是否 `Object.is` 相等;② selector 与 `useShallow` 把"没变的片段"翻译成"同一引用"。

## 四、事件处理里用 getState,别用 hook

渲染读取与事件读取语境不同:

```tsx
// 事件回调里只读、不渲染:直接 getState(),避免订阅一个你根本没渲染的值
function submit() {
  const { token } = useAuth.getState() // 读一次,不订阅
  api.post('/x', { token })
}
```

回调里**临时读**快照不需要触发重渲染——用 `getState()` 而不进 hook,正确且零开销。只有当值**要参与渲染**时才用 selector 订阅。"读与订阅分离"的纪律。

## 五、为什么不需要 Provider?什么时候才要 Context?

`useBoundStore` 闭包持有 module 级单例 api,组件树外**不需要 Provider**,也绕开 Context 的"value 一变全 Consumer 重渲染"的粗粒度(相对 `useContext + useReducer` 的核心卖点)。

需要 `zustand/context`(把 store 放进 `createContext`)的典型场景只有两个:**SSR 多请求隔离**(每请求一份 store,避免跨请求串状态)与**模块被多实例化**(微前端里各自独立 store)。普通 SPA 不需要。Zustand 的 store 生命周期哲学:**store 跟随模块,而不是跟随组件树**。

## 速查

| 解剖问题       | Zustand × React 答案                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 问四·传导到 UI | vanilla 全量通知 + React 桥 `useSyncExternalStore`;**渲染粒度 = selector 返回值的引用稳定度**;`useShallow` 为"多字段但想稳定"提供浅比较缓存 |
| 并发 / 撕裂    | `useSyncExternalStore` 的提交前一致性检查保证 UI 永远来自同一 store 版本,`startTransition` 下安全                                           |
| 扩展           | selector 之外:带选择器的 `subscribeWithSelector`、把能力"插在 set 链上"的中间件——见[中间件篇](./zustand-middleware.md)                      |

> 源码参考:`zustand@^5` 的 `esm/react.mjs`(`src/react.ts`)与 `esm/react/shallow.mjs`(`src/react/shallow.ts`);`useSyncExternalStore` 见 react.dev/reference/react/useSyncExternalStore。下一篇:[Zustand 中间件](./zustand-middleware.md)。
