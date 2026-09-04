# Rollup 学习系列(总纲)

> Rollup 学习笔记:定位为"面向 JS 类库的打包器";按 核心机制 → 配置实战 → 插件与 JS API → 生态对比 递进。· [← docs 索引](../README.md)

## 文章索引

| 篇目 | 文章                                           | 一句话重点                                                                                                    | 前置依赖 |
| ---- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------- |
| 一   | [核心概念与底层机制](./core.md)                | 极简内核定位 / 静态 Tree Shaking / ESM 扁平化链接 / es·cjs·iife·umd 多格式怎么选                              | 无       |
| 二   | [工程化配置与实战](./config.md)                | input/output/plugins 骨架 / external 库边界 / node-resolve·commonjs·babel·typescript 组合 / 分割与 Source Map | 一       |
| 三   | [插件开发与 JavaScript API](./plugin-api.md)   | 构建钩子 vs 输出钩子 / 手写自定义插件 / rollup() 与 watch() 编程化构建发布                                    | 一二     |
| 四   | [对比 Webpack/Vite 与生态视野](./ecosystem.md) | 判据:产物给"代码 import"还是"用户打开的应用" / Vite build=Rollup / 生态源码阅读路线                           | 一二三   |

> 官方文档:rollupjs.org(Introduction / Configuration / Plugin Development / JavaScript API)。本系列默认 Rollup 3/4;与 [Webpack 系列](../webpack/README.md)、[Vite 系列](../vite/README.md) 合看即为完整构建世界观。
