# Webpack 核心概念与基础配置

> 本系列第 1 篇:Entry / Output / Loader / Plugin / Mode 五大核心概念——每个配置项回答什么问题、改动影响构建的哪一环。· [← 返回总纲](./README.md)

## 整体模型:module bundler 的流水线

Webpack 是 **module bundler(模块打包器)**:从"入口"出发,顺着代码里的 import/require 摸清整棵"模块依赖图",再加工、合并成浏览器能用的静态资源(JS/CSS/图片…)。

五大概念分别卡在流水线的不同工位:

```
入口文件(Entry) ──► 依赖图解析 ──► Loader 逐文件翻译 ──► Plugin 全程介入 ──► 输出(Output)
                   (顺着 import 摸全)   (TS/Sass/Vue → 标准 JS)  (压缩/注入HTML/抽CSS)    (带哈希的文件)
                                                       │
                                                       ▼
                                                 Mode 决定整条产线的"出厂档位"
```

| 概念   | 本质                                              | 类比                |
| ------ | ------------------------------------------------- | ------------------- |
| Entry  | 依赖图的起点,告诉 Webpack"从哪开始数"             | 抽线头              |
| Output | 打包结果写到哪、叫什么名                          | 成品出口            |
| Loader | 把 Webpack 看不懂的文件翻译成能处理的模块         | 翻译官(文件级)      |
| Plugin | 在构建生命周期各环节"插一脚",做 loader 做不了的事 | 施工监理 / 改造工   |
| Mode   | 一键切换内置优化策略                              | 出厂档位(开发/生产) |

## 一、Entry:从哪开始"数依赖"

入口是**依赖图(Module Graph)的根**。Webpack 解析入口文件、递归收集它 import/require 到的所有模块,形成一棵图。入口怎么配,决定"一张页面 = 多少个 chunk 起点"。

单入口(SPA):

```js
module.exports = {
  entry: './src/index.js',
}
```

多入口(MPA,每个页面一个入口):

```js
module.exports = {
  entry: {
    home: './src/home.js',
    about: './src/about.js',
  },
}
```

> **多入口的隐藏坑**:若 `home` 和 `about` 都 import 同一个工具库,默认会在两个产物里各打一份(重复)。去重需交给 [性能篇](./performance.md) 的 `splitChunks`,不能指望 Webpack 自动聪明。

## 二、Output:产物写到哪、叫什么

Output 回答两个问题:**位置**(`path`)与**命名**(`filename`/`chunkFilename`)。命名直接决定浏览器能否"长效缓存 + 精准失效"。

```js
const path = require('path')

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'), // 产物目录(绝对路径)
    filename: 'js/[name].[contenthash:8].js', // 入口 chunk 名
    chunkFilename: 'js/[name].[contenthash:8].chunk.js', // 懒加载 chunk 名
    publicPath: '/', // 资源被引用的公共 URL 前缀
    clean: true, // 每次构建先清空 dist(Webpack 5)
  },
}
```

### filename 占位符:[hash] 家族的语义差异

三种 hash 的区别是**计算粒度**:

| 占位符                      | 计算粒度              | 变化时机                   | 典型用途                         |
| --------------------------- | --------------------- | -------------------------- | -------------------------------- |
| `[fullhash]`(旧称 `[hash]`) | 整次构建(compilation) | 任何一个文件改动就全变     | 几乎不用做缓存                   |
| `[chunkhash]`               | 每个 chunk            | 该 chunk 内容变化才变      | 早期用法,现多被 contenthash 取代 |
| `[contenthash]`             | 单个产物文件的内容    | 只有该文件自身内容变了才变 | 长效缓存首选                     |

缓存场景选 `[contenthash]`:文件没变 → 文件名不变 → 命中本地缓存;内容变了 → 文件名变 → 重新下载。`[fullhash]` "牵一发动全身",会让无关文件缓存也全部失效。

```js
// 只改了一行注释,产物是什么结果?
// [contenthash]:只有改动涉及的那个文件 hash 变化,其余全部不变 ✅
// [fullhash]  :所有文件的 hash 全部变化,缓存全部失效 ❌
```

> **contenthash 经典误区**:入口 JS 通过 `import './style.css'` 引入的 CSS 被 MiniCssExtractPlugin 抽成独立文件后,CSS 自己的 `[contenthash]` 仍基于 CSS 内容,改 JS 不会连累 CSS 缓存——这正是抽 CSS 的意义之一。但依赖图某模块变化导致入口 chunk 结构变化(如增删公共依赖)时,所属 chunk 的 hash 仍会联动,属正常现象。

### publicPath:决定资源"从哪被引用"

`publicPath` 不决定文件写在哪,而是决定**浏览器加载资源时拼的 URL 前缀**,影响:HTML 引 JS/CSS 的路径、运行时懒加载 chunk 的路径、CSS 里 `url()` 引用的图片路径。

| 场景          | publicPath                  | 效果                     |
| ------------- | --------------------------- | ------------------------ |
| 本地/相对部署 | `''` 或 `'auto'`            | 相对当前页面找资源       |
| 站点子目录    | `'/assets/'`                | 从域名根下的 assets 加载 |
| CDN           | `'https://cdn.xx.com/app/'` | 资源全部走 CDN 域名      |

```js
// 静态资源部署在 CDN,index.html 仍在本站
module.exports = {
  output: {
    publicPath: 'https://cdn.xx.com/assets/',
  },
}
```

**坑**:开发时用绝对 `publicPath`,dev server 页面资源会 404——dev 与 prod 的 publicPath 通常要分开配([工程化篇](./engineering.md) 拆分配置的理由之一)。

## 三、Loader:逐文件的"翻译官"

Webpack 原生只认 JS;TS、JSX、Sass、Vue 单文件、图片等都需要 Loader **逐文件翻译成它能处理的 JS 模块**。所以 Loader 一定是"文件级"的(一个文件一个文件地过)。

### 单一职责 + 链式调用

Loader 遵守**单一职责**,真实场景多是多个 loader 串成一条链,链的**执行顺序从右到左、从下到上**:

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.scss$/,
        use: [
          'style-loader', // ③ 最左,最后执行:把 CSS 以 <style> 注入页面
          'css-loader', // ② 中间:解析 @import / url(),把 CSS 变成 JS 模块
          'sass-loader', // ① 最右,最先执行:把 Sass 编译成标准 CSS
        ],
      },
    ],
  },
}
```

顺序依据:**下一个 loader 的输出是上一个 loader 的输入**。Sass 源码 →(sass-loader)→ CSS →(css-loader)→ 模块化 JS →(style-loader)→ 注入 DOM。

常用匹配字段:

| 字段             | 作用                         | 典型值                                                        |
| ---------------- | ---------------------------- | ------------------------------------------------------------- |
| `test`           | 用正则匹配文件名             | `/\.tsx?$/`、`/\.css$/`                                       |
| `include`        | 只处理这些目录(缩小范围提速) | `path.resolve(__dirname, 'src')`                              |
| `exclude`        | 跳过这些目录                 | `/node_modules/`                                              |
| `use` / `loader` | 用哪个 loader(数组 = 链)     | `'babel-loader'`、`[{ loader: 'ts-loader', options: {...} }]` |
| `enforce`        | 强制链中的顺序位置           | `'pre'`(最先)/ `'post'`(最后)                                 |

> **性能**:`include`/`exclude` 不是锦上添花。把 `babel-loader` 限制在 `src/`、排除 `node_modules`,构建会肉眼可见变快,详见[性能篇的提速章节](./performance.md)。

### 常见翻译组合

- TS:`ts-loader` 或 `babel-loader + @babel/preset-typescript`
- JSX/新语法:`babel-loader + @babel/preset-env + @babel/preset-react`
- 样式:`sass-loader → css-loader → style-loader`(开发)或抽 CSS(生产)
- 图片字体:Webpack 5 直接用内建 [Asset Modules](./engineering.md)(无需 `file-loader`/`url-loader`)

## 四、Plugin:贯穿全流程的"监理"

Loader 只能逐个文件改内容;生成 HTML、压缩整个产物、抽离 CSS、注入全局常量等**全局性**需求由 Plugin 承担。

|          | Loader             | Plugin                                |
| -------- | ------------------ | ------------------------------------- |
| 作用粒度 | 单个文件内容       | 整个构建流程(生命周期)                |
| 介入时机 | 模块"被翻译"时     | 构建各阶段钩子(编译前/打包时/输出后…) |
| 能干的事 | 格式转换           | 压缩、注入、抽离、生成文件、监听优化  |
| 实现形态 | 一个导出函数的模块 | 一个带 `apply(compiler)` 的对象       |

Plugin 靠监听 Webpack 内部生命周期钩子干预(底层机制 Tapable,见[底层原理篇](./internals.md))。最常用的三个:

```js
const HtmlWebpackPlugin = require('html-webpack-plugin')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const webpack = require('webpack')

module.exports = {
  plugins: [
    // ① 自动生成 HTML,并把打包出的 JS/CSS 注入进去
    new HtmlWebpackPlugin({
      template: './public/index.html',
      filename: 'index.html',
    }),

    // ② 把 CSS 从 JS 里抽成独立 .css 文件(生产缓存、并行加载都更好)
    new MiniCssExtractPlugin({
      filename: 'css/[name].[contenthash:8].css',
    }),
    // 配合抽 CSS,规则里要把 style-loader 换成 MiniCssExtractPlugin.loader:
    // use: [MiniCssExtractPlugin.loader, 'css-loader']

    // ③ 编译期把代码里的标识符替换成常量(注意外层 JSON.stringify)
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
      __APP_VERSION__: JSON.stringify('1.2.0'),
    }),
  ],
}
```

HtmlWebpackPlugin 与多入口配合:一个页面一个实例,用 `chunks` 指定注入哪些入口产物:

```js
new HtmlWebpackPlugin({ filename: 'home.html', chunks: ['home', 'commons'] })
new HtmlWebpackPlugin({ filename: 'about.html', chunks: ['about', 'commons'] })
```

> **DefinePlugin 为何要 `JSON.stringify`**:它做**字面量替换**而非求值。`'production'` 直接写会变成裸标识符 `production`(未定义变量);包 `JSON.stringify` 让替换结果带引号,才是字符串 `"production"`。

## 五、Mode:一键切换"出厂档位"

`mode` 自动打开/关闭一批内置优化,是"默认行为"的开关(非魔法,每项都可用具体配置覆盖):

```bash
webpack --mode=development   # 或配置文件里 mode: 'development'
webpack --mode=production
```

| 行为                    | `development`                                 | `production`                                                        |
| ----------------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| `process.env.NODE_ENV`  | `development`                                 | `production`(自动 DefinePlugin 注入)                                |
| 模块 / chunk 命名       | 可读名字(利于调试)                            | `deterministic` 确定性短 id(利于缓存)                               |
| 压缩(minimize / Terser) | ❌ 不压缩                                     | ✅ 默认开启                                                         |
| Tree Shaking            | 关闭相关激进优化                              | ✅ `usedExports` + `sideEffects` 默认开启                           |
| Scope Hoisting          | 默认关闭                                      | ✅ `concatenateModules` 开启,产物更小更快                           |
| 持久化缓存              | 默认 `cache.type = 'memory'`,watch 下自动生效 | 默认不开启 filesystem;跨次构建提速需显式 `cache.type: 'filesystem'` |

> `mode` 把"开发/上线"翻译成几十个具体默认值。理解后,"为什么 `mode: 'production'` 后代码被改/变量被删"的困惑可解——是 Terser 在摇树 + 压缩,不是 bug。

## 附:一份带注释的最小完整配置

```js
// webpack.config.js(Webpack 5,注释即概念)
const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')

module.exports = {
  mode: 'development', // Mode:出厂档位,决定一批内置默认行为

  entry: { main: './src/index.js' }, // Entry:依赖图起点

  output: {
    // Output:位置(path)+ 命名(filename,用 contenthash 利于缓存)
    path: path.resolve(__dirname, 'dist'),
    filename: 'js/[name].[contenthash:8].js',
    publicPath: '/',
    clean: true,
  },

  module: {
    rules: [
      {
        test: /\.ts$/,
        include: path.resolve(__dirname, 'src'), // 只翻译 src 下的 TS
        use: 'ts-loader', // Loader:逐个文件翻译
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },

  plugins: [new HtmlWebpackPlugin({ template: './public/index.html' })], // Plugin:全局能力
}
```

## 速查

| 概念   | 记住什么                                              | 最易踩的坑                            |
| ------ | ----------------------------------------------------- | ------------------------------------- |
| Entry  | 依赖图起点;多入口共享依赖会重复打包                   | 忘了给公共代码做 splitChunks          |
| Output | `[contenthash]` 按文件内容算哈希,缓存首选             | dev/prod 的 publicPath 混用导致 404   |
| Loader | 链式从右到左;单一职责;`test/include/exclude` 决定匹配 | 顺序写反(如 sass-loader 写在最左)     |
| Plugin | 介入生命周期,做全局的事                               | 把 loader 的活(文件转换)硬写成 plugin |
| Mode   | production 自动开压缩 / 摇树 / 作用域提升             | 生产产物"变了"却不知是压缩与摇树干的  |

> 官方文档:webpack.js.org(Concepts / output-management / configuration)。下一篇:[性能优化:体积与速度](./performance.md)。
