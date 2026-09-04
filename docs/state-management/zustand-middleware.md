# Zustand 扩展:中间件——一切能力都长在"变更链"上

> [← 返回总纲](./README.md) · 解剖问题单「问六·如何扩展」在 Zustand 的答案:持久化 / immer / DevTools / 带选择器订阅,如何靠"重写 set 与 api"实现

Zustand 核心刻意保持 20 行,那持久化、immer、DevTools、时间旅行这些能力从哪来?答案全在**中间件**。上一章内核里留了一个伏笔:`createState(set, get, api)` 的 `api` 在初始化**之前**就建好了——中间件正是钻了这个空子:**在建 store 的瞬间,先把 `set` 和 `api` 换掉,再放行给配置函数**。看懂这一篇,你就能自己写出任何"在状态变更前后插一脚"的能力。

## 一、中间件的本质:config 变换,不是洋葱

Redux 的 middleware 是**洋葱模型**——action 依次穿过外层到内层再返回,层层包着 `dispatch`。Zustand 的中间件是另一回事,它是一个**变换器**,签名很统一:

```ts
// 中间件形状:接收一个 config(即 createState 那个初始化函数),
// 返回一个"替换过的 config",但在此之前可以改写 set / api
const myMiddleware = (config) => (set, get, api) => {
  // 1. 在这里改写 api / set(可选)
  // 2. 把(可能被改写的)set、api 交给真正的 config
  return config(modifiedSet, get, modifiedApi)
}
```

而 `createStoreImpl` 的收尾是 `state = createState(setState, getState, api)`——**中间件就是夹在"api 建好"与"config 真正执行"之间的一道改写层**。于是三种"插眼"全部可行:

| 想做的事                                            | 手段                                                      |
| --------------------------------------------------- | --------------------------------------------------------- |
| 每次 set 之后追加副作用(如写 storage)               | 把传下去的 `set` 包一层                                   |
| 让所有更新都过某道转换(如 immer 的 draft)           | **替换 `api.setState`**(外部的 `store.setState` 会走到它) |
| 在 api 上挂新能力(如 `api.persist`、`api.dispatch`) | 直接往 `api` 加字段                                       |
| 让"直接改 state"也能被感知                          | 把 `api.setState` 换成能转换 updater 的版本               |

下面用三个真实中间件各验证一种手法。

## 二、immer:替换 setState,把"不可变"翻译成"可变手感"

源码(发行版 `esm/middleware/immer.mjs`)短到可以整段贴:

```ts
const immerImpl = (initializer) => (set, get, store) => {
  store.setState = (updater, replace, ...args) => {
    const nextState = typeof updater === 'function' ? produce(updater) : updater
    return set(nextState, replace, ...args)
  }
  return initializer(store.setState, get, store) // 注意:把替换后的 setState 当 set 传给 config
}
export const immer = immerImpl
```

手法非常清晰:

1. **`produce(updater)`**:`updater` 是用户写的"拿 draft 直接改"的函数(如 `(draft) => { draft.user.name = 'x' }`);`immer` 的 `produce` 基于**结构共享**返回一份新的不可变对象,未改动的子树保持原引用(这正好让 React 侧 selector 的引用比较依然高效);
2. **替换 `store.setState`**:此后一切 `useStore.setState((draft) => {...})` 都先过 `produce`;
3. **把替换后的函数当 `set` 传给 config**:config 里所有 action 里的 `set` 也会自动获得 draft 手感。

于是用法变成:

```ts
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

const useUser = create(
  immer((set) => ({
    user: { name: 'a', tags: [] },
    rename: (name) =>
      set((draft) => {
        draft.user.name = name
      }), // 可变了!
    addTag: (t) =>
      set((draft) => {
        draft.user.tags.push(t)
      }),
  })),
)
```

**启示**:Zustand 默认的"浅合并不可变"并不是教条,而是"内核对对象语义的零干预";想要可变体验,用中间件在 `setState` 层做转换即可——**内核的简洁换来的是扩展点清晰**。

## 三、persist:替换 set + 挂 api.persist + 异步水合

persist 要做的比 immer 多:**每次 set 后把状态写入 storage、store 创建时从 storage 读回(水合)**。它的源码结构(发行版 `esm/middleware.mjs`)可以拆成三层看。

### 3.1 先看"写"的一半:两次 setState 包装

```ts
const savedSetState = api.setState
api.setState = (state, replace) => {
  savedSetState(state, replace)
  return setItem() // ① 每次外部 setState → 落盘
}
const configResult = config(
  (...args) => {
    set(...args)
    return setItem()
  }, // ② 传给 config 的 set 也被包装 → action 里 set 也落盘
  get,
  api,
)
```

`setItem()` 负责把"当前状态的一部分"写成带版本的封套:

```ts
const setItem = () => {
  const state = options.partialize({ ...get() }) // partialize:只挑要持久化的字段(默认全量)
  return storage.setItem(options.name, { state, version: options.version }) // 封套 {state, version}
}
```

所以**只要任何一处 set(外部 setState 或 action 内 set)发生,都会同步写一次 storage**。`partialize` 让你只落部分字段(比如把大列表排除、只存会话),`options.name` 是 storage 的 key。

### 3.2 再看"读"的一半:异步水合(store 创建即触发)

```ts
const hydrate = () => {
  // ...
  return toThenable(storage.getItem.bind(storage))(options.name)
    .then((stored) => {
      // 版本不符 → 走 options.migrate(迁移)…
      return [migrated, migratedState]
    })
    .then(([migrated, migratedState]) => {
      stateFromStorage = options.merge(migratedState, get()) // merge:新旧状态如何拼(默认 {...当前, ...持久化})
      set(stateFromStorage, true) // 整体替换式写入(第二个参数 true)
      if (migrated) return setItem() // 迁移过就再落一次盘
    })
    .then(() => {
      /* 标记 hasHydrated,触发 onFinishHydration 回调 */
    })
  // ...
}
if (!options.skipHydration) hydrate() // 默认建 store 就异步读回
```

要点:

- **默认每次创建 store 就 `hydrate()` 一次**(除非 `skipHydration`),因为要尽早把 localStorage 数据并进内存;
- 它是**异步**的(storage 读取走 Promise),所以首帧渲染时可能还没水合完——这就是为什么会有 `useUser.persist.hasHydrated()` 配合一个"水合完成再显示"的门槛;
- `options.merge` 决定新旧拼法,`version` + `options.migrate` 负责跨版本数据结构迁移;
- persist 还会在 api 上挂一个 **`api.persist`** 命名空间:`setOptions / clearStorage / rehydrate / hasHydrated / onFinishHydration`,供运行时手动控制。

**手法验证**:persist 同时用了"换 set 追加写盘"(①②)与"往 api 挂能力名空间",再加一个异步水合流程。

## 四、subscribeWithSelector:重写 subscribe,给订阅加选择器

vanilla 的 `subscribe` 只会收到"新/旧整棵树"。`subscribeWithSelector` 把 `api.subscribe` 重写成支持 `(selector, listener, options)` 的形态:

```ts
api.subscribe = (selector, optListener, options) => {
  let listener = selector
  if (optListener) {
    const equalityFn = options?.equalityFn || Object.is
    let currentSlice = selector(api.getState())
    listener = (state) => {
      const nextSlice = selector(state)
      if (!equalityFn(currentSlice, nextSlice)) {
        // 只有选中的片段变了才回调
        const previousSlice = currentSlice
        optListener((currentSlice = nextSlice), previousSlice)
      }
    }
    if (options?.fireImmediately) optListener(currentSlice, currentSlice)
  }
  return origSubscribe(listener) // 底层仍是那一个 Set
}
```

于是框架外也能精准订阅单个字段:

```ts
import { subscribeWithSelector } from 'zustand/middleware'
const api = createStore(subscribeWithSelector((set) => ({ count: 0, name: 'a' })))
api.subscribe(
  (s) => s.count,
  (count, prev) => console.log('count 变了', count),
)
```

**手法验证**:重写 api 方法、内部复用原始逻辑(origSubscribe)、把"选择 + 过滤"嵌进订阅层。这套 API 恰好也是 React 桥里"selector"思想在 vanilla 侧的镜像。

## 五、devtools:接 Redux DevTools 协议,时间旅行"白得"

Zustand 没有自带 DevTools,而是**复用 Chrome 的 Redux DevTools 扩展协议**(Redux 生态遗留的最大财富)。`devtools` 中间件干三件事:

1. **替每次 set 发一个 action**:重写 `api.setState`,先执行原 set,再 `connection.send({ type: '名字' }, get())` 把变更同步给扩展。action 名取 `set` 的第三个参数,没传就用 `findCallerName(new Error().stack)` 从**调用栈猜调用方函数名**;
2. **监听扩展下发的命令**:订阅 connection,处理 `RESET / COMMIT / ROLLBACK / JUMP_TO_STATE / JUMP_TO_ACTION / IMPORT_STATE`(时间旅行的核心)——收到就 `setStateFromDevtools(...)` 把 store 直接设到某个历史态;
3. **防回声**:执行 DevTools 下发的设置时置 `isRecording = false`,不把"自己造成的变化"再回传,避免死循环;另保留 `__setState` 为扩展直接注入 state 的保留 action。

多 store 时用 `devtools(fn, { name: '全局名', store: '本店名' })`,配合扩展的"tracked connections"把多个 store 汇聚到一棵树上,时间旅行即可在它们之间联动。

> 关键认知:**Redux DevTools 协议是"外部 store"的通用调试接口**,Zustand 只是接入了它。DevTools 不是哪一家的,是协议赢的——这解释了为什么 Zustand / Pinia / Redux 全都能用同一个扩展。

## 六、组合与顺序:中间件是嵌套的变换器

写 `create(persist(immer((set) => …)))` 时,中间件**从外到内依次执行各自的 `(set,get,api)=>…` 包装段**,再**从内到外**把改写结果层层交还:

```
create(persist(immer(config)))
  persist 先拿到的 set = 内核原装 set
  persist 包出"落盘版 set"传给 immer
  immer 再把"落盘版 set"换成"produce 版"
  → 最终 config 里 set = produce + 落盘,一次 set 走完整条链
```

因此**顺序有语义**:想"变更先过 immer 再落盘",就要把 persist 放外层、immer 放内层(如上)。读 `create(persist(immer(...)))` 时,记住**从右往左是变更的实际流向**。

## 七、对照问题单

- **问六(如何扩展)**:Zustand 的扩展点是**中间件 = config 变换**——在 `set` / `api.setState` / `api.subscribe` / `api` 命名空间四个位置任选改写,即实现 persist / immer / devtools / subscribeWithSelector / redux / combine / ssrSafe 等能力。
- 与 Redux middleware 的区别:Redux 是**包在 dispatch 外的洋葱**(异步流、action 拦截);Zustand 是**建店时的 set 变换**——更扁、更像"替换零件",而非"层层传递"。这个差异在[对位篇](./contrast.md)会进一步和 Pinia 的插件体系对照。

**Zustand 引擎到此封箱**:内核存与通知(20 行)→ React 桥用 `useSyncExternalStore` 精确传导(20 行)→ 中间件在 set 链上长出全部能力。三件套加起来没几百行,却覆盖了解剖问题单的一到六问里的 React 半场。

**下一半场交给 Pinia**:同一个 store 心智,换到 Vue 响应式引擎上,`getter` 为什么能自动缓存、store 为什么是 `reactive`、扩展为什么叫"插件"而不是"中间件"——见 [Pinia 内核:与 Vue 响应式结合](./pinia-core.md)。

> 源码参考:`zustand@^5` 的 `esm/middleware.mjs`(即 `src/middleware.ts`)与 `esm/middleware/immer.mjs`(即 `src/middleware/immer.ts`)。
