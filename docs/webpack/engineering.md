# Webpack 工程化实践与生态扩展

> 本系列第 4 篇:配置拆分 / 产物分析 / Source Map 策略 / Asset Modules / Module Federation / 构建工具选型。· [← 返回总纲](./README.md)

真实工程不是一份 `webpack.config.js` 走天下,而是一套**可维护的配置体系 + 可量化的调试手段 + 对生态的清醒认识**。

## 一、配置拆分(webpack-merge)

dev 与 prod 对配置的诉求几乎相反(开发要快/HMR/readable,生产要小/缓存/压缩),塞进一个文件互相覆盖即维护地狱。解法:抽"公共 + 环境差异"三件套,用 **webpack-merge** 合并:

```
webpack.common.js   入口/输出规则、loader、公共插件(所有环境都要的)
webpack.dev.js      开发:devServer、快 devtool、style-loader、HMR
webpack.prod.js     生产:contenthash、抽 CSS、压缩(大多靠 mode: 'production' 自动)
```

**webpack.common.js**——只放"全环境一致"部分:

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

**webpack.dev.js**:

```js
const { merge } = require('webpack-merge')
const common = require('./webpack.common.js')

module.exports = merge(common, {
  mode: 'development',
  devtool: 'eval-cheap-module-source-map', // 构建快且能定位到源码(见 Source Map 节)
  devServer: {
    port: 3000,
    open: true,
    hot: true, // HMR
    historyApiFallback: true, // SPA 路由交给前端 history
  },
})
```

**webpack.prod.js**:

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

**为何不用一份配置 + 一堆 if/env 判断**:dev/prod 的差异往往是**整段规则不同**(loader 链都换了),三份文件各自可独立阅读、独立运行。`webpack-merge` 合并数组默认"后者覆盖前者同名项",合并 loader/plugin 数组可 `mergeWithRules` 精确控制。

package.json 命令:

```json
{
  "scripts": {
    "dev": "webpack serve --config webpack.dev.js",
    "build": "webpack --config webpack.prod.js"
  }
}
```

## 二、产物分析

优化体积不能靠猜,先看**到底哪些模块占了空间**。

### 生成 stats 档案

`stats.json` 含一次构建的模块、chunk、体积、依赖耗时:

```bash
npx webpack --profile --json > stats.json
```

### 可视化:webpack-bundle-analyzer

`webpack-bundle-analyzer` 把它渲染成**交互式矩形树图(Treemap)**,面积 = 体积占比,点击下钻:

```js
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin

module.exports = {
  plugins: [new BundleAnalyzerPlugin()], // 构建完自动开浏览器展示
}
```

也可不侵入构建配置,单独针对 stats 打开:

```bash
npx webpack-bundle-analyzer stats.json
```

树图重点盯三类问题:

| 现象                           | 常见成因                    | 处理方向                                        |
| ------------------------------ | --------------------------- | ----------------------------------------------- |
| 某个大库几乎没用到             | 引了整库 / 摇树失效(CJS 版) | 换 ESM 版 / 按需引,见[性能篇](./performance.md) |
| 同一个库出现多个版本(面积重复) | 依赖升级不一致,装了两份     | 用 pnpm 统一版本 / `resolve.alias` 指向单版本   |
| 某个 chunk 巨大导致首屏慢      | 懒加载切分粒度不够          | 继续拆 `import()` + splitChunks                 |

> 取舍原则:"大且常用"留下,"大且不常用"懒加载,"大且纯演示"直接砍。

## 三、Source Map

压缩产物报错时堆栈是压缩代码,无法定位。Source Map 即"产物行号 ↔ 源码位置"的翻译表。

### devtool 命名规则

`devtool` 各值由**含义正交的词缀**组合:

| 词缀         | 含义                                                       |
| ------------ | ---------------------------------------------------------- |
| `eval`       | 模块用 `eval` 包裹并内嵌来源标记,构建最快,但代码直接可见   |
| `cheap`      | 只映射到行,不做列级精确映射,省体积省时间                   |
| `module`     | 映射到 loader 处理前的原始源码(而非转换后产物)             |
| `source-map` | 生成独立的 `.map` 文件                                     |
| `inline`     | map 以 data URI 内嵌进产物,文件显著变大                    |
| `hidden`     | 生成 `.map` 但不写 sourceMappingURL 注释(浏览器不主动加载) |
| `nosources`  | 映射只有行列信息、不含源码内容,能定位但不泄露源码          |

### 推荐策略

| 环境 | 推荐                                                                   | 理由                               |
| ---- | ---------------------------------------------------------------------- | ---------------------------------- |
| 开发 | `eval-cheap-module-source-map`(极速)或 `eval-source-map`(完整源码调试) | 本机调试,快 + 能定位到原始源码即可 |
| 生产 | `source-map` / `hidden-source-map`(需线上还原)或关闭(不需要)           | 见下方红线                         |

**生产 Source Map 红线**:

- **别把 `.map` 与产物一起公开部署**——map 含完整源码。监控平台(Sentry / Bugsnag / ARMS…)支持上传 map 后即删,线上只留无 map 产物。
- 需要"出问题能还原、平时不泄露":用 `hidden-source-map`,map 交给监控平台,产物不写 sourceMappingURL。
- 无错误监控诉求则生产 `devtool: false`,省构建与传输开销。

## 四、Webpack 5 前沿特性

### Asset Modules

Webpack 5 把静态资源(图片、字体、文本)处理的三种 loader 内置为资源模块类型:

| 类型             | 行为                                   | 取代                         |
| ---------------- | -------------------------------------- | ---------------------------- |
| `asset/resource` | 输出独立文件,返回 URL                  | `file-loader`                |
| `asset/inline`   | 转成 base64 data URI 内联              | `url-loader`(limit 打满)     |
| `asset/source`   | 导出文件原始内容字符串                 | `raw-loader`                 |
| `asset`          | 自动选择:小于阈值内联,超过则独立成文件 | `url-loader` 按 limit 二选一 |

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

阈值可显式调:`type: 'asset'` 时配 `parser: { dataUrlCondition: { maxSize: 4 * 1024 } }`。

### Module Federation

传统共享代码只有发 npm 包、下游构建期安装一条路——改一次组件要发版、要等下游全部重打包。Module Federation 让**多个独立构建的应用在运行时互相"借"模块**,主打微前端:

```js
// A) remote——"借出方"(如独立的组件应用)
const { ModuleFederationPlugin } = require('webpack')

new ModuleFederationPlugin({
  name: 'mf_components', // remote 全局标识
  filename: 'remoteEntry.js', // 借出入口(一个清单文件)
  exposes: { './Button': './src/components/Button.jsx' }, // 暴露哪些模块
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

host 按需动态加载 remote 暴露的模块,像懒加载一样:

```js
const Button = React.lazy(() => import('components/Button')) // 运行时才去 remote 拉
```

| 对比维度 | npm 包共享                  | Module Federation                            |
| -------- | --------------------------- | -------------------------------------------- |
| 共享时机 | 构建期(装包、打进产物)      | 运行期(按需拉取)                             |
| 升级成本 | remote 发版 → host 全部重发 | remote 单独部署即生效,host 不用动            |
| 依赖管理 | 各自打包,易重复             | `shared + singleton` 让 React 等全站只留一份 |
| 适用     | 代码高内聚、要版本契约      | 微前端、跨团队交付、主应用瘦身               |

> 权衡:MF 代价是应用间运行时强耦合、shared 版本协商复杂、remote 挂了会拖累 host。适合"多个团队各自独立发版、又要共享运行时"的中大型微前端。相比 iframe / qiankun 等隔离方案,MF 不开 iframe、JS/CSS 共享自然,但对构建体系(全 webpack)与约定要求更高。
> 完整版(从零搭 host+remote、remoteEntry 与 shareScope 运行时机制、`React.lazy` 消费、版本协商、CORS/publicPath 坑)见专题[《Module Federation》](./module-federation.md)。

### 别忘了:持久化缓存

`cache.type: 'filesystem'` 让 **CI 能跨构建复用缓存**,是生产级工程提速的首选开关,详见[性能篇](./performance.md),这里只作回指。

## 五、生态视野:何时选 Vite / Rollup / esbuild

选型看"构建什么",四类工具定位差异很大:

| 工具        | 核心哲学                        | 强项                                 | 适合场景                           | 局限                                    |
| ----------- | ------------------------------- | ------------------------------------ | ---------------------------------- | --------------------------------------- |
| **Webpack** | 全能打包器,生态与可定制性天花板 | 复杂依赖、多页、微前端(MF)、深度定制 | 大型 / 遗留 / 生态依赖重的应用     | 配置复杂、构建相对慢                    |
| **Rollup**  | ESM 优先,产出干净               | tree-shaking 与库产物质量            | 打包发布型库(npm 包)               | 应用级开发体验弱                        |
| **esbuild** | 用 Go 换极致速度                | 转译 / 打包极快                      | 作底层引擎、单文件转译、替代 Babel | 能力面窄,多作"轮子"而非"整车"           |
| **Vite**    | 开发原生 ESM + 构建 Rollup      | 启动毫秒级、配置极简、开箱 DX        | 新 SPA 应用、中后台、组件 demo     | 极端定制 / 复杂遗留依赖支持不如 webpack |

选型速断:

- 新起的纯前端 SPA → 默认 **Vite**(快 + 简单);
- 库 / 组件发 npm → **Rollup**(或 tsup——本仓库 `@mzy1120/*` 子包即 tsup 构建,esbuild + Rollup 组合),产物又小又干净;
- 复杂老项目 / 强生态依赖 / 微前端 / 需要 Webpack 全家能力 → **Webpack**;
- 想要"快"的底层能力 → **esbuild**。

四个工具的概念是**同构**的:dev/prod 两难、代码分割、摇树、Source Map、contenthash 缓存心智在 Vite / Rollup 里全部成立。把这一套心智带走,**换工具只是换配置方言**(Vite 的 build 用 Rollup,Vite 里也要 ESM 才能摇树)。

## 速查

| 主题              | 一句话记住                                                                       |
| ----------------- | -------------------------------------------------------------------------------- |
| 配置拆分          | `common + dev + prod` 三件套,`webpack-merge` 合并,按 loader 链差异决定放哪份     |
| 产物分析          | `--profile --json` 出 stats → Bundle Analyzer 树图,盯"大且不常用"与"重复版本"    |
| Source Map        | devtool 是词缀组合;生产 map 只交监控平台、绝不公开部署                           |
| Asset Modules     | `asset` / `asset/resource` / `asset/inline` / `asset/source` 取代三个旧 loader   |
| Module Federation | 运行期共享模块,`exposes` 出 / `remotes` 进 / `shared` 控单例;微前端主力,但别滥用 |
| 生态选型          | 新应用用 Vite、发布库用 Rollup/tsup、复杂定制与微前端用 Webpack,概念全部通用     |

> 官方文档:webpack.js.org/guides/production、/guides/development、/plugins/split-chunks-plugin、/concepts/module-federation、/guides/asset-modules、webpack.js.org/configuration/devtool;Vite / Rollup / esbuild 见各官网。系列收尾,回到[总纲](./README.md)。
