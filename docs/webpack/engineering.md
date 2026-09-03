# Webpack 工程化实践与生态扩展

> [← 返回总纲](./README.md) · 本系列第 4 篇:配置拆分 / 产物分析与调试 / 模块联邦与 Asset Modules / 构建工具选型

前三篇解决"会不会用、优不优化、懂不懂原理",这一篇回答最后一个问题:**怎么把 Webpack 放进真实复杂项目里,并且在大局上知道"何时该用它、何时该换别的"**。真实的工程从来不是一份 `webpack.config.js` 走天下,而是**一套可维护的配置体系 + 可量化的调试手段 + 对生态的清醒认识**。

## 一、配置拆分:用 webpack-merge 管好三套环境

**核心痛点**:开发和生产对同一份配置的诉求几乎相反——开发要快、要 HMR、要 readable;生产要小、要缓存、要压缩。塞进一个文件互相覆盖,维护即地狱。

**解法**:抽"公共 + 环境差异"三件套,用 **webpack-merge** 合并:

```
webpack.common.js   入口/输出规则、loader、公共插件(所有环境都要的)
webpack.dev.js      开发:devServer、快 devtool、style-loader、HMR
webpack.prod.js     生产:contenthash、抽 CSS、压缩(大多靠 mode: 'production' 自动)
```

**webpack.common.js**——只放"全环境一致"的部分:

```js
const HtmlWebpackPlugin = require('html-webpack-plugin')

module.exports = {
  entry: { app: './src/index.js' },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: 'ts-loader',
      },
    ],
  },
  plugins: [new HtmlWebpackPlugin({ template: './public/index.html' })],
}
```

**webpack.dev.js**——补上开发专属配置:

```js
const { merge } = require('webpack-merge')
const common = require('./webpack.common.js')

module.exports = merge(common, {
  mode: 'development',
  devtool: 'eval-cheap-module-source-map', // 构建快且能定位到源码(见本章 Source Map 节)
  devServer: {
    port: 3000,
    open: true,
    hot: true, // HMR
    historyApiFallback: true, // SPA 路由交给前端 history
  },
})
```

**webpack.prod.js**——生产差异都在这一份:

```js
const { merge } = require('webpack-merge')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const common = require('./webpack.common.js')

module.exports = merge(common, {
  mode: 'production', // 自动开压缩 / 摇树 / 作用域提升 / 确定性 id
  devtool: 'source-map', // 产出独立 map 供监控还原,map 不公开部署(见下文)
  output: {
    filename: 'js/[name].[contenthash:8].js', // 长效缓存
    clean: true,
  },
  module: {
    rules: [
      // 生产用 MiniCssExtractPlugin 抽独立 CSS,替代开发时的 style-loader
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
  plugins: [new MiniCssExtractPlugin({ filename: 'css/[name].[contenthash:8].css' })],
  // 抽 runtime + 公共库,可叠加第 2 篇的 splitChunks 方案
  optimization: { runtimeChunk: 'single' },
})
```

**为什么不用一份配置 + 一堆 if/env 判断?** 因为 dev/prod 的差异往往是**整段规则不同**(loader 链都换了),三份文件让每份都可独立阅读、独立运行。`webpack-merge` 处理数组时默认是**后者覆盖前者同名项**,合并 loader / plugin 这类数组常用 `mergeWithRules` 精确控制——先记住"按环境拆三份"的主结构即可。

package.json 里的两条命令:

```json
{
  "scripts": {
    "dev": "webpack serve --config webpack.dev.js",
    "build": "webpack --config webpack.prod.js"
  }
}
```

## 二、产物分析:让"包为什么这么大"有据可查

**核心痛点**:优化体积不能靠猜。第一步永远是**看到底哪些模块占了空间**。

### 生成 stats 档案

`stats.json` 是一次构建的完整体检数据(模块、chunk、体积、依赖耗时全在里面):

```bash
npx webpack --profile --json > stats.json
```

### 可视化:webpack-bundle-analyzer

直接看 JSON 不直观,`webpack-bundle-analyzer` 把它渲染成**交互式矩形树图(Treemap)**,每个矩形面积 = 该模块的体积占比,点击下钻:

```js
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin

module.exports = {
  plugins: [new BundleAnalyzerPlugin()], // 构建完自动开浏览器展示
}
```

也可以不侵入构建配置,只针对已有的 stats 单独打开:

```bash
npx webpack-bundle-analyzer stats.json
```

**拿到树图重点盯三类问题**:

| 现象                               | 常见成因                    | 处理方向                                         |
| ---------------------------------- | --------------------------- | ------------------------------------------------ |
| 某个大库几乎没用到                 | 引了整库 / 摇树失效(CJS 版) | 换 ESM 版 / 按需引,见 [性能篇](./performance.md) |
| 同一个库出现**多个版本**(面积重复) | 依赖升级不一致,装了两份     | 用 pnpm 统一版本 / 或 `resolve.alias` 指向单版本 |
| 某个 chunk 巨大导致首屏慢          | 懒加载切分粒度不够          | 继续拆 `import()` + splitChunks                  |

> 打开树图后建议自问一句:**"这 5% 的体积,我多久用一次?"** 把"大且常用"留下,"大且不常用"懒加载,"大且纯演示"直接砍。优化的取舍立刻清晰。

## 三、Source Map:线上报错怎么还原到源码

**核心痛点**:压缩后的产物报错,堆栈是一行 1.6MB 的压缩代码,开发者根本没法定位。Source Map 就是"产物行号 ↔ 源码位置"的翻译表。

### devtool 的命名规则,拆开就懂

`devtool` 的各种值由几块**含义正交的词缀**组合而成:

| 词缀         | 含义                                                                     |
| ------------ | ------------------------------------------------------------------------ |
| `eval`       | 模块用 `eval` 包裹并内嵌来源标记,构建最快,但代码直接可见                 |
| `cheap`      | **只映射到行**,不做列的精确映射,省体积省时间                             |
| `module`     | 映射到 **loader 处理前的原始源码**(而非转换后的产物)                     |
| `source-map` | 生成独立的 `.map` 文件                                                   |
| `inline`     | 把 map 以 data URI **内嵌进产物**,文件显著变大                           |
| `hidden`     | 生成 `.map` 但**不在产物里写 sourceMappingURL 注释**(不给浏览器主动加载) |
| `nosources`  | 映射只有行列信息,**不含源码内容**,能定位位置但不泄露源码                 |

### 推荐策略

| 环境 | 推荐                                                                           | 理由                                 |
| ---- | ------------------------------------------------------------------------------ | ------------------------------------ |
| 开发 | `eval-cheap-module-source-map`(追求极速)或 `eval-source-map`(追求完整源码调试) | 快 + 能定位到原始源码即可,反正是本机 |
| 生产 | `source-map` / `hidden-source-map`(需要线上错误还原)或关闭(不需要)             | 见下方"红线"                         |

**生产 Source Map 的红线**:

- **别把 `.map` 和产物一起公开部署**——map 里含**完整源码**,等于把代码脱光了挂公网。多数监控平台(Sentry / Bugsnag / 阿里 ARMS…)支持**上传 map 后即删**,线上只留没 map 的产物。
- 需要"出问题时能还原、平时不泄露":用 `hidden-source-map`,把 `.map` 交给监控平台,产物不写 sourceMappingURL。
- 若产品完全无错误监控诉求,生产直接 `devtool: false`,还省一笔构建与传输开销。

## 四、Webpack 5 前沿特性

### Asset Modules:告别 file-loader / url-loader / raw-loader

Webpack 5 把处理静态资源(图片、字体、文本)的三种常用 loader **内置成资源模块类型**,配置更声明式,还不用装包:

| 类型             | 行为                                       | 取代                           |
| ---------------- | ------------------------------------------ | ------------------------------ |
| `asset/resource` | 输出**独立文件**,返回 URL                  | `file-loader`                  |
| `asset/inline`   | 转成 **base64 data URI** 内联              | `url-loader`(且 `limit` 打满)  |
| `asset/source`   | 导出文件**原始内容字符串**                 | `raw-loader`                   |
| `asset`          | 自动选择:**小于阈值内联,超过则独立成文件** | `url-loader` 按 `limit` 二选一 |

```js
module.exports = {
  output: { assetModuleFilename: 'assets/[name].[hash:8][ext]' }, // 命名模板
  module: {
    rules: [
      { test: /\.png$/i, type: 'asset' }, // 默认:> 8KB 独立文件,≤ 8KB 内联 base64
      { test: /\.woff2?$/i, type: 'asset/resource' }, // 字体永远要独立文件
      { test: /\.svg$/i, type: 'asset/inline' }, // 小图标内联
      { test: /\.txt$/i, type: 'asset/source' }, // 读出原始文本
    ],
  },
}
```

阈值也能显式调:`type: 'asset'` 时配 `parser: { dataUrlCondition: { maxSize: 4 * 1024 } }`。

### Module Federation:把"共享"从构建期搬到运行期

传统共享代码只有一条路:**发 npm 包,下游构建时安装**(构建期共享)。缺点很明显——**改一次组件要发版、要等下游全部重打包**。Module Federation(模块联邦)让**多个独立构建的应用在运行时互相"借"模块**,主打场景就是**微前端**:

```js
// A) remote——"借出方"(如独立的组件应用)
const { ModuleFederationPlugin } = require('webpack')

new ModuleFederationPlugin({
  name: 'mf_components', // remote 全局标识
  filename: 'remoteEntry.js', // 借出入口(一个清单文件)
  exposes: { './Button': './src/components/Button.jsx' }, // 把哪些模块暴露出去
  shared: { react: { singleton: true }, 'react-dom': { singleton: true } }, // 共享依赖:全局只留一份 react
})
```

```js
// B) host——"借入方"(如壳应用)
new ModuleFederationPlugin({
  name: 'mf_host',
  remotes: {
    components: 'mf_components@https://cdn.xx.com/mf_components/remoteEntry.js',
  },
  shared: { react: { singleton: true }, 'react-dom': { singleton: true } },
})
```

host 里**按需动态加载 remote 暴露的模块**,像用懒加载一样:

```js
const Button = React.lazy(() => import('components/Button')) // 运行时才去 remote 拉
```

| 对比维度 | npm 包共享                  | Module Federation                                |
| -------- | --------------------------- | ------------------------------------------------ |
| 共享时机 | 构建期(装包、打进产物)      | **运行期**(按需拉取)                             |
| 升级成本 | remote 发版 → host 全部重发 | **remote 单独部署即生效**,host 不用动            |
| 依赖管理 | 各自打包,易重复             | `shared + singleton` 让 React 等**全站只留一份** |
| 适用     | 代码高内聚、要版本契约      | 微前端、跨团队交付、主应用瘦身                   |

> 权衡清醒一点:MF 的代价是**应用间运行时强耦合**、shared 版本协商复杂、remote 挂了会拖累 host。它适合"多个团队各自独立发版、又要共享运行时"的**中大型微前端**,不是小项目炫技的工具。相比 iframe / qiankun 等隔离方案,MF 不开 iframe、JS/CSS 共享自然,但对构建体系(全 webpack)与约定要求更高。

> 这是概念速览。想要完整版:从零搭建 host + remote、remoteEntry 与 shareScope 的运行时机制、`React.lazy` 消费、版本协商与 CORS/publicPath 等实战坑,见专题 [《Module Federation(模块联邦)》](./module-federation.md)。

### 别忘了:持久化缓存

Webpack 5 的 `cache.type: 'filesystem'` 对工程化的价值,已在 [性能篇](./performance.md) 详述——它让 **CI 能跨构建复用缓存**,是生产级工程提速的首选开关,这里只作回指。

## 五、生态视野:什么时候该选 Vite / Rollup / esbuild

Webpack 不是唯一答案。**选型要看"构建什么"**,四类工具的定位差异很大:

| 工具        | 核心哲学                        | 强项                                                    | 适合场景                                | 局限                                        |
| ----------- | ------------------------------- | ------------------------------------------------------- | --------------------------------------- | ------------------------------------------- |
| **Webpack** | 全能打包器,生态与可定制性天花板 | 复杂依赖、多页、微前端(MF)、深度定制                    | 大型 / 遗留 / 生态依赖重的应用          | 配置复杂、构建相对慢                        |
| **Rollup**  | ESM 优先,产出干净               | **tree-shaking 与库产物质量**(webpack 的摇树也受它启发) | 打包**发布型库**(npm 包)                | 应用级开发体验弱(无 HMR 生态等)             |
| **esbuild** | 用 Go 换极致速度                | 转译 / 打包**极快**                                     | 作底层引擎、单文件转译、替代 Babel 场景 | 能力面窄,多作"轮子"而非"整车"               |
| **Vite**    | 开发原生 ESM + 构建 Rollup      | **启动毫秒级**、配置极简、开箱 DX                       | **新 SPA 应用**、中后台、组件 demo      | 对极端定制 / 复杂遗留依赖的支持不如 webpack |

选型速断:

- **新起的纯前端 SPA** → 默认 **Vite**(快 + 简单),大部分场景不必再用 webpack;
- **库 / 组件要发 npm** → **Rollup**(或 tsup,本仓库 `@mzy1120/*` 子包就是用 tsup 打的,本质是 esbuild + Rollup 的组合),产物又小又干净;
- **复杂老项目 / 强生态依赖 / 微前端 / 需要 Webpack 全家能力** → **Webpack**;
- 想要"快"的底层能力 → **esbuild**。

**值得庆幸的是**:这四个工具的概念是**同构的**——`mode`/`devtool` 的"开发快 vs 生产小"两难、代码分割、摇树、Source Map、`contenthash` 缓存心智,在 Vite 与 Rollup 里全都成立。**把本系列沉淀的这套"心智模型"带走,换工具只是换个配置方言**;生产构建的优化思路(Vite 的 build 用 Rollup,Vite 源码依旧要 ESM 才能摇树)几乎原样迁移。

## 速查

| 主题              | 一句话记住                                                                       |
| ----------------- | -------------------------------------------------------------------------------- |
| 配置拆分          | `common + dev + prod` 三件套,`webpack-merge` 合并,按 loader 链差异决定放哪份     |
| 产物分析          | `--profile --json` 出 stats → Bundle Analyzer 树图,盯"大且不常用"与"重复版本"    |
| Source Map        | devtool 是词缀组合;生产 map 只交监控平台、**绝不公开部署**                       |
| Asset Modules     | `asset` / `asset/resource` / `asset/inline` / `asset/source` 取代三个旧 loader   |
| Module Federation | 运行期共享模块,`exposes` 出 / `remotes` 进 / `shared` 控单例;微前端主力,但别滥用 |
| 生态选型          | 新应用用 Vite、发布库用 Rollup/tsup、复杂定制与微前端用 Webpack,概念全部通用     |

> 官方文档:webpack.js.org/guides/production、/guides/development、/plugins/split-chunks-plugin、/concepts/module-federation、/guides/asset-modules、webpack.js.org/configuration/devtool;Vite / Rollup / esbuild 见各官网。系列到此收尾,回到 [总纲](./README.md) 可按需回看单篇。
