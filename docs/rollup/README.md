# Rollup 系统学习系列(总纲)

> [← 返回主 README](../../README.md) · Rollup 学习笔记:库打包定位 / 摇树与扁平化 / 配置实战 / 插件与 API / 生态对比

很多前端开发者的 Rollup 知识是"散装"的:偶尔在某框架源码的构建脚本里见过 `rollup`,知道"它摇树很强",却说不出它和 Webpack、Vite 到底谁该在什么场合出场。**Rollup 不是又一个"万能打包器",而是一个定位极其明确、因而也极其专注的工具**:

> **Rollup 是面向 JavaScript 类库(Library)打包的构建器**,它和"偏应用构建(Application)"的 Webpack 走的是两条不同的价值曲线。

先记住这个前提,后面所有特性(摇树、扁平化输出、多格式、external)都从它推导出来:类库的消费者是**其他代码**(import 你的包的程序),它不需要 dev server、不需要处理图片字体、不需要 HMR——它要的是**产物体积小、结构干净、摇树友好、能被任意环境以标准方式引用**。这正是 Rollup 的天花板领域。

```
① 核心概念与底层机制(地基)        ② 工程化配置与实战(落地)
   静态分析摇树 / 扁平化链接           rollup.config / input / output
   原生 ESM / 无运行时开销              external 与常用插件
   多格式输出 es/cjs/iife/umd           代码分割 / 多入口 / Source Map
          │                                      │
          ▼                                      ▼
③ 插件开发与 JavaScript API(内功)   ④ 对比与生态视野(选型)
   构建钩子与输出钩子                    Rollup vs Webpack / Vite
   手写自定义插件                        生态源码阅读 / 库打包最佳实践
   rollup() / watch() 编程
```

## 为什么按这个顺序学

与 Webpack/Vite 系列一致,四篇**层层递进**:

| 篇目         | 解决什么问题                           | 学到后能干什么                                     | 依赖基础 |
| ------------ | -------------------------------------- | -------------------------------------------------- | -------- |
| ① 底层机制   | "Rollup 凭什么适合打库"                | 讲清摇树原理、扁平化输出的价值、四种格式各自给谁用 | 无       |
| ② 配置实战   | "怎么把一个真实库打成多格式产物"       | 独立写好 rollup.config + external + 常用插件组合   | ①        |
| ③ 插件与 API | "想改构建行为 / 写自动发布脚本怎么办"  | 读懂钩子顺序、手写插件、用 JS API 编排流程         | ①②       |
| ④ 对比生态   | "Rollup / Webpack / Vite 到底怎么分工" | 理性选型,并懂 Vite 生产构建为何是 Rollup           | ①②③      |

一句话:**① 让你"懂它为何强",② 让你"会用它",③ 让你"能改它",④ 让你"会选它"**。体系内对照阅读:[Webpack 系列](../webpack/README.md)(应用构建视角)、[Vite 系列](../vite/README.md)(Rollup 是它的生产引擎)——三者合起来才是完整的前端构建世界观。

## 文章索引

| 篇目 | 文章                                           | 一句话重点                                                                                  |
| ---- | ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 总纲 | 本文件                                         | 建立定位认知:Rollup = 库打包器                                                              |
| 一   | [核心概念与底层机制](./core.md)                | 静态摇树、无运行时的扁平化链接、es/cjs/iife/umd 四种格式怎么选                              |
| 二   | [工程化配置与实战](./config.md)                | rollup.config 全解、external、node-resolve/commonjs/babel/typescript 组合、分割与 sourcemap |
| 三   | [插件开发与 JavaScript API](./plugin-api.md)   | 钩子生命周期、手写插件、rollup()/watch() 编程化构建发布                                     |
| 四   | [对比 Webpack/Vite 与生态视野](./ecosystem.md) | 何时选 Rollup、Vite 为何以 Rollup 为生产引擎、读哪些插件源码                                |

## 动手建议

搭配一个极小的"伪库"演示项目效果最佳:

1. **观察摇树**:写一个 `utils.js` 导出 10 个函数,入口只引 1 个,`rollup` 打包后看产物——另外 9 个被静态剔除;再对照 Webpack 产物的模块包裹结构,体会"干净"的含义。
2. **一把源码出三种格式**:同一入口产出 `dist/index.js`(es)、`index.cjs`(cjs)、`index.umd.js`(umd),用 Node `require`、`import`、`<script>` 三种方式各引一次,亲身体会"同源码多目标"。
3. **试 external**:把一个 npm 依赖(如 `lodash`)不声明 external 打包,对比声明 external 后产物是否还有那段库代码——`external` 的作用一次看明白。
4. **给代码写一个 replace 插件**:把源码里的 `__VERSION__` 替换成真实版本号,`rollup -c` 跑一遍验证。之后读 [插件篇](./plugin-api.md) 的钩子表,把"每个钩子什么时候触发"对上号。
5. **读一份别人库的配置**:随便挑一个知名 npm 库的 `rollup.config.js`(Vue 核心、Preact 等),用 [配置篇](./config.md) 的知识"翻译"它每一行在干什么。

## 学习心法

- **所有特性都从"给代码用的代码"出发**:摇树、零运行时、多格式、external——没有一个是给"浏览器页面启动"服务的,想通定位,配置就不会乱。
- **Rollup 本身不含压缩、不含 dev server、不含资源处理**:它是"极简内核 + 插件外挂"哲学最典型的代表。遇到"它怎么没有 XX?"先想"那是不是该由插件/外层(Vite)提供"。
- **本系列默认 Rollup 3/4**;文中所提版本演进(如新增格式、选项变化)以官方文档 rollupjs.org 为准。
- 构建器三兄弟的概念高度同构(入口/外部依赖/摇树/分割/Source Map),**学通一个,换一个是换方言**。

> 官方文档:rollupjs.org(Introduction / Configuration / Plugin Development / JavaScript API 四栏)。相关体系:本仓库另有 [Webpack 学习系列](../webpack/README.md)、[Vite 学习系列](../vite/README.md)。
