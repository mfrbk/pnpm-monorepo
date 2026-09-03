# Webpack 性能优化:体积与速度

> [← 返回总纲](./README.md) · 本系列第 2 篇:代码分割 / Tree Shaking / HMR / 缓存提速,分"体积"与"速度"两条线

性能优化最忌讳**盲人摸象**:一会儿加个插件一会儿调个选项,看不出收益还互相打架。先把目标拆清楚——Webpack 性能只有两个盘子:

| 盘子                   | 痛点                  | 衡量指标                    | 谁买单     |
| ---------------------- | --------------------- | --------------------------- | ---------- |
| **产物体积**(越小越好) | 首屏加载慢、带宽贵    | 产物 KB、加载耗时           | **用户**   |
| **构建速度**(越快越好) | 改个样式等半天、CI 慢 | 单次构建 / watch 重编译耗时 | **开发者** |

> 有些手段同时命中两盘(如代码分割既减首屏体积、`splitChunks` 也减少重复编译),但**动机要先分清**,优化时才知道该朝哪个方向使劲。

## 一、代码分割(Code Splitting):体积优化的基石

**核心痛点**:不做分割时,一个应用无论访问哪个页面都要**全量下载整个 bundle**——首屏的必经之路,却背着一辈子不会访问到的代码。

代码分割的**本质是"把一次性全量下载,变成按需/按场景拆分下载"**。Webpack 提供三条路,粒度与场景各不相同:

### 1. 多入口分割(页面级)

[核心篇](./core-config.md) 的多入口写法本身就是一种分割——每个页面一个独立产物,访问 A 页只下 A 页的包。它最粗粒度,适合**多页应用(MPA)**:页面之间确实很少复用运行时状态。

**致命缺陷**:页面共享的代码(React、工具库)会被**重复打进每个页面**,治了"全量"又添了"重复"。所以多入口几乎**必须**配合 SplitChunks 提取公共部分(见第 3 种)。

### 2. 动态 `import()`(路由级 / 按需)

把"用的时候才加载"做到模块粒度。最典型场景:**路由懒加载**——路由切换时才拉对应页面组件的代码。语法上普通函数调用即可,`import()` 返回 Promise:

```js
// 不再顶部 import,而是跳转/渲染时才加载
const Login = () => import('./pages/Login')
const Home = () => import('./pages/Home')

// 等价写法(React.lazy / Vue 异步组件底层都是它)
// const Login = lazy(() => import('./pages/Login'))
```

两个**魔法注释**控制产出的 chunk 行为(必须以注释形式紧跟 import):

```js
import(/* webpackChunkName: "login" */ './pages/Login') // 给懒加载 chunk 起名
import(/* webpackPrefetch: true */ './utils/heavy') // 空闲时预取到缓存
import(/* webpackPreload: true */ './modal') // 与当前资源并行加载
```

- `webpackChunkName` 只影响**调试体验与缓存可读性**(生产环境名字还会被压缩混淆),不影响是否加载。
- `prefetch` 是"浏览器空闲了再偷偷拉",`preload` 是"和当前页面资源一起抢带宽"——**大多数场景 prefetch 更稳**,preload 滥用反而拖慢首屏。

### 3. SplitChunksPlugin(智能分包)

从 Webpack 4 起,提取公共代码的内置功臣(取代老的 `CommonsChunkPlugin`)。它自动分析模块被哪些 chunk 引用,**把被多处引用 / 来自第三方包的模块抽成独立 chunk**。

默认行为是 `chunks: 'async'`——**只处理异步(懒加载)chunk 里的公共模块**。要让它也处理多入口间的同步公共依赖,改成 `'all'`:

```js
module.exports = {
  optimization: {
    splitChunks: {
      chunks: 'all', // 同步(多入口共享)+ 异步都参与分包
      cacheGroups: {
        // 第三方库:node_modules 下的模块抽到一个"vendors"大块
        vendors: {
          test: /[\\/]node_modules[\\/]/,
          priority: 10,
          name: 'vendors',
        },
        // 业务公共:被 ≥2 个 chunk 引用的业务模块
        commons: {
          minChunks: 2,
          priority: 0,
          name: 'commons',
        },
      },
    },
    runtimeChunk: 'single', // 把 webpack 运行时代码单独抽一份
  },
}
```

**`runtimeChunk: 'single'` 为什么重要**:产物里有一小段 Webpack 自己生成、负责加载各 chunk 的"运行时(runtime)"代码。它不含业务逻辑,却引用 chunk 的哈希清单——**不抽出来它就会混进某个业务文件**,导致改一处业务代码、连累那个文件的缓存失效。抽成单例后 runtime 单独失效,业务文件缓存稳定。多入口下也有多种形式(`'single'` / `'multiple'` / 对象 `{ name: ()=>'runtime' }`)。

**SplitChunks 的几个关键概念**:

| 参数                  | 作用                                         | 通俗理解                                |
| --------------------- | -------------------------------------------- | --------------------------------------- |
| `chunks`              | 对哪些 chunk 生效                            | `'async'` 只拆异步;`'all'` 同步异步都拆 |
| `minChunks`           | 至少被几个 chunk 引用才提取                  | 引用次数门槛,太低会拆出太多碎块         |
| `minSize` / `maxSize` | 新 chunk 的体积上下限                        | 太小不值得单独发请求,太大拆到能并发     |
| `cacheGroups`         | 分组规则,`test` 按路径 / `priority` 定优先级 | 把 node_modules、业务公共分别归类       |
| `name`                | 是否/如何命名 chunk                          | 多入口若写死 name 可能造成重复,见下方坑 |

> **多入口下别盲目 `name`**:两个页面各自懒加载同名 `vendors` chunk 时,写死 `name: 'vendors'` 可能让同名单 chunk 出现在多个 entry 里造成**重复加载**。让 Webpack 按内容自动命名(不写 `name`)通常更稳;确实要固定名字,保证该名 chunk 只有一个入口引用它。

**三种分割方式怎么选**——本质是**按场景选粒度**:

| 方式        | 粒度      | 适用场景                     | 共享代码处理                |
| ----------- | --------- | ---------------------------- | --------------------------- |
| 多入口      | 页面      | 多页应用                     | 会重复,必须配合 splitChunks |
| 动态 import | 组件/路由 | SPA 路由懒加载、按需弹层     | 天然受益于 splitChunks      |
| SplitChunks | 模块级    | 提取公共/第三方,配合上面两者 | 本身就是干这个的            |

三者**不是互斥,而是叠加**:多入口 + 路由懒加载 + SplitChunks 提取公共,才是完整形态。

## 二、Tree Shaking(摇树):砍掉"没被用到的死代码"

**核心痛点**:你 `import` 了一个库的 3 个函数,打包却带上了整个库的 200 个函数。

**摇树的原理,一句话:静态分析 ESM 的导入导出结构,把"没被 import 到的 export"标记为死代码,交给压缩器删掉。**

### 为什么必须依赖 ES Module

关键在**"静态"**两个字:

- **ESM**:`import { a } from './x'` 是**语法层面**固定结构,`export` 列表在编译期就能枚举出来——分析器能确定"导出 a 了,但没人 import a",于是 a 是死代码。
- **CommonJS**:`require('./x')` 里拿到的是**任意 JS 对象**,属性可能是运行时拼出来的(`require(mod).` + `name`),编译期根本不知道会用到哪个——只能全留。

这就是为什么想要摇树,**源码与库都要保持 ESM**,并让转译工具别把 ESM 提前降级成 CJS。

### 一个三件套才能生效

Tree Shaking 不是单个开关,而是 **三个机制在 production 下配合**才彻底:

| 机制               | 干什么                                                | 谁开启                       |
| ------------------ | ----------------------------------------------------- | ---------------------------- |
| `usedExports`      | 标记每个模块"哪些导出被用到了"                        | `mode: production` 默认      |
| `minimize`(Terser) | 真刀真枪删掉死代码                                    | `mode: production` 默认      |
| `sideEffects`      | 判定"这个模块没有副作用,没人 import 就可以整文件删掉" | 需要你在 `package.json` 声明 |

> 少了 `sideEffects`,摇树通常只能摇到"函数内部",摇不彻底——因为 Webpack **默认假设每个模块都可能产生副作用**(执行到顶层代码就去碰外部状态),不敢整文件删。你声明"我这个包没副作用",它才敢放手删。

### 用 package.json 的 sideEffects 声明"无副作用"

```jsonc
// 你的业务包 package.json
{
  "name": "my-ui",
  "sideEffects": false, // 整个包都无副作用:没被引用的文件可直接删除
}
```

```jsonc
// 如果个别文件有副作用(如全局样式、polyfill),用数组精确列出白名单
{
  "sideEffects": [
    "*.css", // CSS 靠 import 生效,必须保留,绝不能标 false
    "./src/global.js",
  ],
}
```

**最常见的坑**:把 `sideEffects: false` 写进**业务工程**或**带全局样式的 UI 库**,结果构建后**样式、polyfill 神秘消失**——因为它们被当成"无副作用"整棵删了。务必把 `*.css` / 会往 `window` 上挂东西的文件列入数组,或用数组形式而非裸 `false`。

**配合保持 ESM 的实践**:

- 用 **`lodash-es` 或按函数引入**(`import debounce from 'lodash-es/debounce'`),别 `import _ from 'lodash'` 后只调 `_.debounce`——CJS 版整个进包。
- 若用 Babel 转译业务代码,preset 配置要保证**保留 ESM**(`@babel/preset-env` 的 `modules: false`),否则提前转成 CJS,摇树立刻失效。
- 给**纯函数 / 纯组件**标注 `/*#__PURE__*/` 注释,告诉压缩器"这个调用没有副作用、返回值不用就能删":

```js
const result = /*#__PURE__*/ createElement('div') // 没人用 result 时整句可删
```

## 三、热模块替换(HMR):开发时的"续命"体验

**核心痛点**:改一行样式/组件,不想整页刷新——刷新会丢组件内部状态(输入到一半的表单、弹开的弹窗、滚动位置)。

**HMR 的目标:更新"变了的那部分模块",页面不刷新、应用状态保留。**

### 先分清:HMR ≠ 自动刷新

| 机制                      | 行为                                     | 状态是否保留 |
| ------------------------- | ---------------------------------------- | ------------ |
| Live Reload(普通自动刷新) | 检测到变更 → **整页 reload**             | ❌ 全部丢失  |
| HMR                       | 把变更模块的**补丁**热替换进运行中的页面 | ✅ 保留      |

### 底层通信机制:一条 WebSocket 链路

HMR 能"不刷新就更新",靠的是**浏览器端常驻一条与 dev server 的 WebSocket 连接**:

```
修改源码 → Webpack 增量重编译
              │  编译完成,得到两部分关键信息:
              │    • 本次构建的 hash
              │    • manifest:哪些 chunk 里的哪些模块变了(JSON)
              ▼
dev server 通过 WebSocket 推送 { type: 'hash', ... } 和 { type: 'ok', ... }
              ▼
浏览器 HMR 客户端(runtime)拿着新 hash
              ▼ 发起热更新下载
              GET  hot-update.json(本次变更清单) + xxx.hot-update.js(变更模块的补丁代码)
              ▼
浏览器把补丁 apply 到已运行的模块里 → 模块被新版本替换
```

所以 HMR 的**下载是 HTTP、通知是 WebSocket**:WS 只负责"告诉浏览器该更新了 + 新 hash",真正的新代码走普通请求。

### 谁来"接收"这个补丁?——module.hot.accept

补丁到了,浏览器得知道"哪个模块变了我该怎么替换"。两条路:

**① 框架帮你接(绝大多数情况)**:React 用 `react-refresh`(Fast Refresh)、Vue 用 `vue-loader` 的 HMR、CSS 经 `style-loader` 注入天然可换。业务代码**零侵入**。

**② 手写接收逻辑**(写库、写工具模块时):需要模块自己声明"我更新后怎么处理":

```js
if (module.hot) {
  // 监听 './data.js' 的更新:旧逻辑失效后用新模块重跑一段
  module.hot.accept('./data.js', () => {
    render() // 用最新的 data 重新渲染,不刷新页面
  })
  // 当前模块自身也要被接受,否则它一更新就整页兜底刷新
  module.hot.accept()
}
```

一个模块**没被任何 accept 覆盖**,而它又变了时,HMR 会**降级为整页刷新**(安全兜底)。配置上开启 `devServer.hot: true`(或 `hot: 'only'`,即使 HMR 失败也不整页刷新)即可。

> **HMR 只属于开发**。生产构建没有 dev server、没有 WebSocket,一切模块更新都靠新版本部署后重新下载——HMR 的使命就是让"改代码→看效果"的循环从"秒级整页刷新"变成"毫秒级原位替换"。

> 上面是"链路长什么样";想看"从保存文件到模块原地替换"每一步的底层拆解(增量编译 / manifest 与补丁 / hotApply 冒泡 / 状态为何不丢),见专题 [《Webpack 热更新(HMR)原理》](./hmr.md)。

## 四、构建提速与缓存:把"等编译"的时间挤下来

先看**时间都花在哪**,再对症下药。慢的三大来源:**大量文件的重复转译**(TS/Babel)、**压缩**(production)、**磁盘 IO**。对应三条主线——**缓存、并行、缩小范围**。

### 1. 缓存:让"没变的"别重算

**Webpack 5 持久化缓存(最重要)**——把编译中间结果落到**磁盘**,下次构建直接复用,冷启动都能明显加速:

```js
module.exports = {
  cache: {
    type: 'filesystem', // 开持久化缓存(默认开发是内存缓存;filesystem 跨进程/跨次构建生效)
    buildDependencies: {
      config: [__filename], // 配置文件本身变了 → 自动整体失效重建
    },
  },
}
```

- 默认 `cache.type` 在**开发/监听模式**下是 `memory`,重启进程就丢;生产默认**不开启** filesystem。
- `filesystem` 缓存目录默认在 `node_modules/.cache/`,会同时缓存**转译结果与压缩结果**——配上后二次构建、CI 缓存命中时速度可以快到"从分钟级到秒级"。
- 依赖项发生变化时(改了 loader/plugin 版本、升级依赖),缓存机制能靠 hash 感知,基本不用手动 `--no-cache`。

**Loader 自带的文件级缓存**:转译类 loader 普遍自带缓存,避免同一文件反复转译:

```js
{
  test: /\.tsx?$/,
  use: [
    {
      loader: 'babel-loader',
      options: { cacheDirectory: true }, // 把 Babel 结果缓存到 node_modules/.cache
    },
  ],
}
```

### 2. 并行:把耗时 loader 丢给别的进程

**thread-loader** 把**它之后的 loader** 放进**独立的 worker 进程池**去跑,用多核换时间。用法:把它塞到最耗时的 loader 链**最前面**:

```js
{
  test: /\.tsx?$/,
  use: [
    'thread-loader', // ① 进线程池:后续 babel/ts loader 在 worker 里跑
    'babel-loader',  // ② 真正耗时的转译
    // ...
  ],
}
```

**三思而行**:

- 它只对**真的耗时**的链(大型项目的 TS/Babel)有意义。**小项目上了反而更慢**——每个文件要跨进程序列化通信,进程启动/通信的开销盖过了并行收益。
- 不是所有 loader 都能塞进 worker(依赖单例、共享内存状态的不行),**逐个验证产物正确性**。
- production 压缩由 `TerserWebpackPlugin` 承担,**默认已多进程并行**,无需自己开。

### 3. 缩小范围:让 Webpack "少管闲事"

很多速度问题不是"处理得慢",而是"处理了不该处理的":

| 手段                             | 原理                                                                            | 示例                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `resolve.alias`                  | 把库指向更精炼的实现(如 React 指向生产版 / 指向库自带 ES 入口),**少解析少转译** | `alias: { react: 'react/cjs/react.production.min.js' }`(一般不需要,示意) |
| `resolve.modules` / `extensions` | 限定查找目录与尝试的扩展名,减少解析 IO                                          | `extensions: ['.ts', '.js']`(别放一长串)                                 |
| `module.noParse`                 | **跳过对无依赖、已压缩大文件的解析**(如 lodash 压缩版、jQuery)                  | `noParse: /lodash\.min\.js/`                                             |
| rules 的 `include`               | loader 只在 `src/` 转译,不碰 node_modules                                       | [核心篇](./core-config.md) 已述                                          |

### 4. externals:干脆不打进包

`externals` 告诉 Webpack:"**这个模块你别打包,运行时我自己想办法拿到**"——产物引用一个全局变量即可:

```js
module.exports = {
  externals: {
    jquery: 'jQuery', // 打包时代码里 import $ from 'jquery' → 运行时取全局 window.jQuery
    react: 'React', // 典型:React 全家桶走 CDN 的 UMD 包
    'react-dom': 'ReactDOM',
  },
}
```

HTML 里手动引 CDN 的 `<script src="...">`。**优点**:不进包、体积大减、与页面共享同一份缓存。**代价**(务必权衡):

- **版本脱离包管理**:CDN 升版不经过你,`package.json` 里的版本号成了摆设;
- **有运行时风险**:CDN 挂了或全局变量没就位,整个应用崩;
- 方案通常配合"锁版本号的 CDN + 备用源"。适合**极少数稳定的基础库**,不适合业务代码。

> **关于 DllPlugin 的提醒**:Webpack 4 时代用 DllPlugin 把稳定依赖预编译提速;Webpack 5 **内置了持久化缓存,官方已不建议再用 DllPlugin**(收益被 filesystem cache 取代,还徒增复杂度)。看到老文章教你配 DllPlugin,先检查它是不是 Webpack 4 时代的产物。

## 五、一个"能动手"的优化体检清单

优化顺序建议:**先量化(拆包看 stats)再动手,每次只动一处、量一次收益**。对应的分析工具在 [工程化篇](./engineering.md) 的"产物分析"。

| 方向 | 症状                     | 手段                                             | 见效对象        |
| ---- | ------------------------ | ------------------------------------------------ | --------------- |
| 体积 | 首屏慢,单 bundle 巨大    | 动态 `import()` 路由懒加载 → SplitChunks 提取    | 首屏体积        |
| 体积 | 引了大库却只用了冰山一角 | 换 ESM 版库 / 按需引 + `sideEffects: false` 摇树 | 体积            |
| 体积 | 第三方稳定库重复 / 巨大  | `splitChunks` 抽 vendors(或少量 externals + CDN) | 体积 / 缓存命中 |
| 体积 | 样式全塞在 JS 里阻塞渲染 | MiniCssExtractPlugin 抽 CSS(见工程化篇)          | 首屏 / 缓存     |
| 速度 | watch 冷启动 / CI 慢     | `cache.type: 'filesystem'` 持久化缓存            | 构建速度        |
| 速度 | TS/Babel 是主要耗时      | thread-loader 并行(项目够大时)                   | 构建速度        |
| 速度 | 每次全量重编译           | 检查是否误伤 node_modules、`include` 是否收敛    | 构建速度        |

## 速查

| 主题         | 一句话记住                                                            | 最易踩的坑                               |
| ------------ | --------------------------------------------------------------------- | ---------------------------------------- |
| 三种代码分割 | 多入口管页面、`import()` 管按需、SplitChunks 管去重,三者叠加用        | 多入口忘配 splitChunks → 共享代码重复    |
| 摇树         | ESM 静态结构 + `usedExports` + `sideEffects` 三件套在 production 生效 | `sideEffects: false` 误删 CSS / polyfill |
| HMR          | WS 通知(推 hash + manifest)→ HTTP 拉补丁 → `module.hot.accept` 应用   | 模块没被 accept → 悄悄降级整页刷新       |
| 缓存         | `cache.type: 'filesystem'` 持久化缓存是最值得先开的一刀               | 依赖升级后没失效?检查 buildDependencies  |
| 提速         | 缓存 > 并行 > 缩小范围,thread-loader 小项目别乱上                     | 追求并行却忽略了 loader 不兼容           |

> 官方文档:webpack.js.org/guides/code-splitting、/guides/tree-shaking、/concepts/hot-module-replacement、/guides/caching;webpack.js.org/configuration/optimization。下一篇:[底层原理与源码架构](./internals.md)。
