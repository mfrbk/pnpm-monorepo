# Vite 学习系列(总纲)

> Vite 学习笔记:核心差异在"开发/生产分裂"的双引擎架构;按 双引擎原理 → 工程化配置 → 插件与 TS → 生态对比 递进。· [← docs 索引](../README.md)

## 文章索引

| 篇目 | 文章                                      | 一句话重点                                                                             | 前置依赖 |
| ---- | ----------------------------------------- | -------------------------------------------------------------------------------------- | -------- |
| 一   | [双引擎与底层原理](./architecture.md)     | 开发为何"原生 ESM + esbuild 预构建"、生产为何 Rollup 打包,以及 HMR 为何近乎瞬时        | 无       |
| 二   | [工程化配置与最佳实践](./config.md)       | vite.config 高频项 / `.env` 与 `import.meta.env` 的 VITE_ 白名单 / `index.html` 即入口 | 一       |
| 三   | [插件系统与 TypeScript](./plugins.md)     | Rollup 兼容插件模型 / 官方插件 / esbuild 转译与类型检查为何分离                        | 一二     |
| 四   | [对比 Webpack 与生态视野](./ecosystem.md) | 何时选 Vite 何时留 Webpack / 框架与元框架版图 / Vitest 与 Storybook 工具链             | 一二三   |

> 官方文档:vite.dev(指南 / 配置 / 插件 API)。本系列以 Vite 5/6 为基准,Rolldown 等演进以官方为准;与 [Webpack 系列](../webpack/README.md) 概念同构,可对照阅读。
