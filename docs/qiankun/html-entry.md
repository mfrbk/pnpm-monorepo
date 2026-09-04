# qiankun HTML Entry:子应用资源如何被加载执行

> 本系列第 2 篇:为什么要 HTML Entry / import-html-entry 加载流水线 / 脚本与样式 / publicPath / UMD 产物要求。· [← 返回总纲](./README.md)

主应用拿到一个网址(`entry: '//localhost:7101'`)后,内部靠底层库 import-html-entry,把一个普通网页变成"可被沙箱托管、可交出生命周期"的模块。

## 一、为什么是 HTML Entry 而不是 JS Entry

single-spa 传统接入要求子应用打成**一个单一 JS 包(JS Entry)**,CSS、异步 chunk、publicPath 全要自己处理。qiankun 换了个思路以兼容存量工程:

> **子应用入口就是一个普通网页地址。** 主应用去 `fetch` 那个 HTML,拆成"可执行的脚本 + 可注入的样式 + 骨架模板",在沙箱环境里执行,再把子应用渲染进容器。

| 对比         | JS Entry(single-spa 原始)                  | HTML Entry(qiankun)                                         |
| ------------ | ------------------------------------------ | ----------------------------------------------------------- |
| 子应用入口   | 一个打包产物 JS,需自行管理样式与异步 chunk | 一个普通 URL,指向子应用自己的 index.html                    |
| 存量应用接入 | 改造重(要整理成单入口)                     | 轻:基本保留原工程结构                                       |
| 开发体验     | 冷(子应用要凑齐一个可加载 bundle)          | **dev 时直接指子应用 dev server,HMR 照常**                  |
| 样式 / 资源  | 子应用自己处理                             | 框架统一抽取注入,再做隔离(见[样式篇](./style-isolation.md)) |
| 代价         | 简单直接                                   | 需要解析 HTML、保序执行、处理 publicPath,复杂度在框架侧     |

**JS Entry 把复杂度压给子应用,HTML Entry 把复杂度收进框架**——qiankun 对存量项目友好、接入成本低的根源。

## 二、加载流水线:一个网址如何变成"活的应用"

```js
const { template, execScripts, assetPublicPath } = await importEntry(entry)
// ① 拿到 HTML 文本
// ② 解析出:styles(link/inline 样式)、scripts(外链 / 内联脚本)、可保留的 template 骨架
// ③ 拉取样式 → 注入(准备做样式隔离)
// ④ 把脚本们带入"沙箱环境"按序执行(见第 3 篇),拿到入口模块的导出
// ⑤ 从导出中读 bootstrap/mount/unmount,交给主应用调度(见第 1 篇)
```

```
fetch(entry html)
   │
   ▼
解析 template(processTpl):区分 style / script / 其他 DOM
   │
   ├─► 外链 & 内联 style → 收集 →(注入主应用,交由样式隔离处理)
   │
   └─► 脚本列表(含普通脚本与"入口脚本")→ 并行预取资源
                 │
                 ▼
      在沙箱里按原始顺序逐个执行(普通库脚本先跑,建好全局;入口脚本最后)
                 │
                 ▼
      捕获入口 UMD 脚本的模块导出(或 window[应用名])
                 │
                 ▼
      validateLifecycles(找到 bootstrap/mount/unmount)→ 注册成功
```

几个"读源码时容易懵"的细节:

- **脚本分两类**:jQuery 这类"只求执行、不求导出"的库脚本,以及打包出来的**入口脚本**。普通脚本照常执行以建立全局;qiankun 只从**入口脚本的执行结果**里找生命周期。
- **执行必须保序**:脚本之间可能互相依赖,不能并行乱序执行;资源本身可并行预取,执行串行。
- **style 先行、script 后行**:先注入样式避免首屏裸奔,再跑脚本,与浏览器解析行为一致。

## 三、为什么子应用必须打成 UMD + 生命周期从入口导出

落到构建层的硬要求:

> **子应用的入口 JS 必须能以 `libraryTarget: 'umd'` 打包,并把 `bootstrap/mount/unmount` 从入口文件导出。**

原因在加载机制里:qiankun 用 `fetch + eval/new Function` 在沙箱里跑脚本(**不能直接跑 `<script type="module">`**),而 UMD 是"既能被模块系统识别、又能挂到 `window` 上"的格式——入口脚本执行完,导出(即生命周期)要么被直接捕获,要么落在 `window[library 名]` 上。配套 webpack 配置(细节见[工程实战篇](./migration.md)):

```js
output: {
  library: `${name}-[name]`,     // 暴露到 window 的名字(如 react-app-main)
  libraryTarget: 'umd',           // 关键:UMD 才能被沙箱内捕获导出
  chunkLoadingGlobal: `webpackJsonp_${name}`, // webpack5;webpack4 用 jsonpFunction
  globalObject: 'window',
}
```

> 这条约束也解释了两个常被问的现象:**为什么 Vite 子应用接入 qiankun 费劲**(Vite 产物是原生 ESM,入口是 `index.html` 而非可捕获的 UMD 脚本)、**为什么有的应用"白屏但没报错"**(生命周期被 tree-shaking 摇掉了——见[工程实战篇](./migration.md)的 Vite 一节)。

## 四、publicPath:子应用资源为什么 404

子应用独立运行时,`index.html` 与引用的 JS/CSS/图片同源,相对路径没问题。**被 qiankun 加载后,代码跑在主应用域名下**,相对路径资源(异步 chunk、图片、字体)会去主应用域名下找 → 404。

qiankun 运行时注入"正确的资源基址":`window.__INJECTED_PUBLIC_PATH_BY_QIANKUN__`(值即注册时的 `entry`)。子应用要**在入口第一行**把 webpack 的 publicPath 换成它:

```js
// src/public-path.js —— 必须作为入口第一行被引入
if (window.__POWERED_BY_QIANKUN__) {
  __webpack_public_path__ = window.__INJECTED_PUBLIC_PATH_BY_QIANKUN__
}
```

两个高频坑(工程篇还会展开):

- **public-path.js 被 tree-shaking 摇掉**:它"没被引用",webpack5 可能删之 → 在 `package.json` 的 `sideEffects` 里声明 `"./src/public-path.js"` 保它不死;
- **Vite 没有 `__webpack_public_path__`**:需社区插件或运行时 base 处理,Vite 适配难的又一根源。

## 五、预加载、缓存与加载失败

- **`start({ prefetch })`**:默认 `true`,首个子应用挂载完成后,浏览器空闲时预取其余应用的静态资源(HTML/JS/CSS),换来后续进入"秒开";可传 `'all'` / 应用名数组精细控制。
- **缓存与重复拉取**:qiankun 默认每次激活重新拉取 HTML 与脚本(保证拿最新发布),生产通常靠子应用静态资源的 HTTP 缓存(CSS/JS 带 hash)兜性能;需要更强缓存策略要在框架之上自建。
- **加载失败兜底**:网络异常 / 生命周期抛错走到 `addErrorHandler`(见[模型篇](./model.md));常见诱因是 CORS 未开(主应用 fetch 子应用资源是**跨域请求**,子应用 dev server / 静态服务必须返回 `Access-Control-Allow-Origin`)。

## 速查

| 主题          | 一句话记住                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| HTML Entry    | 子应用入口 = 一个网页 URL;框架 fetch HTML 后拆成 样式 / 脚本 / 骨架,再组装执行——复杂度收进框架            |
| 流程          | fetch → 解析 template → 拉样式 → 沙箱内保序执行脚本 → 捕获入口 UMD 导出(生命周期)→ 交给调度               |
| 产物要求      | 入口 JS 必须 `libraryTarget: 'umd'` + 从入口导出 bootstrap/mount/unmount;webpack5 记 `chunkLoadingGlobal` |
| publicPath    | 被加载后资源相对路径会 404 → 入口第一行用 `__INJECTED_PUBLIC_PATH_BY_QIANKUN__` 覆盖 publicPath           |
| Vite 痛点根因 | 沙箱不能跑 `<script type="module">`、没有运行时 publicPath、生命周期会被摇树——详见工程实战篇              |
| 预取 / 兜底   | `prefetch` 默认预取;跨域必须开 CORS;错误走 `addErrorHandler`                                              |

> 官方文档:qiankun.umijs.org/zh/guide/getting-started、qiankun.umijs.org/zh/faq;加载内核见 github.com/kuitos/import-html-entry。下一篇:[JS 沙箱:子应用代码在什么环境里跑](./sandbox.md)。
