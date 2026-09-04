# 前端状态管理双引擎:Zustand × Pinia 源码级剖析(总纲)

> [← 返回主 README](../../README.md) · 状态管理全景:状态分类 / 库谱系 / "读懂一个状态库"的解剖问题单 · 以 Zustand 与 Pinia 双引擎逐点深钻

状态管理要回答的问题很朴素:**页面上有那么多会变的数据,谁来存?谁允许它变?变了之后,屏幕上恰好依赖它的那些组件,凭什么、以及如何精准地重新渲染?** 前端技术十年,答案演化出了几条不同路线——Redux 的"单一不可变树 + reducer"、MobX 的"可变对象 + 自动追踪"、Recoil/Jotai 的"细粒度原子"、XState 的"合法状态转移"——它们表面是不同库,本质是**对同一组设计题的不同答卷**。

本系列不铺开背 API,而是先给一张**问题清单(要点)**,再挑一对"长得像、内核差得远"的库做**源码级深钻**,让每个要点都落在一行真实的实现上:

> **Zustand 与 Pinia 是"Store 范式"的两次实现:API 都是 `defineStore` / `create` 出一个带 `state + getter + action` 的单例 store,内核却一个骑在自己的订阅系统上(框架无关内核 + React 桥),一个骑在 Vue 的响应式系统上(深度集成)。** 用同一对库看同一组要点,能看到状态库的全部机制如何各自落地——这正是"彻底了解"最快的路径。

## 先建立的心智

- **状态管理难的不是"存",是"变与传导"。** 存一个变量谁都会;难在:状态变了,**哪些组件**要重渲染、以什么粒度重渲染、在 React 并发渲染这种"渲染到一半可被打断"的世界里还**不会读到撕裂的数据**。
- **先给状态分类,再谈用什么库。** 服务端返回的数据本质是"缓存"而不是"状态";本地开关与全局会话又各自不同。不分类直接选型,是八成的架构混乱之源(详见[坐标系与方法论](./landscape.md)与 [Server State 篇](./server-state.md))。
- **Store 范式 ≠ Redux。** 现在流行的 Zustand / Pinia 都是"扁平化后的 store",不要用背 Redux 的模板去套它们;反而要看清**它们替你把 Redux 的哪些仪式砍掉了、代价是什么**。
- **渲染绑定才是分水岭。** Zustand 与 Pinia 最大的差异不在 API,而在"store 怎么把变化告诉 UI":一个靠**选择器 + 订阅**,一个靠 **Vue 响应式依赖追踪**。把这条读懂,就懂了一大半状态库。
- **源码级读法:读"机制切片"而非通读。** 每个库的源码只有极少数函数承载了核心机制(如 Zustand 的 `createStoreImpl`、Pinia 的 `createSetupStore`),把这些切片读透即可;其余是类型体操与平台适配。

## 学习要点地图(八个要点,双引擎逐点作答)

先抽象出"读懂任何状态库都要回答"的八问,再让两主角在每一问上交卷:

```
0  坐标系:状态分类 × 库谱系 × 解剖问题单(本篇 + landscape 篇)
   │
   ▼
一  存储模型:状态"长什么样"? ─────► 单一对象?多 store?扁平?挂在哪个"桶"里?
二  更新机制:状态"怎么变"? ─────► set 直接改 / $patch / action / 中间件改写
三  派生与选择:如何"读"出可用数据?─► selector / getter / computed,缓存与引用稳定
四  渲染绑定:变更如何传导到 UI? ──► 订阅发布 vs Vue 依赖追踪 ←── 分水岭,最值钱
五  时序与副作用:异步/竞态放哪? ──► action 内 await / 中间件 / $onAction 编排
六  扩展机制:中间件与插件 ───────► 在"变更链"上插眼:persist/immer/devtools
   │
   ▼
七  Server State:请求数据是缓存不是状态(TanStack Query 独立章)
八  对位与选型:同范式双引擎逐维度对照 + 谱系决策
```

**"要点一~六"是贯穿全系列的分析轴**:前三篇以 Zustand 的引擎(存储与订阅 / React 桥 / 中间件)作答,接着三篇以 Pinia 的引擎(响应式内核 / 进阶 API / 对位对照)作答——同一张问题单,两份源码答案,差异即知识。

## 文章索引

| 篇目 | 文章                                             | 解决的问题                                     | 关键产出                                                          | 依赖       |
| ---- | ------------------------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------- | ---------- |
| 总纲 | 本文件                                           | "状态管理到底要搞懂什么、为什么是这两主角"     | 定位 + 八个要点地图 + 学习路径                                    | 无         |
| 零   | [坐标系与方法论](./landscape.md)                 | 状态分几类、库有哪些派、怎么"读懂一个状态库"   | 四态分类 / 五派谱系 / 解剖问题单                                  | 无         |
| 一   | [Zustand 内核:存储与订阅](./zustand-core.md)     | vanilla store 凭什么框架无关地存与通知         | `createStoreImpl` 逐行:setState 合并语义 / Set 订阅 / 惰性初始化  | 零         |
| 二   | [Zustand × React:渲染绑定](./zustand-react.md)   | store 怎么把变化告诉组件、并发下为什么不撕裂   | `useSyncExternalStore` 桥 / selector 引用稳定 / `useShallow`      | 一         |
| 三   | [Zustand 扩展:中间件](./zustand-middleware.md)   | 为什么能力都长在"中间件"上                     | 中间件即"重写 set/api" / persist / immer / devtools 源码切片      | 一         |
| 四   | [Pinia 内核:与 Vue 响应式结合](./pinia-core.md)  | store 为什么是 reactive、getter 为什么自动缓存 | Vue 响应式最小内核 / createPinia / defineStore / createSetupStore | 零         |
| 五   | [Pinia 进阶:补丁与订阅体系](./pinia-advanced.md) | $patch / $subscribe / $onAction / 插件怎么实现 | watch 底层的订阅 / action 包装器 / 双形态 store / 插件机制        | 四         |
| 六   | [对位:双引擎对照与选型](./contrast.md)           | 同一张问题单,两引擎逐行不同在哪儿,怎么选       | 全维度对照表 + 与 Redux/Context/Jotai 谱系关系 + 选型决策树       | 一二三四五 |
| 七   | [Server State 分水岭](./server-state.md)         | 请求数据为何是缓存不是状态,怎么与 store 协作   | TanStack Query 缓存模型(key/stale/GC/乐观更新) + 协作边界         | 零         |

一句话:**零 给你问题单,一二三 是 Zustand 引擎的交卷,四五 是 Pinia 引擎的交卷,六 把两份卷子对齐比较,七 回答"哪些数据根本不该进 store"**。

## 建议的动手路径

源码级文档配动手最能内化。准备一个小 monorepo 或两个独立 demo(一个 React、一个 Vue 最好,便于对照):

1. **同一业务写两遍**:写一个带"异步列表 + 筛选 + 选中项"的页面,React 侧用 Zustand、Vue 侧用 Pinia,从手感上体会"两库 API 有多像";
2. **订阅实验(Zustand)**:`store.subscribe(...)` 裸订阅,再打开 React DevTools 观察仅用 selector 选中字段的组件才重渲染;对比用整棵 store 当 selector 时是不是每次 setState 全量重渲染;
3. **响应式实验(Pinia)**:在模板里只读 `store.user.name` 深层字段,改动 `store.user.email`,用 DevTools 确认依赖追踪精确到属性,而非整 store;
4. **并发实验(Zustand)**:把一次耗时更新包进 `startTransition`,对照普通 setState 观察优先级;体会 `useSyncExternalStore` 在并发下保证"所见即一致";
5. **persist / 插件各写一次**:Zustand 用 `persist` 中间件持久化;Pinia 写一个插件注入 `$toast` 之类全局工具,读一遍[中间件 / 进阶]两篇后凭记忆重写其核心切片;
6. 最后做**决策演练**:拿你真实项目里的三类数据(表单草稿 / 会话全局 / 接口列表),按 [对位篇](./contrast.md) 的决策树与 [Server State 篇](./server-state.md) 的边界,分别规划它们该住进哪个机制。

## 学习心法

- **别背 API,背"机制切片"。** 状态库在演化的其实是同一批几十行核心代码(订阅一个 Set / 打一次补丁 / 包一层 Proxy);API 是外壳,切片是引擎。
- **"渲染绑定"维度优先读透。** React 侧它是 `useSyncExternalStore`(为什么必须用它、selector 引用稳定是什么),Vue 侧它是依赖追踪——两套机制读通,再回头选型便胸有成竹。
- **Server / Client 分界是 2020s 的头号心智。** 请求数据进缓存、交互状态进 store;边界划清楚,一半的"状态爆炸"不治而愈。
- **本系列默认版本**:`zustand@^5`(React 18+)、`pinia@^4.0`(Vue ^3.5)、`@tanstack/query-core@^5`;源码引用与解读以这些发行版为准,API 细节以各自官方文档为准。
- **与既有知识强相关**:Zustand 的 `useSyncExternalStore` 桥是 [React Hooks 与并发调度笔记](../react-hooks-scheduling.md) 里"Scheduler/Fiber"的实际应用;Pinia 深度依赖 Vue 3 的 `ref/reactive/effectScope`,可配合 Vue 官方"深入响应式系统"一文阅读。

> 官方文档:react.dev(reference/useSyncExternalStore)、vuejs.org(深入响应式原理)、zustand.docs.pmnd.rs、pinia.vuejs.org、tanstack.com/query。相关体系:本仓库另有 [React 原理学习笔记](../react-hooks-scheduling.md)、[Webpack 学习系列](../webpack/README.md)、[Vite 学习系列](../vite/README.md)、[Rollup 学习系列](../rollup/README.md)、[微前端 qiankun 学习系列](../qiankun/README.md)。
