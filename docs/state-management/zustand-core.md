# Zustand 内核:存储与订阅(约 20 行的引擎)

> [← 返回总纲](./README.md) · 解剖问题单「问一·存哪 / 问二·怎么变 / 订阅怎么通知」在 Zustand 的第一份答案

Zustand 与绝大多数状态库不同的第一步是:**它的内核不在 React 里**。你安装的 `zustand` 包其实分两层——`zustand/vanilla` 是一个**零框架依赖**的 store 引擎(全文约 20 行),`zustand`(React 入口)只是在它之上加了一个叫 `useSyncExternalStore` 的桥(见[下一章](./zustand-react.md))。因为内核纯净,这个 store 才能在 React、Vue、甚至 Node 里被同一套订阅机制使用。

本篇文章读的就是这个内核:`createStore.ts`。它会一次性回答解剖问题单上的大半问题——**状态存哪、怎么变、订阅如何通知**。

## 一、先看用法:create 的两副面孔

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

> 心智锚点:`create` 返回的那个"hook 函数"不是 store,store 是它闭包里的 **api**。`create` = 建一个 vanilla store + 把 api 抄到 hook 函数上。两者的引擎同一份。

## 二、内核源码:createStoreImpl 逐行

`zustand/vanilla` 的 `createStore.ts`(v5 发行 ESM 原样)全文如下:

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

每处都值得停下来看它为什么这么写:

### ① 状态本体:一个普通变量,不是响应式对象

`state` 只是闭包里的一个普通引用。Zustand **没有**把状态包成 `reactive`/`observable`,也不会自动追踪"谁读了它"。状态本身毫无魔法——**全部的魔法都在"替换与通知"两步**。这决定了它两条特性:

- 状态是**不可变快照式**的:每次更新用新对象替换旧引用(`getState()` 拿到的是某一时刻的完整快照);
- 正因是普通对象,它**可被任何环境读写**(`structuredClone`、序列化、在 effect 外读),框架无关由此而来。

### ② 订阅者:Set 而非数组

用 `Set` 有两个好处:**去重**(同一个 listener 不会订阅两次)与 **O(1) 删除**(退订直接 `delete`)。`subscribe` 返回的正是 `() => listeners.delete(listener)` 这个退订函数——闭包捕获了 listener,无需传参。

### ③ 快照比对:Object.is 的 bail out

```ts
if (!Object.is(nextState, state)) { ... }
```

`Object.is`(对原始值与 `NaN` 也正确,比 `===` 严格)比较的是**新旧引用**。若更新结果与当前状态**引用相同**,直接跳过通知——这既避免无谓重渲染,也让"setState 成相同的值"变成零成本操作。注意这里是**整体快照比较**,不是 diff 某个字段。

### ④ 合并语义:默认浅合并,可选整体替换

```ts
state =
  (replace ?? (typeof nextState !== 'object' || nextState === null))
    ? nextState
    : Object.assign({}, state, nextState)
```

三个分支读作:

- `replace: true` → 用新对象**整体替换**(丢弃未提及的字段);
- `nextState` 不是对象(如 `setState(5)` 或 `setState(null)`)→ 整体替换;
- 否则默认 → **浅层合并**:`{ ...state, ...nextState }`。

这条值得划重点:**Zustand 默认是"浅合并一层"**。改嵌套对象时要手动展开:

```ts
set((s) => ({ user: { ...s.user, name: 'x' } })) // 深一层,必须自己展开
set({ 'user.name': 'x' }) // ❌ 不会深合并,平白多出这个 key
```

想写"可变风格"就配 immer 中间件(见[中间件篇](./zustand-middleware.md))。这是 Zustand 对"不可变"的取舍:**不给状态罩魔法、保留对象语义,把深层写的痛苦外包给可选的 immer**。

### ⑤ 全量通知:一把梭,谁用谁筛

```ts
listeners.forEach((listener) => listener(state, previousState))
```

内核每次更新把 **所有** 订阅者都叫一遍,参数是**(新状态, 旧状态)**。这就是状态库最朴素的通知模型——**store 自己不做"哪些片段变了"的判断**。

那"精准重渲染"靠谁?答案是**消费端的筛选**,分两层:

- 订阅端手动筛:`subscribe(listener)` 里自己比对新旧(`subscribeWithSelector` 中间件替你做了,见中间件篇);
- React 端靠 **selector + 引用稳定**:谁从全量快照里"挑"出自己关心的片段,且片段引用没变就不触发重渲染——这是 [下一章](./zustand-react.md) 的主线。

> 一句话记忆:**vanilla 内核 = 存 + 通知,不含"精准"**;精准是消费端的问题,不是内核的问题。这个分工让内核保持 20 行,也让"精准策略"可以被不同框架自由实现。

### ⑥⑦ 读写与订阅:三个小函数

- `getState()` 返回**当前引用**:`state` 是普通变量,所以读它不需要任何框架机制,是纯粹的"拿快照";
- `getInitialState()` 返回初始状态——React 侧 `useSyncExternalStore` 做服务端渲染(SSR)快照时会用到;
- `subscribe(fn)` 入列并返回退订函数,用于框架外监听。

### ⑧ 初始化顺序:先建 api,再跑 createState

```ts
const api = { setState, getState, getInitialState, subscribe }
const initialState = (state = createState(setState, getState, api))
```

顺序很关键:**api 先于 createState 存在**。因此你的初始化函数里就能用 `set` / `get`,甚至订阅自己:

```ts
createStore((set, get, api) => {
  api.subscribe((s) => console.log('任何一次变化', s)) // 初始化里就能订阅
  return { count: 0 }
})
```

同时 `api` 被传进去,意味着中间件可以**在 createState 执行前就换掉 `api.setState`**——这正是 [中间件篇](./zustand-middleware.md) 里 persist / devtools 改写行为的入口。

## 三、20 行是不是"就这么简单"?——是,而且这就是重点

去掉类型与空分支,Zustand 内核和你能手写的版本几乎一样:

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

**"读源码级"最大的收获往往就是这句:它真的这么短。** Zustand 没有炫技,它把复杂度挪走了——挪到 React 桥的选择器模型、挪到中间件的组合方式、挪到 TypeScript 的类型推导。理解了这个内核,再去理解它"为什么这样设计"就顺理成章:

- 为什么框架无关?因为内核只承诺"存 + 通知",不知道渲染是什么;
- 为什么默认浅合并?因为不打算罩响应式魔法,保持对象朴素语义;
- 为什么全量通知?因为把"筛选"留给消费端,内核就不必维护依赖图。

## 四、对照问题单

- **问一(存哪)**:普通闭包变量,整棵 state 一个对象;`getState()` 取快照引用。
- **问二(怎么变)**:`setState(partial | fn, replace?)`;函数式 `partial` 拿最新 `state`;默认**浅合并替换**,`Object.is` 相同时直接跳过。改入口唯一(`setState`),天然可被中间件拦。
- **订阅机制**:Set 全量通知,参数为新旧两态;内核不做片段筛选——"精准"交给消费端。

下一个问题正是内核没答的那一半:**"全量通知"到了 React 侧,凭什么只有用对 selector 的组件才重渲染?而且 React 18+ 并发渲染下为什么不会读到撕裂数据?** 这是 [Zustand × React:渲染绑定](./zustand-react.md) 的主题,也是状态库最值钱的一维。

> 源码参考:`zustand@^5` 的 `packages/zustand/src/vanilla/createStore.ts`(发行版 `esm/vanilla.mjs` 与其一致);官方文档 zustand.docs.pmnd.rs。
