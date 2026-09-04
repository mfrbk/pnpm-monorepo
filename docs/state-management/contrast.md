# 对位:双引擎对照与选型

> 把前几章两份源码答案并排逐维比对;把两主角放回谱系,回答"我该用哪个"。· [← 返回总纲](./README.md)

## 一、同一业务,两份写法

```tsx
// React + Zustand
import { create } from 'zustand'
const useCount = create((set) => ({
  count: 0,
  double: 0, // ← 派生态要自己维护,或每次 selector 现算
  inc: () => set((s) => ({ count: s.count + 1 })),
}))
function View() {
  const count = useCount((s) => s.count) // 订阅 + 选择器
  return <button onClick={() => useCount.getState().inc()}>{count}</button>
}
```

```ts
// Vue + Pinia
import { defineStore } from 'pinia'
export const useCount = defineStore('count', {
  state: () => ({ count: 0 }),
  getters: { double: (s) => s.count * 2 }, // ← 派生是声明式的,自动缓存
  actions: {
    inc() {
      this.count++
    },
  }, // ← 直接改,响应式自动通知
})
// <button @click="count.inc()">{{ count.double }}</button>  模板里读即订阅
```

`defineStore` / `create`、`state` / `getters` / `actions`——心智几乎重叠,背后是两种完全不同的引擎。

## 二、全维度对照表

| 解剖问题         | Zustand                                                                                     | Pinia                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **运行环境**     | vanilla 内核**零框架依赖**,React/Vue/Node 通吃;React 是加的一层桥                           | 深度绑定 Vue 3(`reactive/ref/effectScope/watch` 全 import 自 vue),只为 Vue 而生           |
| **状态容器**     | 闭包里的**普通对象**,`getState()` 取快照引用                                                | store 本体是 **`reactive` 代理**;state 字段统一收进 `pinia.state.value[id]`(全局响应式桶) |
| **深度响应式**   | 无。改深层字段要自己展开或用 immer 中间件                                                   | **默认深度响应式**:嵌套字段直接改即被侦测                                                 |
| **更新方式**     | `setState(partial \| fn, replace?)`,默认**浅合并换引用**;整体替换可选                       | 直接赋值/`++`,批量用 `$patch`(深合并或函数草稿);`$state` 可整体替换                       |
| **更新拦截点**   | 中间件**替换 `set` / `api.setState`**,改的是"变更流向"                                      | `reactive` 代理 + `$patch` 静音窗;改动天然被响应式捕获                                    |
| **派生/读**      | **selector 每次现算**,靠引用稳定 + `useShallow` 抑制无谓重渲染;无缓存                       | **getter = `computed`**:惰性求值、自动缓存、依赖变了自动失效                              |
| **渲染绑定** ⭐  | `Set` 全量通知 + React 桥 `useSyncExternalStore`;**渲染粒度 = selector 返回值引用是否变化** | **Vue 依赖追踪**:读 store 属性即登记,"谁读了谁被通知",**粒度精确到属性**,无 selector      |
| **并发渲染安全** | `useSyncExternalStore` 提交前一致性检查 → 无 tearing                                        | Vue 无"可中断渲染",不存在 tearing 问题                                                    |
| **store 定位**   | 模块级单例,无 Provider;SSR/多实例才需 `zustand/context`                                     | 经 `app.use(pinia)` provide;组件内 `useStore()` 靠注入解析实例,支持每 app 一套            |
| **订阅观察**     | `subscribe` 收(新,旧)整树;配 `subscribeWithSelector` 精准订阅                               | `$subscribe` 底层是 `watch(deep)`;`$patch` 折叠成一次通知;自动随组件卸载清理              |
| **动作钩子**     | 无内建;靠中间件在 set 链上加                                                                | `action()` 包装 + `$onAction` 提供调用前/成功/失败钩子                                    |
| **扩展机制**     | **中间件**:建店时改写 set/api(config 变换)                                                  | **插件**:store 创建后注入属性;devtools 默认插件                                           |
| **时间旅行调试** | `devtools` 中间件接入 Redux DevTools 协议                                                   | devtools 插件接入同一协议                                                                 |
| **TypeScript**   | 推导强,`create<T>()` 套路少样板                                                             | options/setup 双形态推导强;`defineStore` 泛型                                             |
| **框架外使用**   | 第一公民(本来就是 vanilla store)                                                            | 可(setActivePinia)但要先造/激活 pinia                                                     |

## 三、为什么"长得像"却"内核岔开"

像,因为同属 **"扁平 store 派"**:都出生在对 Redux 样板的反动之后,都收敛出"一个定义函数、state/getters/actions 三段、多 store 组合、少仪式"的形态——UI 状态管理在 2020s 的共同收敛面。

差,差在**把"变化如何传导到 UI"交给谁**:

```
变化传导的两个候选引擎:
A) 自建订阅(Set 全量通知) + 消费端筛选   →  Zustand 路线
   React 桥补上 useSyncExternalStore       →  需要 selector、需要引用稳定、
                                              需要 useShallow;换来"框架无关内核"
B) 语言级依赖追踪(读即登记、改即通知)      →  Pinia 路线
   借 Vue 的 reactive/computed/watch        →  精准白送、无需 selector、
                                              无需关心引用稳定;代价是"只属于 Vue"
```

这条分叉**不是"谁更好",而是"你站哪个生态"**:

- 在 **React** 生态,React 自己没有内建响应式,选择器 + `useSyncExternalStore` 是必然补法,Zustand(及 Jotai、Redux 的 useSelector)都长这样;
- 在 **Vue** 生态,`reactive` 把"精准"免费给了每个人,Pinia 不需要 selector 这层——**不是 Pinia 更强,是它脚下站着 Vue 的响应式**。

> **Pinia 的 getter 缓存、深度响应式、无 selector,全是"Vue 响应式外包"的赠品;Zustand 的框架无关、SSR 友好、中间件式扩展,全是"自建订阅"的回报。** 对照表里每一行的差,归根到底都是这一行差。

## 四、放回谱系:什么时候根本不是它们的活

很多"状态管理问题"根本不归 store 管,分清边界再选型:

| 你想解决的                          | 主角候选                                                         | 为什么                                    |
| ----------------------------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| 表单草稿 / 单组件开关               | 就地 `useState` / `ref`,别进 store                               | 局部态进全局 store = 白给重渲染与清理负担 |
| 接口数据 + 缓存 + 失效              | **TanStack Query / SWR,见 [Server State 篇](./server-state.md)** | 服务端态是缓存不是状态,store 是错误工具   |
| 复杂跨组件全局态(会话/主题)         | Zustand / Pinia                                                  | 本篇主角                                  |
| 严格 action 历史 / 超大规模团队约束 | Redux Toolkit                                                    | 要的是 reducer 纪律与时间旅行基建         |
| 状态合法流转严格建模                | XState                                                           | 状态机把非法态挡在类型层外                |
| 细粒度原子、大量派生互算            | Jotai / Recoil                                                   | 派生图是它们的本体                        |
| 可变对象直觉 + 自动追踪             | MobX / Valtio(React)                                             | 想要 Vue 式体验但人在 React               |

**与"框架原生"的关系**(React 侧 `Context + useReducer`,Vue 侧就是 `reactive + watch`):原生方案的问题不是"能不能存",而是**传导粒度与可观测性**——Context 一改全 Consumer 重渲染、没有 action 历史、调试与跨组件编排靠手搓。**数据量小、层级浅时原生够用;一旦跨组件共享变多或想追踪变更,就该上 store。**

## 五、Zustand 还是 Pinia?——其实是"你在 React 还是 Vue"

差异几乎全部来自生态,选型第一问是**"项目在哪个框架"**:

```
在 Vue / 会长期用 Vue 的新项目   →  Pinia(官方钦定,Vuex 的继任,引擎吃满响应式红利)
在 React / 想在多个环境复用内核   →  Zustand(轻、SSR 友好、可出框架外工具)
要"一份 store 逻辑两边跑"        →  Zustand(vanilla 内核可跨框架共享;Pinia 做不到)
团队要强类型但不想背 Redux        →  两者都行;React 侧也可考虑 Redux Toolkit
```

同一框架内再深一层:

- **渲染精度**是硬约束吗:React 里 Zustand/Jotai 用 selector、Redux 用 useSelector,精度靠"引用稳定 + 浅比较";彼此差异小于与"Vue 系"的差异;
- **中间件 vs 插件**:想要"给 set 换零件"(持久化、日志、immer 全管线)Zustand 顺手;想要"给 store 贴能力"(埋点、$ 工具、devtools)Pinia 顺手;
- 次要因素:包体(Zustand 极小)、团队熟悉度、是否要跨端复用内核。

## 六、别用"两库都行"掩盖架构问题

选型后真正决定成败的:一半的 store 里躺着的其实都是服务端数据。把接口返回 + 缓存 + 轮询全手动塞进 store,等于亲手写出一套烂缓存。

> **客户端交互状态 → store(Zustand/Pinia);服务端数据 → 查询缓存(TanStack Query/SWR);边界划清,状态才不爆炸。**

**一句话总结**:Zustand 与 Pinia 在同一套 store 语法下,背靠两座不同引擎;选谁由生态决定,用得如何由"Server/Client 分界"决定。回到解剖问题单——存得清、改得稳、读得准、传得到、时序不乱、能扩展,你已在两套源码里各看了一遍答案。

## 速查

| 主题           | 一句话记住                                                   |
| -------------- | ------------------------------------------------------------ |
| 同一语法两引擎 | `create` / `defineStore` 心智同源,传导机制完全不同           |
| 核心分叉       | Zustand 自建订阅 + selector;Pinia 外包 Vue 依赖追踪,精准白送 |
| 生态决定       | Vue → Pinia;React / 跨框架 → Zustand                         |
| 边界           | 局部态进组件、服务端态进查询缓存、真正的全局态才进 store     |

> 收官:[Server State 分水岭](./server-state.md)——那些"根本不该进 store"的数据,该怎么管。
