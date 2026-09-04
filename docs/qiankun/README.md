# 微前端 qiankun 学习系列(总纲)

> 微前端与 qiankun 学习笔记:qiankun = 应用加载器 + JS 沙箱 + 样式隔离;按 应用模型 → 资源加载 → 隔离 → 通信 → 工程接入 → 选型 递进。· [← docs 索引](../README.md)

## 文章索引

| 篇目 | 文章                                   | 一句话重点                                                                                  | 前置依赖 |
| ---- | -------------------------------------- | ------------------------------------------------------------------------------------------- | -------- |
| 一   | [应用模型与生命周期](./model.md)       | registerMicroApps / loadMicroApp / bootstrap→mount→unmount / activeRule 路由活动            | 无       |
| 二   | [HTML Entry 加载机制](./html-entry.md) | 一个"网页地址"如何变成可执行资源:processTpl 拆分 / 脚本执行顺序 / publicPath / UMD 产物要求 | 一       |
| 三   | [JS 沙箱原理](./sandbox.md)            | 全局变量为何不互相污染:快照沙箱 → Proxy 沙箱 / 逃逸边界(挡不住 DOM / 事件 / 存储)           | 一二     |
| 四   | [样式隔离](./style-isolation.md)       | 样式为何会互相污染:约定式 / experimental(Scoped CSS) / strict(Shadow DOM) / 弹层与组合建议  | 三       |
| 五   | [应用间通信](./communication.md)       | 谁与谁通信 / props 静态下传 / initGlobalState(Actions) 双向广播 / 事件与存储 / 契约设计     | 一       |
| 六   | [接入与工程实战](./migration.md)       | 主/子应用双视角改造(webpack 双模式 + Vite 特例) / 公共依赖 / 部署 / 高频踩坑清单            | 二三四五 |
| 七   | [生态对比与选型](./ecosystem.md)       | 方案谱系 / qiankun vs 无界 / micro-app / Module Federation / 要不要用微前端(康威定律)       | 一二     |

> 官方文档:qiankun.umijs.org、github.com/umijs/qiankun(源码)、single-spa.js.org。本系列默认 qiankun 2.x(3.0 长期停留在 rc)。
