# Webpack 学习系列(总纲)

> Webpack 学习笔记:按 核心配置 → 性能优化 → 底层原理 → 工程化 递进,另附 HMR 与 Module Federation 两个专题。· [← docs 索引](../README.md)

## 文章索引

| 篇目 | 文章                                                 | 一句话重点                                                                                                  | 前置依赖 |
| ---- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------- |
| 一   | [核心概念与基础配置](./core-config.md)               | 五大核心概念 Entry / Output / Loader / Plugin / Mode,含 `[contenthash]`、loader 链、`publicPath` 等易错细节 | 无       |
| 二   | [性能优化:体积与速度](./performance.md)              | 代码分割三手段 / Tree Shaking 与 `sideEffects` / HMR 通信 / 持久化缓存与多线程提速                          | 一       |
| 三   | [底层原理与源码架构](./internals.md)                 | 构建生命周期 / Compiler vs Compilation / Tapable 钩子 / AST 解析与依赖图                                    | 一       |
| 四   | [工程化实践与生态](./engineering.md)                 | 配置拆分 / 产物分析 / Source Map 策略 / Asset Modules / Module Federation / 构建工具选型                    | 一二三   |
| 专题 | [热更新(HMR)原理](./hmr.md)                          | watch 增量编译 → WS 推 hash → manifest/补丁拉取 → hotApply 冒泡替换 → 状态保留的本质                        | 二、三   |
| 专题 | [模块联邦 Module Federation](./module-federation.md) | 运行时共享模型 / remoteEntry 机制 / host+remote 从零搭建 / shared 与 singleton 版本协商 / 选型边界          | 一、三   |

> 官方文档:webpack.js.org(概念 / 配置 / API)。本系列以 Webpack 5 为基准,版本差异在文中单独标注;Vite / Rollup 对比见[对应系列](../vite/README.md)。
