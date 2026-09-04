# Pinia 进阶:补丁、订阅与插件体系

> [← 返回总纲](./README.md) · 解剖问题单「问三·订阅观察 / 问五·动作钩子 / 问六·如何扩展」在 Pinia 的答案:$patch / $subscribe / $onAction / 插件

[内核篇](./pinia-core.md) 造出了那个 `reactive` 的 store,但 store 还不会"批量改、被观察、被钩子、被插件扩展"。本篇把 store 身上的能力层逐个剖开:**`$patch`(批量原子变更)、`$subscribe`(底层是 `watch`)、`$onAction`(动作钩子)、插件机制**——最后给出 setup / options 双形态的取舍与取用纪律。

## 一、$patch:一次"补丁",把多次改动折叠成一次变更

直接 `store.user.name = 'a'; store.user.age = 1` 会触发响应式的逐条通知。想**一次原子地改多个字段、且订阅方只收到一次变更**,就用 `$patch`。它有两种入参,源码里对应两个分支(发行版 `store.ts` 原样):

```ts
function $patch(partialStateOrMutator) {
  let subscriptionMutation
  isListening = isSyncListening = false // ① 补丁执行期间"静音",抑制逐条通知
  debuggerEvents = []

  if (typeof partialStateOrMutator === 'function') {
    partialStateOrMutator(pinia.state.value[$id]) // 函数式:直接改"状态桶里那个对象"
    subscriptionMutation = { type: 'patch function', storeId: $id, events: debuggerEvents }
  } else {
    mergeReactiveObjects(pinia.state.value[$id], partialStateOrMutator) // 对象式:递归深合并
    subscriptionMutation = {
      type: 'patch object',
      storeId: $id,
      payload: partialStateOrMutator,
      events: debuggerEvents,
    }
  }

  const myListenerId = (activeListener = Symbol())
  nextTick().then(() => {
    if (activeListener === myListenerId) isListening = true
  }) // ② 静音在下个 tick 解除
  isSyncListening = true
  triggerSubscriptions(subscriptions, subscriptionMutation, pinia.state.value[$id]) // ③ 只通知一次
}
```

三种写法:

```ts
store.$patch({ user: { name: 'a', age: 1 } }) // 对象式(深合并,可缺省不传)
store.$patch((state) => {
  state.user.name = 'a'
  state.items.push(x)
}) // 函数式(拿草稿直接改,推荐复杂批)
store.$state = { user: { name: 'a' }, items: [] } // 整体替换(setter 内部也是走 $patch assign)
```

读源码的三个认知:

1. **两种入参都在"原地改同一个响应式对象"**:对象式走 `mergeReactiveObjects` **递归深合并**(对嵌套纯对象逐层 merge,不是浅层;遇 `Map`/`Set` 做合并、遇 `ref`/`reactive` 直接覆盖),函数式直接调 mutator 改 `pinia.state.value[$id]`。因为改的是响应式桶里的对象,`reactive` 代理照常拦截,**逐条 set 依然发生**——但……
2. **`isListening` 静音窗把逐条通知折叠成一次**:补丁执行期间把监听标志关掉(`$subscribe` 回调里以 `isListening` 为闸),到 `nextTick` 后才放开;随后 `triggerSubscriptions` 手动只发**一次**订阅通知,并带上变更描述(`type: 'patch object' | 'patch function'`)。**从观察者角度看,$patch 是一个原子变更单元**;
3. **`$reset`(options store 专属)其实就是"用初始 state 打一次 $patch"**:`this.$patch(($state) => Object.assign($state, newState))`——所以它也被折叠成一次通知。

## 二、$subscribe:订阅的本质是一个 deep watch

store 上的所有"观察者能力"都来自 Vue 自带的 `watch`,Pinia 只是把它钉死在"store 的 state 对象"上。源码:

```ts
$subscribe(callback, options = {}) {
  const removeSubscription = addSubscription(subscriptions, callback, options.detached, () => stopWatcher());
  const stopWatcher = scope.run(() => watch(
    () => pinia.state.value[$id],                        // 观察源:整个 store 的 state(响应式对象)
    (state) => {
      // ① 用 isListening / isSyncListening 做闸:flush 非 sync 时只认"非静音期"
      if (options.flush === 'sync' ? isSyncListening : isListening)
        callback({ storeId: $id, type: 'direct', events: debuggerEvents }, state);
    },
    Object.assign({}, $subscribeOptions, options)        // ② 默认 { deep: true } + 用户选项
  ));
  return removeSubscription;
}
```

要点:

- **默认 `deep: true`(源码 `$subscribeOptions = { deep: true }`)**:store state 里任何深度字段被改都算一次订阅触发;只想在"整棵替换/`$state` 被设"时收通知,可显式 `{ deep: false }` 降噪;
- **默认 `flush: 'pre'`**:回调在**组件更新前**跑(和 Vue `watch` 默认一致),因此订阅里改 store 不会与本次渲染冲突;`flush: 'sync'` 则同步触发;
- **回调签名 `(mutation, state)`**:第一个参数是变更描述(含 `type`、`storeId`、`events`),第二个是"当时的整棵 state"。**注意回调参数与 store 本身分离**——观察的是 `pinia.state.value[$id]`,不经过组件;
- **生命周期自动绑定**:在组件 `setup` 内调用 `$subscribe` 且不传 `detached: true`,组件卸载时会随作用域自动清理(`addSubscription` 里 `onScopeDispose` 注册退订)——这是 Vue 习惯,不需手写 `onUnmounted`。

与裸 `watch(() => store.$state, cb, { deep: true })` 相比,`$subscribe` 提供的是**统一入口 + 变更元信息 + 静音折叠 + 自动清理**:多数场景用 `$subscribe` 更省心,`watch` 更灵活。

## 三、$onAction:动作钩子,靠"建店时包一层"实现

`$onAction(cb)` 让你在**每次 action 被调用前后**插钩子——做埋点、loading、审计。它不靠响应式,靠的是内核篇见过的那一步:**建店时每个函数都被 `action()` 包装器包过**。包装器源码:

```ts
const action = (fn, name = '') => {
  const wrappedAction = function () {
    setActivePinia(pinia)
    const args = Array.from(arguments)
    const afterCallbackSet = new Set(),
      onErrorCallbackSet = new Set()
    const after = (cb) => afterCallbackSet.add(cb) // 注册"成功后回调"
    const onError = (cb) => onErrorCallbackSet.add(cb) // 注册"出错后回调"
    triggerSubscriptions(actionSubscriptions, { args, name, store, after, onError }) // ① 调用前先广播
    let ret
    try {
      ret = fn.apply(this && this.$id === $id ? this : store, args)
    } catch (error) {
      // ② this 稳定指向 store
      triggerSubscriptions(onErrorCallbackSet, error)
      throw error
    }
    if (ret instanceof Promise) {
      // ③ 异步结果挂到 after / onError
      return ret
        .then((v) => {
          triggerSubscriptions(afterCallbackSet, v)
          return v
        })
        .catch((e) => {
          triggerSubscriptions(onErrorCallbackSet, e)
          return Promise.reject(e)
        })
    }
    triggerSubscriptions(afterCallbackSet, ret) // 同步也补发一次 after
    return ret
  }
  wrappedAction[ACTION_MARKER] = true
  wrappedAction[ACTION_NAME] = name
  return wrappedAction
}
// $onAction = addSubscription.bind(null, actionSubscriptions)
```

生命周期一眼看穿:

| 时机                     | 触发内容                                                               |
| ------------------------ | ---------------------------------------------------------------------- |
| action **执行前**        | 所有 `$onAction` 回调被调,收到 `{ name, args, store, after, onError }` |
| 成功(同步或异步 resolve) | 各自注册的 `after(result)` 回调执行                                    |
| 抛错(同步或异步 reject)  | 各自注册的 `onError(error)` 回调执行,异常原样向上抛                    |

用法:

```ts
const unsub = useUser().$onAction(({ name, args, after, onError }) => {
  console.log(`action ${name} 开始`, args)
  after((result) => console.log(`action ${name} 成功`, result))
  onError((err) => console.error(`action ${name} 失败`, err))
})
```

两个设计细节值得记:

1. **action 与普通函数的边界在建店时固化**:setup 返回值里的函数被包装并登记为 action(`ACTION_MARKER`),store 属性里的非函数原样保留——这就是"哪些算 action"的判定点;
2. **`this` 永远指向 store**:`wrappedAction` 用 `this?.$id === $id ? this : store` 兜底,因此**即使你把 action 解构出来裸调 `const { add } = store; add()`,`this` 仍是 store**,内部访问其它 state/action 不会断。

## 四、插件:扩展点是"store 创建时注入",不是"变更链"

内核篇里创建流程的尾巴是插件 loop(源码):

```ts
pinia._p.forEach((extender) => {
  const extensions = scope.run(() =>
    extender({
      store,
      app: pinia._a,
      pinia,
      options: optionsForPlugin,
    }),
  )
  for (const key in extensions) {
    const value = extensions[key]
    // 若返回的是普通对象(非 ref/reactive),Pinia 4 会打诊断警告:
    // "store 上新增的这个属性将不具响应性" —— 想要响应式就得返回 ref/reactive
    Object.assign(store, extensions) // 返回的键全部摊到 store 上
  }
})
```

插件签名 `pinia.use(({ store, app, pinia, options }) => { …; return { …新属性 } })`,在**每个 store 创建完成时**执行一次。可做的事:

```ts
// 加全局能力
pinia.use(({ store }) => {
  store.$notify = (msg) => toast(msg) // 挂工具方法(函数,不必响应式)
})
// 包装 action(埋点):options.actions 里能看到所有 action 名
pinia.use(({ store, options }) => {
  for (const key of Object.keys(options.actions)) {
    const original = store[key]
    store[key] = (...args) => {
      track(key)
      return original.apply(store, args)
    }
  }
})
// 每 store 挂一个自增 id
pinia.use(({ store }) => {
  store.$idSuffix = `#${++counter}`
}) // 需要响应式则返回 ref
```

**为什么叫"插件"而不是"中间件"?** 这是与 Zustand 最直观的分野:

|          | Zustand 中间件                          | Pinia 插件                             |
| -------- | --------------------------------------- | -------------------------------------- |
| 扩展时机 | `create` **之前/之中**,改写 `set`/`api` | store **创建完成之后**,往 store 加属性 |
| 干预对象 | **变更链**(set 的流向)                  | **store 对象本身**(能力面)             |
| 例子     | persist 写盘 / immer 改 draft           | 挂 `$notify`、包 action 埋点           |
| 哲学     | "替 store 换零件"                       | "给 store 贴插件"                      |

> 记忆:`create(persist(...))` 是**在制造变更链时**插入工序;`pinia.use(...)` 是**在每个 store 出生后**拍扩展。一个横切"状态怎么流",一个纵切"store 会什么"。

此外 devtools 也是插件——`createPinia()` 里 `pinia.use(devtoolsPlugin)` 默认注入(客户端),所以 store 一建就有 DevTools 可看。

## 五、双形态:options store vs setup store

|       | options store(选项式)                                                | setup store(组合式)                                           |
| ----- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| 写法  | `{ state, getters, actions }` 三段式                                 | 一个 setup 函数,返回 `ref / computed / 函数` 混合             |
| 本质  | 内核篇说过:**被编译成一个 setup**                                    | 引擎**原生**形态,options 是它的语法糖                         |
| state | 统一放 `pinia.state.value[id]`,**可被 `$state` 整体替换 / `$reset`** | 想重置得自己写个 `$reset` action(setup store 无内置 `$reset`) |
| 类型  | 靠 `state()` 返回值推导                                              | 完全 TS 推导、可自由引入外部 ref/composable                   |
| 适用  | 纯状态集中、Options API 项目                                         | 想混合"store + 外部响应式/composable"、复用逻辑               |

```ts
// setup store:状态可以是"本地 ref",也能把组件里抽出来的逻辑 ref 并进来
export const useCount = defineStore('count', () => {
  const count = ref(0)
  const double = computed(() => count.value * 2)
  function inc() {
    count.value++
  }
  return { count, double, inc } // 引擎按类型分流:ref→state、computed→getter、函数→action
})
```

取用时有一个**经典坑**:直接解构会丢响应性。由于 store 是 reactive 代理,读 `store.count` 时 ref 会被自动解包成原始值,解构后拿到的是"那一刻的值":

```ts
const { count, double } = useCount() // ❌ count 是数字快照,不再响应
const { count, double } = storeToRefs(useCount()) // ✅ 得到真正的 Ref/ComputedRef
const { inc } = useCount() // ✅ 函数解构安全(this 已被包装器兜底)
```

## 六、对照问题单

- **问三(如何"读")**:store 直接读即响应;`storeToRefs` 提供可解构的 ref;getter 缓存见内核篇。
- **问五(异步与钩子)**:action 内可直接 `await`;`$onAction` 的 `after` 能接住异步结果,**挂在 action 完成线上的钩子可用来做"请求结束清 loading"这类时序编排**——乱序防护则回到业务层(如请求序号比对),Pinia 不代为解决。
- **问六(如何扩展)**:插件在 store 创建时注入属性,配 devtools 插件默认随 `createPinia` 装配。

到这儿,Pinia 的能力层也拆完了。两套引擎、同一张解剖问题单——**是时候把它们并排摆开,逐维对照,并回答"我该用哪个"了**:见 [对位:双引擎对照与选型](./contrast.md)。

> 源码参考:`pinia@^4.0` 的 `src/store.ts`($patch / $subscribe / action 包装器 / 插件 loop)、`src/subscriptions.ts`;行为以 pinia.vuejs.org 文档为准。
