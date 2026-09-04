# Zustand 内核:存储与订阅(约 20 行的引擎)

> 解剖问题单「问一·存哪 / 问二·怎么变 / 订阅怎么通知」在 Zustand 的第一份答案。· [← 返回总纲](./README.md)

`zustand` 包分两层:`zustand/vanilla` 是**零框架依赖**的 store 引擎(约 20 行),`zustand`(React 入口)只在上面加一个 `useSyncExternalStore` 桥(见[下一章](./zustand-react.md))。内核纯净,store 才能在 React、Vue、甚至 Node 里用同一套订阅机制。

## 一、用法:create 的两副面孔

```ts
// A. vanilla(无框架):返回一个裸 api
import { createStore } from 'zustand/vanilla'

const counterApi = createStore((set) => ({
  count: 0,
  inc: () => set((s) => ({ count: s.count + 1 })),
}))
counterApi.getState().count // 0,纯读,不触发渲染
counterApi.subscribe((state, prev) => console.log('变了:', state.count)) // 裸订阅
counterApi.setState({ count: 1 }) // 命令式改
```

```tsx
// B. react:返回一个"本身是 api、但能当 hook 用"的函数
import { create } from 'zustand'

const useCounter = create((set) => ({ count: 0, inc: () => set((s) => ({ count: s.count + 1 })) }))
useCounter.getState().count // api 也被直接"抄"到了 hook 上
function View() {
  const count = useCounter((s) => s.count) // 当 hook 用,靠 selector 精准订阅
  return <button onClick={() => useCounter.getState().inc()}>{count}</button>
}
```

> 心智锚点:`create` 返回的那个"hook 函数"不是 store,store 是它闭包里的 **api**。`create` = 建一个 vanilla store + 把 api 抄到 hook 函数上。两者引擎同一份。

## 二、内核源码:createStoreImpl 逐行

`zustand/vanilla` 的 `createStore.ts`(v5 发行 ESM 原样):

```ts
const createStoreImpl = (createState) => {
  let state // ① 状态本体:闭包里的普通变量
  const listeners = new Set() // ② 订阅者:一个 Set(不是数组)

  const setState = (partial, replace) => {
    const nextState = typeof partial === 'function' ? partial(state) : partial
    if (!Object.is(nextState, state)) {
      // ③ 快照比对:没变就什么都不做(bail out)
      const previousState = state
      // ④ 合并语义:replace=true 或 nextState 非对象 → 整体替换;否则浅层 Object.assign
      state = (replace != null ? replace : typeof nextState !== 'object' || nextState === null)
        ? nextState
        : Object.assign({}, state, nextState)
      listeners.forEach((listener) => listener(state, previousState)) // ⑤ 全量通知
    }
  }

  const getState = () => state // ⑥ 纯读,返回当前引用
  const getInitialState = () => initialState
  const subscribe = (listener) => {
    // ⑦ 订阅,返回退订函数
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  const api = { setState, getState, getInitialState, subscribe }
  // ⑧ 惰性初始化:createState 在 api 建好后才执行,初始 state 由此产生
  const initialState = (state = createState(setState, getState, api))
  return api
}
export const createStore = (createState) =>
  createState ? createStoreImpl(createState) : createStoreImpl
```

### ① 状态本体:普通变量,不是响应式对象

`state` 只是闭包里一个普通引用。Zustand **没有**把状态包成 `reactive`/`observable`,也不自动追踪"谁读了它"。**全部的魔法在"替换与通知"两步**:

- 状态是**不可变快照式**的:每次更新用新对象替换旧引用(`getState()` 拿到某一时刻的完整快照);
- 正因是普通对象,**可被任何环境读写**(`structuredClone`、序列化、在 effect 外读),框架无关由此而来。

### ② 订阅者:Set 而非数组

`Set` 两个好处:**去重**(同一 listener 不会订阅两次)与 **O(1) 删除**(退订直接 `delete`)。`subscribe` 返回 `() => listeners.delete(listener)`,闭包捕获 listener,无需传参。

### ③ 快照比对:Object.is 的 bail out

```ts
if (!Object.is(nextState, state)) { ... }
```

`Object.is`(对原始值与 `NaN` 也正确,比 `===` 严格)比较**新旧引用**。更新结果与当前状态**引用相同**则跳过通知——避免无谓重渲染,让"set 成相同的值"零成本。注意是**整体快照比较**,不是 diff 字段。

### ④ 合并语义:默认浅合并,可选整体替换

```ts
state =
  (replace ?? (typeof nextState !== 'object' || nextState === null))
    ? nextState
    : Object.assign({}, state, nextState)
```

三个分支:

- `replace: true` → 新对象**整体替换**(丢弃未提及字段);
- `nextState` 不是对象(如 `setState(5)` / `setState(null)`)→ 整体替换;
- 否则默认 → **浅层合并**:`{ ...state, ...nextState }`。

**Zustand 默认是"浅合并一层"**。改嵌套对象要手动展开:

```ts
set((s) => ({ user: { ...s.user, name: 'x' } })) // 深一层,必须自己展开
set({ 'user.name': 'x' }) // ❌ 不会深合并,平白多出这个 key
```

想写"可变风格"就配 immer 中间件(见[中间件篇](./zustand-middleware.md))。Zustand 的取舍:**不给状态罩魔法、保留对象语义,把深层写的痛苦外包给可选的 immer**。

### ⑤ 全量通知:一把梭,谁用谁筛

```ts
listeners.forEach((listener) => listener(state, previousState))
```

每次更新把**所有**订阅者都叫一遍,参数 **(新状态, 旧状态)**。store 自己不做"哪些片段变了"的判断。

"精准重渲染"靠**消费端筛选**,分两层:

- 订阅端手动筛:`subscribe(listener)` 里自己比对新旧(`subscribeWithSelector` 中间件替你做了,见[中间件篇](./zustand-middleware.md));
- React 端靠 **selector + 引用稳定**:谁从全量快照里"挑"出关心的片段,片段引用没变就不触发重渲染——[下一章](./zustand-react.md) 的主线。

> 记忆:**vanilla 内核 = 存 + 通知,不含"精准"**;精准是消费端的问题。这个分工让内核保持 20 行,也让"精准策略"可被不同框架自由实现。

### ⑥⑦ 读写与订阅

- `getState()` 返回**当前引用**:state 是普通变量,读它不需要框架机制,是纯粹的"拿快照";
- `getInitialState()` 返回初始状态——React 侧 `useSyncExternalStore` 做 SSR 快照时会用到;
- `subscribe(fn)` 入列并返回退订函数,用于框架外监听。

### ⑧ 初始化顺序:先建 api,再跑 createState

```ts
const api = { setState, getState, getInitialState, subscribe }
const initialState = (state = createState(setState, getState, api))
```

**api 先于 createState 存在**,初始化函数里就能用 `set` / `get`,甚至订阅自己:

```ts
createStore((set, get, api) => {
  api.subscribe((s) => console.log('任何一次变化', s)) // 初始化里就能订阅
  return { count: 0 }
})
```

`api` 被传进去,意味着中间件可以**在 createState 执行前就换掉 `api.setState`**——persist / devtools 改写行为的入口([中间件篇](./zustand-middleware.md))。

## 三、"20 行"就是重点

去掉类型与空分支,内核和能手写的版本几乎一样:

```ts
function myStore(initializer) {
  let state
  const listeners = new Set()
  const setState = (partial, replace) => {
    const next = typeof partial === 'function' ? partial(state) : partial
    if (!Object.is(next, state)) {
      const prev = state
      state = (replace ?? typeof next !== 'object') ? next : { ...state, ...next }
      listeners.forEach((l) => l(state, prev))
    }
  }
  const api = {
    setState,
    getState: () => state,
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
  }
  state = initializer(setState, api.getState, api)
  return api
}
```

Zustand 把复杂度挪走了——挪到 React 桥的选择器模型、中间件的组合方式、TypeScript 的类型推导。由此解释它的设计:

- 为什么框架无关?内核只承诺"存 + 通知",不知道渲染是什么;
- 为什么默认浅合并?不打算罩响应式魔法,保持对象朴素语义;
- 为什么全量通知?把"筛选"留给消费端,内核不必维护依赖图。

## 速查

| 解剖问题    | Zustand 内核答案                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 问一·存哪   | 普通闭包变量,整棵 state 一个对象;`getState()` 取快照引用                                                                          |
| 问二·怎么变 | `setState(partial \| fn, replace?)`;函数式 partial 拿最新 state;默认**浅合并替换**,`Object.is` 相同则跳过;改入口唯一,可被中间件拦 |
| 订阅机制    | Set 全量通知,参数 (new, prev);内核不做片段筛选——"精准"交给消费端                                                                  |
| 扩展点      | `api` 先于 createState 存在 → 中间件可在 createState 前换掉 `api.setState`                                                        |

> 源码参考:`zustand@^5` 的 `packages/zustand/src/vanilla/createStore.ts`(发行版 `esm/vanilla.mjs` 一致);官方文档 zustand.docs.pmnd.rs。下一篇:[Zustand × React:渲染绑定](./zustand-react.md)。
