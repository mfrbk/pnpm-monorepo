# Rollup 核心概念与底层机制

> 本系列第 1 篇:摇树为何强、扁平化输出为何"干净"、es/cjs/iife/umd 四种格式分别给谁用。· [← 返回总纲](./README.md)

Rollup 打包的是"会被其他代码 import 的类库",因此最在意三件事——**体积(别把没用的发出去)、结构(让下游还能继续摇树)、通用(任何环境都能引)**。

## 一、定位:只在意"产物本身"

| 它**不**提供(所以不必有)   | 它**极致**提供                 |
| -------------------------- | ------------------------------ |
| dev server / HMR / 热更    | 摇树、零运行时、扁平化输出     |
| 图片字体等资源管线         | 多格式输出(库要被各种环境引用) |
| 开箱压缩(交给 terser 插件) | 干净、可预测、贴近手写的产物   |

不做应用构建的"脏活",换来了内核的极简与打库的纯粹。

## 二、Tree-shaking:靠"静态"删干净没用的代码

### 为何摇树能做到"精准"

前提是 **ESM 的静态结构**:

- `import { a } from './m'` → 语法上**固定**告诉编译器"我要 m 的 a";
- `export const a = ...` → 语法上**固定**列出模块对外提供了哪些名字。

编译器无需运行代码,只要**解析出每个文件的 import/export 清单**,就能沿依赖图**反推"哪些导出被引用了、哪些没有"**,把从未被引用的导出连同一整段实现从最终产物里删掉:

```
解析入口 → 沿 import 遍历出模块依赖图(每个模块都解析成 AST)
   → 标记:哪些导出被"用到了"(自入口出发可达)
   → 生成:只包含"可达代码",把未使用 export 的实现一并剔除
```

一个"导出 10 个、只用 1 个"的经典例子:

```js
// utils.js —— 导出 10 个工具
export const debounce = () => {
  /* …长实现… */
}
export const throttle = () => {
  /* …长实现… */
}
export const formatDate = () => {
  /* …长实现… */
}
// ……还有 7 个

// index.js —— 只 import 了 1 个
import { debounce } from './utils.js'
export default debounce
```

Rollup 打包 `index.js` 的产物里,**另外 9 个函数会连实现一起消失**——不是留了再压缩,而是构建期压根没生成它们。"库越被下游按需引用,摇树收益越可观"的来源。

### 两个诚实的边界

1. **只对"能静态分析"的删**:直接 `import './setup'`(纯副作用导入)或模块顶层有副作用语句时,Rollup **默认保守保留**。可用 `treeshake.moduleSideEffects: false` 主动声明"本项目无副作用模块",换取更狠的删除(代价同 Webpack 的 `sideEffects:false` 误删 CSS/polyfill,需谨慎):

```js
export default {
  treeshake: {
    moduleSideEffects: false, // 信任模块无副作用,可整文件删除未引用模块
    propertyReadSideEffects: false, // 例:不保守于 obj.prop 的 getter
  },
}
```

2. **摇树 ≠ 压缩**:Rollup 删"未使用的导出与可达性不到的语句",对"不可达分支、死代码的进一步精简"交给**压缩器**(如 `@rollup/plugin-terser`)。**Rollup 负责"结构级删除",Terser 负责"语句级 DCE",两者配合才最彻底**。

## 三、ESM 原生 + 扁平化链接:产物"干净得像手写"

### 没有"运行时",只有"拼接"

Webpack 的产物把每个模块**包进一个函数**、注入 `__webpack_require__` 运行时来驱动加载。**Rollup 默认不引入任何运行时**:按依赖顺序把模块**直接拼接(扁平化链接)**进同一作用域,必要时**重命名符号避免冲突**——构建期就能确定全部静态依赖与命名空间,不需要运行期做模块查找。

```js
// Rollup 的 es 产物(接近源码本身)
const add = (a, b) => a + b
export { add }
// 模块被"摊平":没有包裹函数、没有加载器,只是把内部依赖内联进来
```

相比 Webpack 每模块外层的 `function(module, exports, __webpack_require__){...}` 包裹,**Rollup 产物没有这层"模块外壳"**,于是:

| 收益         | 说明                                                      |
| ------------ | --------------------------------------------------------- |
| 体积更小     | 省掉运行时外壳与加载器的体积,且更利于压缩                 |
| 启动更快     | 无需运行期执行"注册/加载"逻辑                             |
| 更可预测     | 结构接近手写代码,debug 时能直接读                         |
| 利于二次摇树 | 保留 `export` 语法 → 下游打包器(Vite/Webpack)还能再摇一层 |

> 一个代价:**扁平化拼接**对**运行时循环依赖**不如包裹式友好(可能把未初始化的绑定提前执行到)。类库靠 lint/架构避免运行期循环,遇到"某处拿到 undefined"的怪问题可往这个方向排查。

### 保留 export,是给消费者的礼物

库的 es 产物**保留具名导出**(而非把一切包成 default):消费者 `import { debounce } from 'my-lib'` 时,自己的打包器仍能看到真实导出边界、继续摇树——这正是 **lodash-es** 的设计精髓。**打库的人输出 es 并保留 export,等于把"摇树权"交给下游。**

## 四、多格式输出:一套源码,通吃所有运行环境

库的消费者分散在 Node、浏览器、老打包器、CDN……用 **`output.format`** 让同一份源码产出多种目标形态:

| 格式       | 产物形态                             | 谁来用                                  | 需要配合                         |
| ---------- | ------------------------------------ | --------------------------------------- | -------------------------------- |
| `es`(默认) | 原生 `import/export`,保留命名导出    | 现代打包器(Vite/Webpack)与原生 ESM 环境 | 无(最推荐的主产物)               |
| `cjs`      | `module.exports = ...`,走 `require`  | Node 传统 CommonJS、老打包器            | 见下"导出形态"                   |
| `iife`     | `(function(){...})()` 挂一个全局变量 | 浏览器 `<script>` 直接引入              | `output.name` + `output.globals` |
| `umd`      | 一段代码同时兼容 AMD/CommonJS/全局   | CDN 分发、老平台通吃                    | 同 iife(需 `name`/`globals`)     |

```js
// rollup.config.js —— 同一入口,一次产出三种格式
export default {
  input: 'src/index.js',
  output: [
    { file: 'dist/index.js', format: 'es' }, // 现代默认主产物
    { file: 'dist/index.cjs', format: 'cjs', exports: 'named' }, // Node require
    { file: 'dist/index.umd.js', format: 'umd', name: 'MyLib', exports: 'named' },
  ],
}
```

**两个常见配套概念**:

- **`output.name`**(仅 iife/umd):挂到 `window`/`globalThis` 的全局变量名,供 `<script>` 引入后直接用 `MyLib.xxx`。
- **`output.globals`**(有 external 时必配):库把 `React` 声明为外部依赖后,iife/umd 里要告诉 Rollup"运行时这个外部模块叫什么全局名",否则产物里会出现未定义的 `import React`:

```js
export default {
  external: ['react'],
  output: {
    format: 'umd',
    name: 'MyLib',
    globals: { react: 'React' }, // 产物运行时读取全局 React
  },
}
```

### 双发与 package.json:让每个环境拿到自己那份

多格式产物配合 `package.json` 的 `exports` 写清"谁该引哪份"(现代发布标配):

```jsonc
{
  "type": "module",
  "main": "./dist/index.cjs", // 老工具兜底
  "module": "./dist/index.js", // 老打包器识别(保留 export,可摇树)
  "types": "./dist/index.d.ts", // 类型
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }, // ESM 环境
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }, // CJS 环境
    },
  },
}
```

> Node 与打包器通过 `exports` 的 `import`/`require` **条件**各自命中正确文件;**`type: "module"` 下 `.js` 按 ESM、`.cjs` 显式 CJS**,互不干扰。产了 cjs 却没在 exports 里声明 require,Node 旧版本会拿错文件。

## 速查

| 主题        | 一句话记住                                                                 |
| ----------- | -------------------------------------------------------------------------- |
| 定位        | 面向"被其他代码 import 的类库";不做 dev server/资源管线                    |
| 摇树        | ESM 静态结构 → AST 遍历依赖图 → 只生成"可达导出";删"结构",压缩器再删"语句" |
| 扁平化      | 无运行时外壳,模块直接拼接 + 符号重命名;产物近似手写、利于二次摇树          |
| 保留 export | es 产物保留具名导出 → 把"摇树权"交给下游打包器                             |
| 多格式      | es 给现代、cjs 给 Node、iife/umd 给 `<script>`/老平台(需 name + globals)   |
| 分发        | exports 的 import/require 条件 + type:module 让各环境拿对文件              |

> 官方文档:rollupjs.org/guide(Introduction / Why another module bundler)、rollupjs.org/introduction。下一篇:[工程化配置与实战](./config.md)。
