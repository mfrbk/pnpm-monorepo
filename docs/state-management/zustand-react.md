# Zustand × React:渲染绑定与 useSyncExternalStore

> [← 返回总纲](./README.md) · 解剖问题单「问四·变更如何传导到 UI」在 Zustand 的答案:选择器 + 订阅如何做到"只重渲染用到的",以及并发下为什么不撕裂

上一章的内核只做一件事:**存 + 全量通知**。它完全不认识 React。那"全量通知"到达 React 侧后,凭什么一个 store 里改了一个字段,只有那个 `useCounter((s) => s.count)` 的组件重渲染,而别处读 `s.total` 的不动?

本篇读的就是答案所在——`zustand` 的 React 入口(约 20 行)+ `useShallow`。它回答解剖问题单上**最值钱的一维:变更如何传导到 UI**,并顺带解释状态库在 React 并发渲染(可中断)下的头号难题——**tearing(数据撕裂)**。

## 一、React 桥的完整源码

`zustand` React 入口(发行版 `esm/react.mjs`)全文如下:

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

三段各说一件事:

### ① `create` = 建内核 + 包 hook + 抄 api

`createImpl` 做的事与上一篇心智一致:先用 vanilla 的 `createStore` 造出 api,然后:

- 定义 `useBoundStore(selector)`——**它是 hook,但本质是 `useStore(api, selector)` 的固定参调用**;
- `Object.assign(useBoundStore, api)` 把 `getState / setState / subscribe / getInitialState` **直接复制到 hook 函数身上**。

所以一个 `useXxx` 既能在组件里当 hook 调,又能在组件外当 api 调(`useXxx.getState()`),**同一份引用、两副用法**,没有任何 Provider 需要包在组件树外层。store 就是一个模块级单例,谁 import 谁拿得到。

### ② `useStore` 的全部魔法:一行 `useSyncExternalStore`

```ts
useSyncExternalStore(
  api.subscribe, // 订阅函数
  () => selector(api.getState()), // 取"当前快照"
  () => selector(api.getInitialState()), // SSR 用的"服务器快照"
)
```

**`useSyncExternalStore` 是 React 18 提供给"外部 store"的官方桥**,它只做一个保证:外部 store 一变,订阅过的组件会**以 React 的方式**重新渲染,而不是各自 `forceUpdate`。为了读懂它,把 store 的通知模型放进 React 的生命周期里:

| React 侧环节 | `useSyncExternalStore` 做的事                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| 渲染时       | 调用 `getSnapshot()`(即 `selector(api.getState())`)读当前快照,并**缓存**它                                           |
| 订阅         | 用 `subscribe` 挂上监听;store 一变就触发一次"需要重渲染"的调度                                                       |
| 提交前       | React **重新调用 `getSnapshot()`**,若与缓存快照 `Object.is` 不同 → 说明渲染期间数据变了 → 丢弃本次渲染、用新快照重来 |
| 每次渲染     | 返回的 `slice` 供组件使用                                                                                            |

三个函数各有讲究:

- **`getSnapshot` 必须引用稳定**:React 会把这次快照与上次做 `Object.is`。若 store 没变但两次返回的**引用**不同,React 会认为"永远在变"而陷入无限重渲染并告警。这正是 selector 必须**返回稳定引用**的原因(见第三节);
- **`getServerSnapshot` 专供 SSR**:服务端首屏没订阅、没 store 变更,直接返回初始状态对应的切片,保证客户端 `hydrate` 前后一致;
- **订阅与取快照必须指向同一个 store 状态**:这里 `api.subscribe` 与 `api.getState` 天然同源,不会出现"订了 A 的变更、读了 B 的快照"的错配。

### ③ 为什么要包 `useCallback`?

`getSnapshot` 每次渲染都要被 React 调用,若它每次渲染都是**新函数**,不影响正确性,但 `useSyncExternalStore` 内部对快照的缓存是基于返回值而非函数。这里的 `useCallback` 主要是**保证依赖 `[api, selector]`**:`api` 永远稳定,`selector` 若由调用方用 `useCallback` 稳定传入,则 `getSnapshot` 也稳定——减少无谓重建。注意:**如果你内联写 `(s) => s.count`,selector 每次渲染都是新函数**,但因其返回的是同一快照值,仍然安全——真正必须稳定的是"返回值",不是函数本身。

## 二、为什么这套机制在 React 并发下不撕裂

React 18+ 的渲染是**可中断**的(见本仓库 [React 并发调度笔记](../react-hooks-scheduling.md)):一次更新在 Commit 前可以暂停、让位给高优任务、再回来重算。这给"外部 store + 自行订阅"的老方案埋了一个深坑:

**tearing(数据撕裂)**——组件树的不同部分各自在不同时刻去读了 store,结果 UI 里一半是新数据、一半是旧数据,彼此矛盾。经典的坏实现是:在组件里 `subscribe` 后 `setState`(强制整组件重渲染),再在渲染里 `getState()` 读值:

```tsx
// ❌ 自己订阅的老写法:渲染与订阅不是一体,并发下可能撕裂
function BadCounter() {
  const [, force] = React.useReducer((c) => c + 1, 0)
  React.useEffect(() => api.subscribe(() => force()), [])
  return <div>{api.getState().count}</div> // 渲染时去读,读到的是"当时"的 state
}
```

问题在于:React 并发渲染时,组件**渲染途中**若 store 被别处更新,读到的新旧值不可控;React 也不知道该拿哪个版本对齐。

`useSyncExternalStore` 把"读"和"订阅"收编为 React 自己的原语,从机制上消除撕裂:

1. **渲染与订阅同源**:渲染时读的快照、store 变化时触发的调度,都走 React 内部;
2. **提交前一致性检查**:渲染结束、真正上屏前,React 重读一次 `getSnapshot`;若发现渲染期间 store 又变了(快照与缓存不一致),就**丢弃这次渲染重来**,保证最终上屏的 UI 全部来自**同一个 store 版本**——绝不出现一半旧一半新。

一句话:**只要外部 store 走 `useSyncExternalStore`,React 就把它当成"渲染输入"来对齐;而 Zustand 恰好把桥建在这条原语上**,所以它在 `startTransition`、并发渲染下天然正确。这不是 Zustand 写得多聪明,是它**选对了 React 给的标准答案**。

> 对比 Vue 侧的 Pinia:Vue 没有"可中断渲染",它的 store 本身就是响应式对象,靠依赖追踪通知(见 [Pinia 内核](./pinia-core.md))。两套机制殊途同归地回答"变化如何精确到组件",本系列 [对位篇](./contrast.md) 会逐维对照。

## 三、selector 的引用稳定:重渲染粒度的命门

前面强调过"返回值引用必须稳定"。展开看三种写法:

```tsx
// ✅ 选原始值:Object.is 精确比较,count 变了才重渲染
const count = useCounter((s) => s.count)

// ✅ 选一个"未变的引用字段":store 没换引用时 s.user 是同一对象 → 稳定
const user = useCounter((s) => s.user)

// ❌ 每次渲染都 new 一个新对象/数组:Object.is 永远不等 → 死循环警告
const { a, b } = useCounter((s) => ({ a: s.a, b: s.b }))
```

第三条是 Zustand 使用者**最常踩的坑**。因为它会触发 React 的"getSnapshot 应缓存"警告并无限重渲染。正确姿势是 `useShallow`:

```tsx
import { useShallow } from 'zustand/react/shallow'
const { a, b } = useCounter(useShallow((s) => ({ a: s.a, b: s.b })))
```

`useShallow` 的源码(发行版 `esm/react/shallow.mjs`)很短,却精准解决了"多字段但引用不稳定":

```ts
function useShallow(selector) {
  const prev = React.useRef(undefined)
  return (state) => {
    const next = selector(state)
    return shallow(prev.current, next) ? prev.current : (prev.current = next)
  }
}
```

它返回一个**包装过的快照函数**:每次算出 `next` 后与上一次结果做**浅比较**(`shallow`:逐层顶层 key 用 `Object.is` 比较)。若各字段都相同 → 返回上一次的**旧引用**(稳定,React 不重渲染);若任一字段真变了 → 赋入新引用(重渲染)。于是"多字段选取"既能取到多个值,又不会因每次 new 对象而空转。

**重渲染粒度的最终结论**:Zustand 的重渲染**精确度 = selector 返回值的引用是否变化**,而这个精确度由两部分拼接而成——① React 只认引用是否 `Object.is` 相等;② selector 与 `useShallow` 负责把"没变的片段"翻译成"同一引用"。

## 四、事件处理里该用 getState,别用 hook

由于渲染读取与事件读取语境不同,还有个常见的优化纪律:

```tsx
// 事件回调里只读、不渲染:直接 getState(),避免订阅一个你根本没渲染的值
function submit() {
  const { token } = useAuth.getState() // 读一次,不订阅
  api.post('/x', { token })
}
```

在回调里**临时读**一份快照,完全不需要触发重渲染——用 `getState()` 而不进 hook,既正确又零开销。只有当某个值**要参与渲染**时才该用 selector 订阅。这是"读与订阅分离"的纪律,也是 Zustand 常用 API 手感的一部分。

## 五、为什么不需要 Provider?什么时候才要 Context?

`useBoundStore` 直接闭包持有 module 级单例 api,所以**组件树外不需要 Provider**,也绕开了 Context 的"value 一变全 Consumer 重渲染"的粗粒度(这正是 Zustand 相对 `useContext + useReducer` 的核心卖点之一)。

需要 `zustand/context`(把 store 放进 `createContext`)的典型场景只有两个:**SSR 多请求隔离**(每个请求一份 store,避免跨请求串状态)与**模块被多实例化**(如微前端里想各自独立 store)。普通 SPA 不需要。这也再次印证 Zustand 对"store 生命周期"的默认哲学:**store 跟随模块,而不是跟随组件树**。

## 六、对照问题单

- **问四(如何传导到 UI)**:vanilla 全量通知 + React 桥 `useSyncExternalStore`;**渲染粒度 = selector 返回值的引用稳定度**;`useShallow` 为"多字段但想稳定"提供浅比较缓存。无 Provider、无 Context 订阅风暴。
- **并发/撕裂**:`useSyncExternalStore` 的提交前一致性检查保证 UI 永远来自同一 store 版本,`startTransition` 下安全。
- **延伸**:selector 之外的订阅扩展(带选择器的 `subscribeWithSelector`)、把能力"插在 set 链上"的中间件,是下一篇的主题——**扩展机制恰好都长在"变更链"上**。

> 源码参考:`zustand@^5` 的 `esm/react.mjs`(即 `src/react.ts`)与 `esm/react/shallow.mjs`(即 `src/react/shallow.ts`);`useSyncExternalStore` 见 react.dev/reference/react/useSyncExternalStore。
