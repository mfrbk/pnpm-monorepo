# Webpack 核心概念与基础配置

> [← 返回总纲](./README.md) · 本系列第 1 篇:五大核心概念 Entry / Output / Loader / Plugin / Mode 的"为什么"与"怎么配"

配置一个 Webpack 工程,大多数新手都死于同一件事:**把配置当"咒语"背**——`module.rules` 照抄、`output` 凭感觉,出了问题只能全网搜。这一篇的目标是让你对五大核心概念建立**因果式理解**:每个配置项到底在回答哪个问题、改动它会影响构建的哪一环。

## 先建立整体心智模型

Webpack 自称 **module bundler(模块打包器)**。它干的事一句话:**从"入口"出发,顺着代码里的 import/require 把整棵"模块依赖图"摸清,再把它们加工、合并成浏览器能用的静态资源(JS/CSS/图片…)**。

一个从未配置过的人最容易踩的坑,是以为 Webpack 只是"把很多 JS 拼成一个 JS"。实际上它有一套**流水线**,五大概念分别卡在流水线的不同工位:

```
 入口文件(Entry) ──► 依赖图解析 ──► Loader 逐文件翻译 ──► Plugin 全程介入 ──► 输出(Output)
                     (顺着 import 摸全)   (TS/Sass/Vue → 标准 JS)  (压缩/注入HTML/抽CSS)    (带哈希的文件)
                                                         │
                                                         ▼
                                                   Mode 决定整条产线的"出厂档位"
```

**一句话记住五个概念**:

| 概念   | 一句话本质                                        | 类比                |
| ------ | ------------------------------------------------- | ------------------- |
| Entry  | 依赖图的起点,告诉 Webpack"从哪开始数"             | 抽线头              |
| Output | 打包结果写到哪、叫什么名                          | 成品出口            |
| Loader | 把 Webpack 看不懂的文件翻译成能处理的模块         | 翻译官(文件级)      |
| Plugin | 在构建生命周期各环节"插一脚",做 loader 做不了的事 | 施工监理 / 改造工   |
| Mode   | 一键切换内置优化策略                              | 出厂档位(开发/生产) |

## 一、Entry:从哪开始"数依赖"

入口是**依赖图(Module Graph)的根**。Webpack 启动后会解析入口文件、递归收集它 import/require 到的所有模块,最终形成一棵图。入口怎么配,决定了"一张页面 = 多少个 chunk 起点"。

**单入口**(最常见,SPA):

```js
module.exports = {
  entry: './src/index.js',
}
```

**多入口**(多页应用 MPA,每个页面一个入口):

```js
module.exports = {
  entry: {
    home: './src/home.js',
    about: './src/about.js',
  },
}
```

> **多入口的隐藏坑**:如果 `home` 和 `about` 都 import 了同一个工具库,默认情况下它会**在两个产物里各打一份**(重复)。去重需要交给 [性能篇](./performance.md) 的 `splitChunks`,而不是指望 Webpack 自动聪明。

## 二、Output:产物写到哪、叫什么

Output 回答两个问题:**位置**(`path`)和**命名**(`filename`/`chunkFilename`)。命名看似小事,却直接决定浏览器能否"长效缓存 + 精准失效"。

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

`filename` 支持占位符,最容易混淆的是三种 hash。**它们最本质的区别是"粒度"不同**:

| 占位符                      | 计算粒度              | 变化时机                         | 典型用途                             |
| --------------------------- | --------------------- | -------------------------------- | ------------------------------------ |
| `[fullhash]`(旧称 `[hash]`) | 整次构建(compilation) | **任何一个文件**改动就全变       | 几乎不用做缓存                       |
| `[chunkhash]`               | 每个 chunk            | 该 chunk 内容变化才变            | 早期版本用法,现在被 contenthash 取代 |
| `[contenthash]`             | 单个产物文件的内容    | **只有这个文件自身内容变了**才变 | 长效缓存首选                         |

**为什么缓存场景首选 `[contenthash]`**:文件名里带上内容哈希后,文件没变 → 文件名不变 → 浏览器命中本地缓存;只有内容真的变了 → 文件名变 → 才重新下载。`[fullhash]` 因为"牵一发动全身",会让无关文件也全部失效缓存。

```js
// 只改了一行注释,产物是什么结果?
// [contenthash]:只有改动涉及的那个文件 hash 变化,其余全部不变 ✅
// [fullhash]  :所有文件的 hash 全部变化,缓存全部失效 ❌
```

> **`contenthash` 的经典误区**:入口 JS 里通过 `import './style.css'` 引入的 CSS 被 [MiniCssExtractPlugin](#plugin) 抽成独立文件后,**CSS 自己的 `[contenthash]` 仍基于 CSS 内容**,改 JS 不会连累 CSS 缓存——这正是抽 CSS 的意义之一。但依赖图里某模块变化若导致**入口 chunk 结构**变化(如新增/删除一个公共依赖),所属 chunk 的 hash 仍会联动,属正常现象。

### publicPath:决定资源"从哪被引用"

`publicPath` 不决定文件写在哪,而是决定**浏览器加载资源时拼的 URL 前缀**。它影响三类东西:HTML 里引 JS/CSS 的路径、运行时懒加载请求 chunk 的路径、CSS 里 `url()` 引用的图片路径。

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

**坑**:开发时用了绝对 `publicPath`,打开 dev server 页面会发现资源 404——dev 与 prod 的 publicPath 往往要分开配(这正是 [工程化篇](./engineering.md) 拆分配置的理由之一)。

## 三、Loader:逐文件的"翻译官"

Webpack 原生只认 JS。项目里的 TS、JSX、Sass、Vue 单文件、图片……它全看不懂。**Loader 就是逐文件把"Webpack 看不懂的内容"翻译成它能处理的 JS 模块**——所以它一定是"文件级"的(一个文件一个文件地过)。

### 单一职责 + 链式调用

Loader 遵守**单一职责原则**:一个 loader 只做一件小事。因此真实场景通常是**多个 loader 串成一条链**,而链的**执行顺序是从右到左、从下到上**:

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.scss$/, // 匹配 .scss 文件
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

**为什么是从右往左?** 因为**下一个 loader 的输出,是上一个 loader 的输入**。Sass 源码 →(sass-loader)→ CSS →(css-loader)→ 模块化 JS →(style-loader)→ 注入 DOM。把顺序记成"sass 先跑",比死记"从右到左"更不容易错。

规则里常用的匹配字段:

| 字段             | 作用                             | 典型值                                                        |
| ---------------- | -------------------------------- | ------------------------------------------------------------- |
| `test`           | 用正则匹配**文件名**             | `/\.tsx?$/`、`/\.css$/`                                       |
| `include`        | **只处理**这些目录(缩小范围提速) | `path.resolve(__dirname, 'src')`                              |
| `exclude`        | **跳过**这些目录                 | `/node_modules/`                                              |
| `use` / `loader` | 用哪个 loader(数组 = 链)         | `'babel-loader'`、`[{ loader: 'ts-loader', options: {...} }]` |
| `enforce`        | 强制链中的顺序位置               | `'pre'`(最先)/ `'post'`(最后)                                 |

> **性能提示**:`include`/`exclude` 不是锦上添花。把 `babel-loader` 之类限制在 `src/`、排除 `node_modules`,构建能肉眼可见地变快,详见 [性能篇的提速章节](./performance.md)。

### 一份"翻译官"实操清单

- **TS**:`ts-loader` 或 `babel-loader + @babel/preset-typescript`
- **JSX/新语法**:`babel-loader + @babel/preset-env + @babel/preset-react`
- **样式**:`sass-loader → css-loader → style-loader`(开发)或抽 CSS(生产)
- **图片字体**:Webpack 5 推荐直接用内建的 [Asset Modules](./engineering.md)(不再需要 `file-loader`/`url-loader`)

## 四、Plugin:贯穿全流程的"监理"

Loader 只能"一个一个文件地改内容",但很多需求**天生是全局的**:生成 HTML、压缩整个产物、抽离所有 CSS、注入全局常量、拷贝静态目录……这些都属于 Plugin 的活。

**Loader 与 Plugin 的分工本质**:

|          | Loader             | Plugin                                    |
| -------- | ------------------ | ----------------------------------------- |
| 作用粒度 | 单个文件内容       | 整个构建流程(生命周期)                    |
| 介入时机 | 模块"被翻译"时     | 构建的各个阶段钩子(编译前/打包时/输出后…) |
| 能干的事 | 格式转换           | 压缩、注入、抽离、生成文件、监听优化      |
| 实现形态 | 一个导出函数的模块 | 一个带 `apply(compiler)` 的对象           |

Plugin 的威力来自它能**监听 Webpack 内部生命周期钩子**并干预(底层机制叫 Tapable,详见 [底层原理篇](./internals.md))。日常最常用的三个:

```js
const HtmlWebpackPlugin = require('html-webpack-plugin')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const webpack = require('webpack')

module.exports = {
  plugins: [
    // ① 自动生成 HTML,并把打包出的 JS/CSS 注入进去
    new HtmlWebpackPlugin({
      template: './public/index.html', // 基于模板生成
      filename: 'index.html',
    }),

    // ② 把 CSS 从 JS 里抽成独立 .css 文件(生产缓存、并行加载都更好)
    new MiniCssExtractPlugin({
      filename: 'css/[name].[contenthash:8].css',
    }),
    // 配合上面抽 CSS,规则里要把 style-loader 换成它的 loader:
    // use: [MiniCssExtractPlugin.loader, 'css-loader']

    // ③ 编译期把代码里的标识符替换成常量(注意外层 JSON.stringify)
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
      __APP_VERSION__: JSON.stringify('1.2.0'),
    }),
  ],
}
```

**HtmlWebpackPlugin 与多入口的配合**:一个页面一个实例,用 `chunks` 指定该页注入哪些入口产物:

```js
new HtmlWebpackPlugin({ filename: 'home.html', chunks: ['home', 'commons'] })
new HtmlWebpackPlugin({ filename: 'about.html', chunks: ['about', 'commons'] })
```

> **DefinePlugin 为什么要 `JSON.stringify`?** 它做的是**字面量替换**,不是求值。`'production'` 直接写会变成裸标识符 `production`(一个未定义变量)。包一层 `JSON.stringify` 让替换结果带上引号,才能得到字符串 `"production"`。业务代码里常见的 `process.env.NODE_ENV` 判断就靠它注入。

## 五、Mode:一键切换"出厂档位"

`mode` 是 Webpack 给的"省心包":设置一个值,它自动帮你打开/关闭一批内置优化。它是"默认行为"的开关,**不是"魔法"**,每个档位都能用具体配置覆盖:

```bash
webpack --mode=development   # 或配置文件里 mode: 'development'
webpack --mode=production
```

| 行为                    | `development`                                 | `production`                                                            |
| ----------------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| `process.env.NODE_ENV`  | `development`                                 | `production`(自动 DefinePlugin 注入)                                    |
| 模块 / chunk 命名       | 可读的名字(利于调试)                          | `deterministic` 确定性短 id(利于缓存)                                   |
| 压缩(minimize / Terser) | ❌ 不压缩,保留可读代码                        | ✅ 默认开启                                                             |
| Tree Shaking            | 关闭相关激进优化                              | ✅ `usedExports` + `sideEffects` 默认开启                               |
| Scope Hoisting          | 默认关闭                                      | ✅ `concatenateModules` 开启,产物更小更快                               |
| 持久化缓存              | 默认 `cache.type = 'memory'`,watch 下自动生效 | 默认**不开启** filesystem;跨次构建提速需显式 `cache.type: 'filesystem'` |

> `mode` 把"我要开发"还是"我要上线"翻译成**几十个具体默认值**。理解这一层之后,很多"为什么我 `mode: 'production'` 后代码被改了 / 变量被删了"的困惑都能解开——不是 bug,是 Terser 在摇树 + 压缩。

## 附:一份带注释的最小完整配置

把五个概念放回同一份配置里串一遍,是这篇最好的收尾练习:

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

| 概念   | 记住什么                                              | 最易踩的坑                             |
| ------ | ----------------------------------------------------- | -------------------------------------- |
| Entry  | 依赖图起点;多入口共享依赖会重复打包                   | 忘了给公共代码做 splitChunks           |
| Output | `[contenthash]` 按文件内容算哈希,缓存首选             | dev/prod 的 publicPath 混用导致 404    |
| Loader | 链式从右到左;单一职责;`test/include/exclude` 决定匹配 | 顺序写反(如 sass-loader 写在最左)      |
| Plugin | 介入生命周期,做全局的事                               | 把 loader 的活(文件转换)硬写成 plugin  |
| Mode   | production 自动开压缩 / 摇树 / 作用域提升             | 生产产物"变了"却不知道是压缩与摇树干的 |

> 官方文档:webpack.js.org(Concepts: Entry/Output/Loaders/Plugins/Mode)、webpack.js.org/guides/output-management、webpack.js.org/configuration。下一篇:[性能优化:体积与速度](./performance.md)。
