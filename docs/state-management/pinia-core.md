# Pinia 内核:与 Vue 响应式系统的结合

> 解剖问题单在 Pinia 的答案:store 为什么是 `reactive`、getter 为什么自动缓存、为什么必须 `app.use(pinia)`。· [← 返回总纲](./README.md)

Zustand 自己写"存 + 订阅",再用 `useSyncExternalStore` 接进 React。Pinia 走另一条路:**几乎不自己写"变更如何通知 UI"**——把状态做成 **Vue 的响应式对象**,把"谁读了、谁该更新"**整个外包给 Vue**。

读 Pinia 内核前先要有一张 Vue 响应式地图:① Vue 响应式最小内核 → ② `createPinia`(全局底座)→ ③ `defineStore`(惰性建店)→ ④ `createSetupStore`(引擎本体)。

## 一、Vue 3 响应式最小内核:track / trigger / effect

**Vue 不靠订阅列表,靠"读取时记录、写入时通知"**:读响应式对象时记下"谁在读",改它时通知"刚才在读的人"。

```
reactive(obj)  用 Proxy 包对象:get → track(target, key)  // 读取时登记当前 effect
                              set → trigger(target, key)  // 写入时触发已登记的 effect
effect(fn)     立刻执行 fn,执行期间所有 track 都登记到"当前这个 effect"上
               依赖表 ≈ Map<对象, Map<key, Set<effect>>>
```

追一层:

- **`ref`** 包装原始值/对象成 `{ value }`,`reactive` 处理对象内部;
- **`computed(fn)`** 是"带缓存的 effect":内部跑惰性 effect 做依赖追踪,`value` 首次读取才求值并缓存;依赖一变置脏,下次读取重算——**缓存自动、失效自动、按需重算**;
- **`effectScope(scope)`** 把一组 effect 收进一个"作用域",可整体 `stop()`(Pinia 用它做单 store 销毁);
- **`watch(source, cb, { deep, flush })`** 在 effect 之上加"源变化→回调"语义,`flush: 'pre'` = 组件更新前跑、`'sync'` = 同步跑。

这套系统有 Zustand 完全没有的特性:**"通知粒度"由依赖追踪自动给出**。组件/`computed` 只读了 `obj.a`,只有 `a` 变化才让它重算;从不读 `b`,`b` 怎么变都与它无关。没有 selector、没有手动订阅——**精准是响应式系统白送的**。Pinia 的引擎就是"怎么把 store 做成这样一组响应式对象"。

> 概念示意,非 Vue 源码;深读见 vuejs.org 的"深入响应式系统"。后面会看到 Pinia 每个机制都踩在这四个原语上。

## 二、createPinia:一个"响应式状态桶 + 插件清单"的底座

`pinia@4` 的 `createPinia()`(源码原样):

```ts
function createPinia() {
  const scope = effectScope(true) // ① 脱离组件的 effect 作用域
  const state = scope.run(() => ref({})) // ② 全局状态桶:ref({}) 的 value 是个普通对象
  let _p = [],
    toBeInstalled = []
  const pinia = markRaw({
    install(app) {
      setActivePinia(pinia) // ③ 设为"当前激活"实例
      pinia._a = app
      app.provide(piniaSymbol, pinia) // ④ 组件树可注入
      app.config.globalProperties.$pinia = pinia
      if (IS_CLIENT) registerPiniaDevtools(app, pinia)
      toBeInstalled.forEach((p) => _p.push(p)) // 安装前挂的插件入列
      toBeInstalled = []
    },
    use(plugin) {
      if (!this._a) toBeInstalled.push(plugin)
      else _p.push(plugin)
      return this
    },
    _p, // 插件列表
    _a: null, // app 实例
    _e: scope, // 全局 effect scope
    _s: new Map(), // ★ store 注册表: id → store
    state, // 响应式状态桶 ref({})
  })
  if (IS_CLIENT) pinia.use(devtoolsPlugin) // 客户端默认挂 devtools 插件
  return pinia
}
```

四个关键点:

1. **`state = ref({})` 是唯一的全局内存**:`pinia.state.value` 以 store id 为 key:`{ user: {…}, cart: {…} }`。每个 store 的**状态本体最终都挂进这个对象**(`createSetupStore` 做 `pinia.state.value[$id][key] = prop`)。这是序列化/调试/DevTools 统一入口,也解释了 Pinia 为何**默认深度响应式 + 可整体观测**;
2. **`_s: Map<id, store>` 是注册表**:store 建好后登记于此,`useStore()` 查它拿单例。用 `Map`,store id 可为任意字符串;
3. **provide/inject 解决"store 属于哪个应用"**:`app.use(pinia)` 触发 `install`,`app.provide(piniaSymbol, pinia)` 下发给组件树。组件里调 `useUserStore()` 不传参数也从注入解析到 pinia,且**不同 app 实例可有各自独立的 store 集合**——"为什么必须 `app.use(pinia)`"的答案;
4. **`effectScope(true)` 提供全局销毁开关**:`disposePinia` 只需 `pinia._e.stop()` 停掉桶里所有 effect(测试与多实例场景)。

## 三、defineStore:只负责"懒"——真正建店在第一次 useStore()

`defineStore` 不创建 store,返回一个 **useStore 函数**;store 在**第一次调用 useStore() 时才创建**(惰性):

```ts
function defineStore(id, setup, setupOptions) {
  const isSetupStore = typeof setup === 'function' // 双形态判定
  const options = isSetupStore ? setupOptions : setup

  function useStore(pinia, hot) {
    const hasContext = hasInjectionContext()
    pinia = pinia || (hasContext ? inject(piniaSymbol, null) : null) // ① 组件内走注入
    if (pinia) setActivePinia(pinia)
    if (!activePinia) throw new Error(/* 没先 app.use(pinia) 的报错 */)
    pinia = activePinia
    if (!pinia._s.has(id)) {
      // ② 只在首次建一次
      if (isSetupStore) createSetupStore(id, setup, options, pinia)
      else createOptionsStore(id, options, pinia)
    }
    return pinia._s.get(id) // ③ 之后每次返回同一个单例
  }
  useStore.$id = id
  return useStore
}
```

关键行为:

- **resolve pinia 的优先级**:显式传入的 pinia → 组件上下文 `inject(piniaSymbol)` → 全局 `activePinia`。`setActivePinia` 在真正建店前被设好,保证嵌套 createOptionsStore 时 getter 取到正确 pinia;
- **"用了才建、建一次永复用"**:同一 id 只 `createSetupStore` / `createOptionsStore` 一次,之后 `_s.get(id)` 直达单例——**Pinia 单例语义的实现位置**;
- **双形态判定在 defineStore 就定**:传函数 = **setup store**(更底层),传 options 对象 = **options store**(语法糖,见下节);
- 报错直白提示:组件外用 store 前要保证有激活的 pinia(测试里 `setActivePinia(createPinia())`,或先 `app.use(pinia)`)。

## 四、options store:其实是被"编译成 setup store"的语法糖

`defineStore('id', { state, getters, actions })` 的 options 形态,在内部被 `createOptionsStore` 翻译成 setup:

```ts
function createOptionsStore(id, options, pinia, hot) {
  const { state, actions, getters } = options
  const initialState = pinia.state.value[id]
  let store
  function setup() {
    if (!initialState && !hot) pinia.state.value[id] = state ? state() : {} // 首次:把 state() 结果挂进状态桶
    const localState = toRefs(pinia.state.value[id]) // 每个顶层字段变 ref
    return Object.assign(
      localState,
      actions,
      Object.keys(getters || {}).reduce((computedGetters, name) => {
        computedGetters[name] = markRaw(
          computed(() => {
            // ★ getter → computed
            setActivePinia(pinia)
            const store = pinia._s.get(id)
            return getters[name].call(store, store) // this 与首个参数都是 store
          }),
        )
        return computedGetters
      }, {}),
    )
  }
  return (store = createSetupStore(id, setup, options, pinia, hot, true)) // 交还引擎
}
```

三个信息量大的点:

1. **`state()` 只在首次被调**并整体挂进 `pinia.state.value[id]`;因那是响应式桶里的对象,**嵌套天然被 Vue 深度代理**——Pinia 状态"默认深度响应式"的来源;
2. **`toRefs`** 把状态对象顶层每字段变成独立 ref(解构后仍响应),这是 `mapState`、模板里 `...storeToRefs()` 能工作的底层;
3. **getter 包成 `computed`,`this` 与参数都是 store**:getter 里 `this.doneCount` / 传参 getter `getters.xxx(store)` 都成立;`computed` 的"惰性 + 缓存 + 依赖失效"直接**白送** getter 缓存——同一 getter 在多次渲染间不重复计算,依赖变了才重算。**这是 Pinia getter 与 Zustand selector"每次现算"的根本差异**。options store 本质是把三段声明"编译"成一个 setup 函数交给引擎。

## 五、createSetupStore:引擎本体

options store 最后也汇入这里。`createSetupStore`(核心片段)同时接受手写 setup store 与编译来的 options setup:

```ts
function createSetupStore($id, setup, options, pinia, hot, isOptionsStore) {
  // ……$subscribe / $patch / $dispose 的偏函数(进阶篇展开)……
  const partialStore = {
    _p: pinia,
    $id,
    $onAction: addSubscription.bind(null, actionSubscriptions),
    $patch,
    $reset,
    $subscribe,
    $dispose,
  }
  // ★ 关键 1:store 本体就是一个 reactive 对象
  const store = reactive(
    Object.assign({ _hmrPayload, _customProperties: markRaw(new Set()) }, partialStore),
  )
  pinia._s.set($id, store) // ★ 先注册,好让 setup 期间就能 self-reference

  // ★ 关键 2:在"独立 effectScope"里跑 setup,产出 setupStore
  const setupStore = ((pinia._a && pinia._a.runWithContext) || fallbackRunWithContext)(() =>
    pinia._e.run(() => (scope = effectScope()).run(() => setup({ action }))),
  )

  // ★ 关键 3:按类型把 setupStore 的返回值分类收编
  for (const key in setupStore) {
    const prop = setupStore[key]
    if ((isRef(prop) && !isComputed(prop)) || isReactive(prop)) {
      // state:若非 options store,逐个挂进全局桶 → 可观测、可水合、可被 $subscribe deep 侦测
      if (!isOptionsStore) pinia.state.value[$id][key] = prop
      _hmrPayload.state.push(key)
    } else if (typeof prop === 'function') {
      setupStore[key] = hot ? prop : action(prop, key) // 函数 → 包成 action(进阶篇展开)
    } else if (isComputed(prop)) {
      _hmrPayload.getters[key] = isOptionsStore ? options.getters[key] : prop // computed → getter
    }
  }
  Object.assign(store, setupStore) // 把 state/getters/actions 全摊到 store 上
  Object.assign(toRaw(store), setupStore)
  // store.$state 的 getter/setter
  // ……插件执行 loop(进阶篇)……
  return store
}
```

引擎的四条脊柱:

1. **store 是 `reactive(…)` 代理**:组件里 `store.count`、模板里 `store.user.name` 都是**经过依赖追踪的读**——读时当前渲染 effect 被登记;改时 Vue 只重算真正读了的组件与 getter。**这是"Pinia 不需要 selector"的总根源**;
2. **先 `_s.set` 再跑 setup**:注册先于 setup 执行,options store 的 getter 里 `pinia._s.get(id)` 能拿到"正在创建中的自己"(getter 可依赖自身状态/其他 getter);
3. **独立 `effectScope` 包住每个 store**:`scope = effectScope().run(() => setup())`——store 内所有 `computed`/`watch` effect 收进该作用域,`store.$dispose()` 只需 `scope.stop()` 就**连同订阅整组清理**;
4. **setup 返回值按类型分流**:ref/响应式对象 → **state**,函数 → **action**(被 `action()` 包装,服务 `$onAction`),`computed` → **getter**。state 收进全局桶、action 统一包装、getter 登记——**options 三件套与 setup 形态自此同构**,Pinia 能同时支持两种写法的原因。

再回看 options store 的 setup 返回 `toRefs(...) + actions + getters-computed`:state 字段是 `ref`,`computed` 字段带 effect、函数是 action——正好被上面的分流对号入座。

## 六、一条最小完整链路

```ts
import { createApp } from 'vue'
import { createPinia, defineStore } from 'pinia'

const pinia = createPinia() // ① 造底座(状态桶 ref({}) + _s Map + scope)
app.use(pinia) // ② install:provide + setActivePinia + 挂 devtools

export const useUser = defineStore('user', {
  // ③ 只声明,不建店
  state: () => ({ name: 'a', score: 0 }),
  getters: { double: (s) => s.score * 2 }, // ④ computed:缓存 + 依赖失效自动
  actions: {
    add() {
      this.score++
    },
  }, //   直接改响应式 state → 自动通知
})
```

- 组件里 `useUser()` → 注入 pinia → 首次建 store(`reactive` 对象 + 状态进桶)→ 返回单例;
- 模板读 `user.score` → 依赖登记;某处 `user.add()`(`this.score++`,命中 `reactive` 的 set)→ **只有读了 score 的渲染位重算**——全程没有一行手写订阅。

## 速查

| 解剖问题     | Pinia 内核答案                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 问一·存哪    | store 是 `reactive` 普通对象;state 字段统一收进 `pinia.state.value[id]`(全局响应式桶);整桶可观测、可 `$state` 替换、可序列化                       |
| 问二·怎么变  | 直接赋值/`++`(响应式代理拦截)即可;批量用 `$patch`;没有"reducer"这一步                                                                              |
| 问四·传导 UI | 不写订阅——靠 **Vue 依赖追踪**,读到即登记、改动即通知,**粒度精确到属性**(与 Zustand 的"Set 订阅 + selector 筛选"两条路线,见[对位篇](./contrast.md)) |
| 问三·派生    | getter = `computed`,自带缓存与依赖失效(首次读到才算),不必像 selector 担心引用稳定                                                                  |

> 源码参考:`pinia@^4.0` 的 `packages/pinia/src/{rootStore.ts, createPinia.ts, store.ts, defineStore.ts}`(发行版 `dist/pinia.esm-browser.js` 一致);Vue 响应式见 vuejs.org。下一篇:[Pinia 进阶:$patch / $subscribe / 插件](./pinia-advanced.md)。
