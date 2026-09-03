# Webpack Module Federation(模块联邦):让多个独立应用在运行时互相"借代码"

> [← 返回总纲](./README.md) · 系列深度专题:从"为什么需要运行时共享"到"搭建 host + remote 并用起来",再拆到 remoteEntry / shareScope 的内部机制

当项目从一个"单体应用"走向"多个团队独立开发、独立部署、又要彼此共享代码"时,所有人都会撞上同一个天花板:**代码到底怎么共享?** 传统答案只有一个——发 npm 包、下游构建时装进去。但这条路有个致命问题:**共享是"构建期"的,下游不重新构建就永远用不上你的新代码**。模块联邦(Module Federation,下称 **MF**)给出的答案是:**把"共享"从构建期挪到运行期**——多个**独立构建、独立部署**的应用,在浏览器里运行时互相"借"模块。

[工程化篇](./engineering.md) 给过概念速览。这一篇做两件事:一是**把它讲透**(为什么、运行时到底发生了什么),二是**带你把一套 host + remote 从零搭起来跑通**。

## 一、先看它要解决什么:从"构建期共享"到"运行时共享"

### NPM 共享模型的三个痛点

假设 `team-b` 维护一个业务组件库,`team-a` 的应用要用它。走 npm 包的模式:

```
team-b: 改组件 → 发版 v2.0 → npm publish
team-a: 升级依赖 → 重新 npm install → 重新 webpack build → 重新部署
```

| 痛点           | 表现                                                 |
| -------------- | ---------------------------------------------------- |
| **升级成本高** | team-b 每发一次版,所有下游都要"装包 + 重构建 + 重发" |
| **版本碎片化** | 三个应用各锁一个版本,想统一升级要靠层层推动          |
| **重复加载**   | React 这类基础库各自打一份进产物,体积与缓存都吃亏    |

### MF 的模型:每个构建是一个"容器"

MF 换个思路:**不打包共享代码,改成运行时去"别人那"取**。每个参与的应用,在构建时把自己变成两重身份:

```
┌─────────────┐  remotes(借)      ┌─────────────┐
│  宿主 host   │ ────────────────► │  远端 remote │
│  (壳/主应用)  │   运行时按需拉模块  │  (被借的应用) │
│             │                    │             │
│  共享 react  │◄──── 也提供 ──────►│  共享 react  │
└─────────────┘   shareScope 协商   └─────────────┘
```

- **remote(远端/被借方)**:把自己的一部分模块通过 `exposes` **暴露**出去,并产出一个"接待前台"`remoteEntry.js`;
- **host(宿主/借入方)**:通过 `remotes` 声明"我要去哪个地址借",在代码里像懒加载一样 `import('remote/xxx')`;
- 两者还通过 `shared` 协商 **React 这类基础库全站只留一份**(这就是联邦的"联邦"二字:多个自治构建在共享条款上联合)。

**关键转变:升级不再要求下游重构建。** team-b 更新 remote 后**独立部署**,host 下次运行时自动拉到新版本——共享从"构建期快照"变成"运行期活引用"。

## 二、核心概念与配置:一次看清全部选项

MF 的全部配置收敛在一个插件上:

```js
const { ModuleFederationPlugin } = require('webpack').container
```

| 配置项       | 作用                           | 关键点                                           |
| ------------ | ------------------------------ | ------------------------------------------------ |
| `name`       | 本构建作为容器时的**全局标识** | 必填;全局唯一,用作注册名                         |
| `filename`   | remoteEntry 文件名             | 默认 `remoteEntry.js`,是容器的"接待前台"         |
| `exposes`    | **暴露**哪些模块给外界借       | key 以 `./` 开头,如 `'./Button': './src/Button'` |
| `remotes`    | **声明**去哪个容器借模块       | 格式 `别名: '容器名@URL/remoteEntry.js'`         |
| `shared`     | 哪些依赖**全站共享**           | `react` / `react-dom` 几乎必配,配合 `singleton`  |
| `shareScope` | 共享作用域名                   | 默认 `default`,一般不用改                        |

### remote:被借方怎么配

一个独立的"组件应用"(比如 :3002),只负责暴露组件:

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

### host:借入方怎么配

一个"壳应用"(比如 :3001),负责把 remote 的组件渲染进自己的页面:

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

`remotes` 的值要读成 **`<对方容器名>@<对方 remoteEntry 的完整 URL>`**:容器名用于全局定位,URL 用于首次去拉对方。

## 三、从零搭一套 host + remote(动手)

空谈配置不跑一遍等于白看。这里给一个最小可运行的两应用 demo(React + webpack 5)。

### 第 0 步:准备两个独立工程

```
mf-demo/
├── components/   # remote,端口 3002,只暴露组件
└── shell/        # host,端口 3001,渲染组件
```

两者都配 `mode: 'development'`、`devServer.hot: true`,是**两个完全独立的 webpack 构建**,互不认识,只在运行时发生关系。

### 第 1 步:remote 暴露一个组件

`components/src/Button.jsx`(一个普通组件,什么都不用特殊处理):

```jsx
export default function Button({ children }) {
  return <button style={{ padding: '8px 16px' }}>{children}</button>
}
```

remote 配置见上节(不重复)。启动 remote:`webpack serve --port 3002`。

**remote 自己能独立访问**:打开 `http://localhost:3002/` 是一个可单独运行、单独部署的应用——这是 MF 的基本盘:**remote 离了 host 也活得很好**。

### 第 2 步:host 消费远端组件

`shell/src/App.jsx`——注意 **remote 模块是异步的**,必须走 `React.lazy`(或任何动态 import),并配 `Suspense` 兜底:

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

### 第 3 步:跨源加载,别忘了 CORS

host(:3001)在浏览器里去拉 remote(:3002)的 `remoteEntry.js` 和 chunk,**属于跨域请求**,remote 的开发服务器必须放行:

```js
// components/webpack.config.js —— remote 一方要加 CORS 头
module.exports = {
  devServer: {
    port: 3002,
    headers: { 'Access-Control-Allow-Origin': '*' }, // 生产同理:静态服务器要允许 host 源跨域读取
  },
}
```

不加这行,浏览器会以跨域为由拦截,host 里会看到 `Failed to fetch` 的 remoteEntry 报错。

### 第 4 步:跑起来验证

```bash
cd mf-demo/components && webpack serve --port 3002  # terminal 1
cd mf-demo/shell     && webpack serve --port 3001  # terminal 2
```

打开 `http://localhost:3001/`——看到 remote 的按钮渲染出来即成功。这时可以做两个"惊悚但正确"的验证:

1. **改 remote 的 Button 文案,保存** → host 页面(通常)无需刷新,按钮已变 —— 证明共享是**运行期活引用**;
2. **Network 面板看资源**:按钮代码来自 `3002` 源的 chunk,**不在 host 的 bundle 里** —— 证明 remote 的代码没有被打进 host 产物。

## 四、原理深挖:运行时到底发生了什么

### 1. 每次 MF 构建,都是一个"容器"

启用插件的构建,其产物里不止有页面代码,还多了一份**容器运行时 + 容器清单**。remote 的 `remoteEntry.js` 就是这个容器暴露给世界的"前台",它只做两件事:

| 方法               | 作用                                             |
| ------------------ | ------------------------------------------------ |
| `init(shareScope)` | 接收共享作用域(host 把 react 等**覆盖物**递进来) |
| `get(module)`      | 异步取某个被暴露的模块(内部再按需拉对应 chunk)   |

所以"消费一个 remote 模块"从 host 视角看是三步,这也解释了为什么它**天生异步、必须 lazy**:

```
① import('components/Button') 触发
        ↓
② host 运行时去加载 remote 的 remoteEntry.js(首次)
        ↓  remoteEntry 已就绪 → 调用它的 get('./Button')
③ 拿到"怎么加载 Button"的描述 → 按需拉取 Button 所在 chunk → 模块可用
```

要点:**host 的产物里没有 remote 的代码,只有"去哪个地址、找哪个容器、借哪个模块"的描述**;真正的代码直到首次用到才从 remote 源拉。这既是"不重复打包"的原因,也是 remote 升级"不用 host 重发"的原因。

### 2. shared 与 shareScope:React 为什么能"全站只有一份"

如果 host 和 remote **各自打包一份 React**,会出现最著名的 MF 事故:**两个 React 实例**,hooks 状态错乱、事件不共享。`shared` + `singleton` 就是来根治它的。

机制是一个运行期的**共享作用域(shareScope)**:

- 每个声明了 `shared` 的应用,构建时**不再把 React 打进自己的主包**,而是标记为"共享依赖:运行时找别人借,找不到再加载自己的那份兜底";
- 页面运行起来,先启动的容器(通常是 host)把它的 React **放进 shareScope**,并作为"覆盖物(override)"提供;
- 后续容器(remote)`init` 时读 shareScope:**发现已有 React 且版本满足要求 → 直接用,不再加载自己的那份**;
- `singleton: true` 意味着"整个运行时**至多一个实例**",任何容器都不允许另起炉灶。

```js
shared: {
  react: { singleton: true, requiredVersion: '^18.2.0' }, // 要求版本区间,供协商
  'react-dom': { singleton: true, requiredVersion: '^18.2.0' },
}
```

**版本协商的规则(原则性)**:对每个共享依赖,运行时在 shareScope 里找"能满足所有声明者 `requiredVersion` 的版本";满足就用,不满足再取自己的兜底副本。`singleton` 下若两应用 React 版本冲突且都不满足对方要求,运行时会**报警告/报错**——这不是 bug,是协商机制在提醒你**把 React 版本统一**。

> 所以 MF 工程有个潜规则:**基础共享库(React、状态库、路由)版本务必对齐**。共享得越基础,版本越要收敛;真正版本敏感的库,与其强行 singleton,不如别共享(各打一份,至少稳定)。

### 3. `publicPath` 为什么是"auto"

跨源加载意味着 remote 的 `remoteEntry.js`、暴露模块的 chunk,都要**能被 host 的源用绝对 URL 拉取**。若把 publicPath 写成相对路径,remote 部署到 CDN 子目录、或 host 与 remote 不同源时,运行时拼接出的 URL 就错了。`output.publicPath: 'auto'` 让 webpack 在运行时根据当前脚本地址推断,**是 MF 工程里最省心的写法**。

## 五、进阶用法

### 双向联邦:一个应用既当 host 又当 remote

MF 的身份不互斥。壳应用可以同时 `exposes` 自己的导航组件给别人借,也可以 `remotes` 借别人的页面。共享库的 `shared` 配置在**每个**参与的构建里都要写,保证无论谁先启动、shareScope 都能被正确初始化。

### TypeScript:类型不跨应用,自己声明

MF 是**运行时**共享,**编译期彼此没有类型**——host 不知道 remote 的 Button 长什么样。需要类型时在 host 侧手动声明:

```ts
// shell/src/remote.d.ts —— 给 remote 模块补一个"轻量类型壳"
declare module 'components/Button' {
  const Button: (props: { children?: React.ReactNode }) => JSX.Element
  export default Button
}
```

### 错误处理与降级

remote 一旦挂掉(离线、发错版、CORS 拦截),host 不能跟着崩。两个防御点:

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

- ② **运行时/环境开关**:把 remote 的 URL 抽成配置(甚至远程配置接口下发),线上可一键切换 remote 地址、灰度或回退,而不是改代码重发。

### 什么时候用 `eager`

`shared` 的"兜底副本"默认是**异步 chunk**——需要时异步拉。若某个共享库在**启动同步期**就被用到(初始化就要、或被非 lazy 路径引用),可加 `eager: true` 把它并进主包,但会失去按需、且**host 与 remote 同开 eager 有重复风险**。经验:**只在"发起共享的那一方"(通常 host)按需使用 eager,remote 一般不设**,不深究机制时保持默认即可。

## 六、横向对比:和别的"微前端/共享"方案怎么选

| 方案                   | 共享/隔离模型                  | 适合                         | 短板                                        |
| ---------------------- | ------------------------------ | ---------------------------- | ------------------------------------------- |
| **NPM 包**             | 构建期共享,版本快照            | 高内聚、要版本契约的库       | 升级要全下游重构建;重复打包                 |
| **MF(本主题)**         | **运行期共享**,无隔离,联邦自治 | 中大型微前端、跨团队独立发版 | 应用间运行时耦合;需统一构建体系(webpack 系) |
| **iframe / 独立部署**  | 天然隔离,连共享都难            | 完全隔离的子系统             | 通信/样式/体验割裂                          |
| **qiankun 等沙箱方案** | 运行时加载 + JS/CSS 隔离       | 遗留系统、需强隔离           | 侵入式改造;共享同一套运行时较繁琐           |

**MF 的边界要清醒**:

- MF **默认没有 JS 沙箱**——host 与 remote 共享同一个 `window`,共享同一份 shareScope。它假设"参与联邦的应用之间互相信任"。**不要在 MF 里加载不可信第三方的 remoteEntry**(恶意模块进来自如,等于把整个页面交出去)。
- MF 对**构建体系有要求**:本家是 webpack 5;Vite 需要生态插件(`@originjs/vite-plugin-federation`)、Rspack 有原生支持,但细节与踩坑各不同。
- 它是"共享/联邦"方案,不是"隔离"方案;**要隔离(不可信、强边界)找 iframe/qiankun,要共享找 MF**——先想清楚你的核心诉求是哪个。

## 七、最佳实践与避坑清单

| 主题         | 建议                                                                             |
| ------------ | -------------------------------------------------------------------------------- |
| 共享库版本   | React / 路由 / 状态库等基础依赖**全局统一版本**,`shared + singleton` 才安全      |
| `publicPath` | 参与方一律 `output.publicPath: 'auto'`,避免跨源 404                              |
| CORS         | remote 源要对 host 源放行(`Access-Control-Allow-Origin`),dev 与生产都要          |
| 消费方式     | remote 模块**永远异步**,用 `React.lazy + Suspense`,别同步 import                 |
| 入口可达     | 保证 `remoteEntry.js` 的 URL 在 host 运行时**可解析、可跨域**;用错误兜底而非裸奔 |
| 类型         | host 侧手写 `declare module 'remote/xxx'` 补类型,别指望跨应用类型推导            |
| 范围克制     | 只暴露**该共享的**(组件/入口/工具),别把 remote 整个应用全暴露出去                |
| 信任边界     | 只在可信团队/应用之间联邦,不加载不可信 remote                                    |

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
