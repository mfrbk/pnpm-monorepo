# Module Federation(模块联邦)

> 系列深度专题:从"为什么需要运行时共享"到"搭建 host + remote 并用起来",再拆到 remoteEntry / shareScope 内部机制。· [← 返回总纲](./README.md)

[工程化篇](./engineering.md) 给了 MF 概念速览。这一篇讲透原理(为什么、运行时发生了什么),并带一套 host + remote 从零跑通。

## 一、从构建期共享到运行时共享

### NPM 共享模型的三个痛点

假设 `team-b` 维护业务组件库,`team-a` 的应用要用它。npm 包模式:

```
team-b: 改组件 → 发版 v2.0 → npm publish
team-a: 升级依赖 → 重新 npm install → 重新 webpack build → 重新部署
```

| 痛点       | 表现                                                 |
| ---------- | ---------------------------------------------------- |
| 升级成本高 | team-b 每发一次版,所有下游都要"装包 + 重构建 + 重发" |
| 版本碎片化 | 三个应用各锁一个版本,统一升级靠层层推动              |
| 重复加载   | React 这类基础库各自打进产物,体积与缓存都吃亏        |

### MF 的模型:每个构建是一个"容器"

MF 不打包共享代码,改成运行时去"别人那"取。每个参与的应用构建时把自己变成两重身份:

```
┌─────────────┐  remotes(借)      ┌─────────────┐
│  宿主 host   │ ────────────────► │  远端 remote │
│  (壳/主应用)  │   运行时按需拉模块  │  (被借的应用) │
│             │                    │             │
│  共享 react  │◄──── 也提供 ──────►│  共享 react  │
└─────────────┘   shareScope 协商   └─────────────┘
```

- **remote(远端/被借方)**:通过 `exposes` **暴露**部分模块,并产出"接待前台"`remoteEntry.js`;
- **host(宿主/借入方)**:通过 `remotes` 声明"去哪个地址借",代码里像懒加载一样 `import('remote/xxx')`;
- 两者通过 `shared` 协商 React 等基础库**全站只留一份**。

**关键转变:升级不再要求下游重构建。** team-b 更新 remote 后独立部署,host 下次运行时自动拉到新版本——共享从"构建期快照"变成"运行期活引用"。

## 二、核心概念与配置

全部配置收敛在一个插件上:

```js
const { ModuleFederationPlugin } = require('webpack').container
```

| 配置项       | 作用                       | 关键点                                           |
| ------------ | -------------------------- | ------------------------------------------------ |
| `name`       | 本构建作为容器时的全局标识 | 必填;全局唯一,用作注册名                         |
| `filename`   | remoteEntry 文件名         | 默认 `remoteEntry.js`,容器的"接待前台"           |
| `exposes`    | 暴露哪些模块给外界借       | key 以 `./` 开头,如 `'./Button': './src/Button'` |
| `remotes`    | 声明去哪个容器借模块       | 格式 `别名: '容器名@URL/remoteEntry.js'`         |
| `shared`     | 哪些依赖全站共享           | `react` / `react-dom` 几乎必配,配合 `singleton`  |
| `shareScope` | 共享作用域名               | 默认 `default`,一般不用改                        |

### remote:被借方配置

独立的"组件应用"(如 :3002),只负责暴露组件:

```js
const { ModuleFederationPlugin } = require('webpack').container

module.exports = {
  output: {
    publicPath: 'auto', // 关键:让产物路径能跨源被找到,配错 remote 加载必 404
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'mf_components', // 容器的全局名
      filename: 'remoteEntry.js',
      exposes: {
        './Button': './src/Button.jsx', // 借出方:外界可用 import('mf_components/Button')
        './Card': './src/Card.jsx',
      },
      shared: {
        react: { singleton: true }, // React 全站只留一份,见第四节
        'react-dom': { singleton: true },
      },
    }),
  ],
}
```

### host:借入方配置

"壳应用"(如 :3001),把 remote 组件渲染进自己页面:

```js
const { ModuleFederationPlugin } = require('webpack').container

module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      name: 'mf_host',
      remotes: {
        // 代码里 import('components/Button') 的 'components' 就是这里的别名
        components: 'mf_components@http://localhost:3002/remoteEntry.js',
      },
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
      },
    }),
  ],
}
```

`remotes` 的值读作 **`<对方容器名>@<对方 remoteEntry 完整 URL>`**:容器名用于全局定位,URL 用于首次去拉对方。

## 三、从零搭一套 host + remote

最小可运行双应用 demo(React + webpack 5)。

### 第 0 步:两个独立工程

```
mf-demo/
├── components/   # remote,端口 3002,只暴露组件
└── shell/        # host,端口 3001,渲染组件
```

两者都配 `mode: 'development'`、`devServer.hot: true`,是两个完全独立的 webpack 构建,只在运行时发生关系。

### 第 1 步:remote 暴露一个组件

`components/src/Button.jsx`(普通组件,无需特殊处理):

```jsx
export default function Button({ children }) {
  return <button style={{ padding: '8px 16px' }}>{children}</button>
}
```

remote 配置见上节。启动 remote:`webpack serve --port 3002`。

**remote 独立可访问**:打开 `http://localhost:3002/` 是一个可单独运行、部署的应用——remote 离了 host 也活得很好,这是 MF 的基本盘。

### 第 2 步:host 消费远端组件

`shell/src/App.jsx`——**remote 模块是异步的**,必须走 `React.lazy`(或任意动态 import),配 `Suspense` 兜底:

```jsx
import { Suspense, lazy } from 'react'

// 'components' 是 remotes 别名,'Button' 对应对方的 exposes './Button'
const RemoteButton = lazy(() => import('components/Button'))

export default function App() {
  return (
    <Suspense fallback={<div>加载远端组件中…</div>}>
      <RemoteButton>来自 remote 的按钮</RemoteButton>
    </Suspense>
  )
}
```

### 第 3 步:跨源加载,配 CORS

host(:3001)拉 remote(:3002)的 `remoteEntry.js` 与 chunk **属于跨域请求**,remote 的开发服务器要放行:

```js
// components/webpack.config.js —— remote 一方要加 CORS 头
module.exports = {
  devServer: {
    port: 3002,
    headers: { 'Access-Control-Allow-Origin': '*' }, // 生产同理:静态服务器要允许 host 源跨域读取
  },
}
```

不加则浏览器以跨域拦截,host 出现 `Failed to fetch` 的 remoteEntry 报错。

### 第 4 步:验证

```bash
cd mf-demo/components && webpack serve --port 3002  # terminal 1
cd mf-demo/shell     && webpack serve --port 3001  # terminal 2
```

打开 `http://localhost:3001/` 看到 remote 按钮即成功。两个验证:

1. 改 remote 的 Button 文案并保存 → host 页面(通常)无需刷新即变 —— 共享是**运行期活引用**;
2. Network 面板:按钮代码来自 `3002` 源的 chunk,**不在 host 的 bundle 里** —— remote 代码没有被打进 host 产物。

## 四、原理深挖

### 1. 每次 MF 构建都是一个"容器"

启用插件的构建,产物里多了一份**容器运行时 + 容器清单**。remote 的 `remoteEntry.js` 是容器暴露给世界的"前台",只做两件事:

| 方法               | 作用                                           |
| ------------------ | ---------------------------------------------- |
| `init(shareScope)` | 接收共享作用域(host 把 react 等覆盖物递进来)   |
| `get(module)`      | 异步取某个被暴露的模块(内部再按需拉对应 chunk) |

"消费一个 remote 模块"从 host 视角是三步,也解释了它**天生异步、必须 lazy**:

```
① import('components/Button') 触发
        ↓
② host 运行时去加载 remote 的 remoteEntry.js(首次)
        ↓  remoteEntry 已就绪 → 调用它的 get('./Button')
③ 拿到"怎么加载 Button"的描述 → 按需拉取 Button 所在 chunk → 模块可用
```

要点:**host 产物里没有 remote 的代码,只有"去哪个地址、找哪个容器、借哪个模块"的描述**;真正代码首次用到时才从 remote 源拉。这既是"不重复打包"的原因,也是 remote 升级"不用 host 重发"的原因。

### 2. shared 与 shareScope:React 为何能"全站一份"

host 与 remote 各自打包一份 React 会出 MF 最著名的事故:**两个 React 实例**,hooks 状态错乱、事件不共享。`shared` + `singleton` 用于根治。

机制是运行期的**共享作用域(shareScope)**:

- 声明了 `shared` 的应用,构建时**不再把 React 打进自己的主包**,而是标记为"共享依赖:运行时找别人借,找不到再加载自己的兜底副本";
- 先启动的容器(通常是 host)把它的 React **放进 shareScope**,作为"覆盖物(override)"提供;
- 后续容器(remote)`init` 时读 shareScope:**已有 React 且版本满足 → 直接用,不再加载自己的那份**;
- `singleton: true` = "整个运行时**至多一个实例**",任何容器都不许另起炉灶。

```js
shared: {
  react: { singleton: true, requiredVersion: '^18.2.0' }, // 要求版本区间,供协商
  'react-dom': { singleton: true, requiredVersion: '^18.2.0' },
}
```

**版本协商规则(原则性)**:对每个共享依赖,运行时在 shareScope 里找"能满足所有声明者 `requiredVersion` 的版本";满足就用,不满足取自己的兜底副本。`singleton` 下两应用 React 版本冲突且互不满足对方要求时,运行时会**报警告/报错**——不是 bug,是协商机制在提醒你**统一 React 版本**。

> MF 潜规则:**基础共享库(React、状态库、路由)版本务必对齐**。共享得越基础,版本越要收敛;真正版本敏感的库,与其强行 singleton,不如不共享(各打一份,至少稳定)。

### 3. `publicPath` 为何是 `auto`

跨源加载要求 remote 的 `remoteEntry.js`、暴露模块的 chunk 都能**被 host 的源用绝对 URL 拉取**。publicPath 写成相对路径时,remote 部署到 CDN 子目录或 host/remote 不同源,运行时拼出的 URL 就错。`output.publicPath: 'auto'` 让 webpack 运行时按当前脚本地址推断,**是 MF 最省心的写法**。

## 五、进阶用法

### 双向联邦

MF 身份不互斥:壳应用可同时 `exposes` 自己的导航组件、`remotes` 借别人的页面。`shared` 配置在**每个**参与的构建里都要写,保证无论谁先启动 shareScope 都能正确初始化。

### TypeScript:类型不跨应用

MF 是运行时共享,**编译期彼此没有类型**。需要类型时在 host 侧手动声明:

```ts
// shell/src/remote.d.ts —— 给 remote 模块补一个"轻量类型壳"
declare module 'components/Button' {
  const Button: (props: { children?: React.ReactNode }) => JSX.Element
  export default Button
}
```

### 错误处理与降级

remote 挂掉(离线、发错版、CORS 拦截)时 host 不能跟着崩:

```jsx
// ① 加载层兜底(ErrorBoundary 包住 Suspense)
function RemoteWithFallback() {
  return (
    <ErrorBoundary fallback={<div>远端组件不可用</div>}>
      <Suspense fallback={<div>加载中…</div>}>
        <RemoteButton />
      </Suspense>
    </ErrorBoundary>
  )
}
```

- ② 运行时/环境开关:把 remote 的 URL 抽成配置(甚至远程配置接口下发),线上可一键切换 remote 地址、灰度或回退,不必改代码重发。

### 何时用 `eager`

`shared` 的"兜底副本"默认是**异步 chunk**——需要时异步拉。若某个共享库在**启动同步期**就被用到(初始化就要、被非 lazy 路径引用),可加 `eager: true` 并进主包,但会失去按需、且 host 与 remote 同开 eager 有重复风险。经验:**只在"发起共享的一方"(通常 host)按需用 eager,remote 一般不设**,不深究机制时保持默认即可。

## 六、横向对比:微前端 / 共享方案

| 方案               | 共享/隔离模型              | 适合                         | 短板                                        |
| ------------------ | -------------------------- | ---------------------------- | ------------------------------------------- |
| NPM 包             | 构建期共享,版本快照        | 高内聚、要版本契约的库       | 升级要全下游重构建;重复打包                 |
| MF(本主题)         | 运行期共享,无隔离,联邦自治 | 中大型微前端、跨团队独立发版 | 应用间运行时耦合;需统一构建体系(webpack 系) |
| iframe / 独立部署  | 天然隔离,连共享都难        | 完全隔离的子系统             | 通信/样式/体验割裂                          |
| qiankun 等沙箱方案 | 运行时加载 + JS/CSS 隔离   | 遗留系统、需强隔离           | 侵入式改造;共享同一套运行时较繁琐           |

**MF 的边界**:

- MF **默认没有 JS 沙箱**——host 与 remote 共享同一个 `window` 与 shareScope,假设参与者互相信任。**不要加载不可信第三方的 remoteEntry**(恶意模块进来等于交出整个页面)。
- MF 对**构建体系有要求**:本家是 webpack 5;Vite 需生态插件(`@originjs/vite-plugin-federation`)、Rspack 有原生支持,细节与踩坑各异。
- 它是"共享/联邦"方案,不是"隔离"方案;**要隔离找 iframe/qiankun,要共享找 MF**——先想清楚核心诉求。

## 七、最佳实践与避坑清单

| 主题         | 建议                                                                         |
| ------------ | ---------------------------------------------------------------------------- |
| 共享库版本   | React / 路由 / 状态库等基础依赖全局统一版本,`shared + singleton` 才安全      |
| `publicPath` | 参与方一律 `output.publicPath: 'auto'`,避免跨源 404                          |
| CORS         | remote 源对 host 源放行(`Access-Control-Allow-Origin`),dev 与生产都要        |
| 消费方式     | remote 模块永远异步,用 `React.lazy + Suspense`,别同步 import                 |
| 入口可达     | 保证 `remoteEntry.js` 的 URL 在 host 运行时可解析、可跨域;用错误兜底而非裸奔 |
| 类型         | host 侧手写 `declare module 'remote/xxx'` 补类型,别指望跨应用类型推导        |
| 范围克制     | 只暴露该共享的(组件/入口/工具),别把 remote 整个应用全暴露                    |
| 信任边界     | 只在可信团队/应用之间联邦,不加载不可信 remote                                |

## 速查

| 概念        | 一句话记住                                                         |
| ----------- | ------------------------------------------------------------------ |
| 模型        | 每个 MF 构建是一个容器;共享从"构建期装包"变成"运行期借模块"        |
| 两个身份    | remote `exposes` 出模块;host `remotes` 借模块;一个应用可同时是两者 |
| remoteEntry | 容器前台,`init(shareScope)` 收共享覆盖、`get(module)` 按需取模块   |
| 消费        | `import('别名/暴露键')` 异步加载 → `React.lazy + Suspense`         |
| shared      | 声明基础库共享;`singleton` 保证全站单实例;版本务必对齐             |
| 升级        | remote 独立部署即生效,host 无需重发(运行期活引用)                  |
| 代价        | 应用间运行时耦合;无沙箱、信任边界要自己维护;依赖 webpack 系构建    |

> 官方文档:webpack.js.org/concepts/module-federation、/plugins/module-federation-plugin、github.com/webpack/webpack(ModuleFederationPlugin options、ContainerPlugin/ContainerReferencePlugin);官方示例见 webpack/webpack 仓库 `examples/module-federation*`。相关阅读:[工程化篇 · MF 概览](./engineering.md)、[底层原理篇 · 模块与依赖](./internals.md)、[核心篇 · publicPath/output](./core-config.md)。
