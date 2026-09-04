# 前端状态管理双引擎:Zustand × Pinia(总纲)

> 状态管理学习笔记:先分类再选型;以 Zustand 与 Pinia 双引擎对"读懂一个状态库"的六问逐一作答。· [← docs 索引](../README.md)

## 文章索引

| 篇目 | 文章                                             | 一句话重点                                                                                  | 前置依赖   |
| ---- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- | ---------- |
| 零   | [坐标系与方法论](./landscape.md)                 | 四类状态分类 / 五派库谱系 / "读懂一个状态库"的解剖问题单(后续各章的分析轴)                  | 无         |
| 一   | [Zustand 内核:存储与订阅](./zustand-core.md)     | createStoreImpl:setState 浅合并 / Set 订阅 / 全量通知,约 20 行的框架无关内核                | 零         |
| 二   | [Zustand × React:渲染绑定](./zustand-react.md)   | useSyncExternalStore 桥 / selector 引用稳定 / useShallow / 并发下为何不撕裂 / 无需 Provider | 一         |
| 三   | [Zustand 扩展:中间件](./zustand-middleware.md)   | 中间件 = 重写 set 与 api:persist / immer / devtools / subscribeWithSelector                 | 一         |
| 四   | [Pinia 内核:与 Vue 响应式结合](./pinia-core.md)  | store 为何是 reactive / getter 为何自动缓存 / createPinia / defineStore / createSetupStore  | 零         |
| 五   | [Pinia 进阶:补丁与订阅体系](./pinia-advanced.md) | $patch / $subscribe(deep watch) / $onAction / 插件注入 / options vs setup 双形态            | 四         |
| 六   | [对位:双引擎对照与选型](./contrast.md)           | 前六章逐维对照 / 差异根源 = 渲染绑定 / 放回谱系:React 用 Zustand、Vue 用 Pinia              | 一二三四五 |
| 七   | [Server State 分水岭](./server-state.md)         | 请求数据是"缓存"不是状态 / TanStack Query 的 key·stale·GC·乐观更新 / 与 store 协作边界      | 零         |

> 官方文档:react.dev(useSyncExternalStore)、vuejs.org(响应式原理)、zustand.docs.pmnd.rs、pinia.vuejs.org、tanstack.com/query。默认版本:zustand@^5、pinia@^4.0、@tanstack/query-core@^5。
