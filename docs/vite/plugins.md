# Vite 插件系统与 TypeScript

> 本系列第 3 篇:Rollup 兼容插件模型 / 官方插件 / TS 的"esbuild 转译"与"类型检查"为何分离。· [← 返回总纲](./README.md)

配置项解决"怎么用",插件解决"怎么扩"。Vite 的插件模型几乎原样继承 Rollup,Rollup 社区的插件能直接流入 Vite。

## 一、插件模型:Rollup 兼容 + Vite 扩展

### 1. 一套接口,两个环境

Vite 复用 **Rollup 的插件接口**:插件是一个带 `name` 和若干钩子函数的对象。钩子分两类:

| 类别                                    | 钩子(节选)                       | 作用                              |
| --------------------------------------- | -------------------------------- | --------------------------------- |
| **与 Rollup 共享**(dev 与 build 都会用) | `resolveId`                      | 解析模块 id(可虚拟模块、拦截导入) |
|                                         | `load`                           | 读取/生成模块内容                 |
|                                         | `transform`                      | 转换模块内容(转译、改写)          |
|                                         | `generateBundle` / `writeBundle` | 产物生成后收尾(统计、追加文件)    |
| **Vite 独有**(补上 dev server 能力)     | `config` / `configResolved`      | 读取/改写最终配置                 |
|                                         | `configureServer`                | 钩住 dev server(加中间件、改请求) |
|                                         | `transformIndexHtml`             | 转换 index.html                   |
|                                         | `handleHotUpdate`                | 拦截/定制 HMR 更新                |

同一个插件接口能同时服务 dev 与 build,这是 Vite 生态"一个插件到处用"的根基(对比:Webpack 的 loader/plugin 是另一套体系,不能通用)。

### 2. 执行顺序:pre / normal / post

多个插件对同一模块都触发 `transform` 时,顺序由 **`enforce`** 控制,与 Webpack loader 的 `enforce: 'pre'/'post'` 思路同源:

```ts
// 默认按数组顺序(normal);别名/特殊改写类插件用 enforce 抢到最前或最后
{
  name: 'my-plugin',
  enforce: 'pre', // 让 transform 在"普通"插件之前跑
  // transform() {...}
}
```

需要最早看到原始内容的(如宏替换)用 `pre`,需要最后再改一遍产物的用 `post`,其余不写 `enforce`。

### 3. 最小插件示例

给 `index.html` 注入信息:

```ts
// build-info.ts —— 把构建时间写进 HTML 的 <head>
export function buildInfoPlugin() {
  return {
    name: 'build-info',
    transformIndexHtml(html) {
      return html.replace(
        '</head>',
        `<meta name="build-time" content="${new Date().toISOString()}" />\n</head>`,
      )
    },
  }
}
```

```ts
// vite.config.ts 里挂上
import { buildInfoPlugin } from './plugins/build-info'

export default defineConfig({
  plugins: [buildInfoPlugin()],
})
```

## 二、官方插件与常用扩展

### 官方三大件

| 插件                    | 干什么                             | 关键点                                             |
| ----------------------- | ---------------------------------- | -------------------------------------------------- |
| `@vitejs/plugin-vue`    | 编译 `.vue` 单文件 + Vue 专属 HMR  | Vue 项目必装,含模板编译与样式处理                  |
| `@vitejs/plugin-react`  | React Fast Refresh + 自动 JSX 转换 | 让 React 支持"保留状态的热更新"                    |
| `@vitejs/plugin-legacy` | 面向**不支持原生 ESM 的旧浏览器**  | 用 browserslist 选目标,产出 SystemJS 降级包 + 垫片 |

```ts
import vue from '@vitejs/plugin-vue'
import legacy from '@vitejs/plugin-legacy'

export default defineConfig({
  plugins: [
    vue(),
    legacy({
      targets: ['defaults', 'not IE 11'], // 按你的兼容要求收敛;范围越大体积与构建成本越高
    }),
  ],
})
```

> `plugin-legacy` 的本质:现代浏览器走原生 ESM 产物(小、快),旧浏览器自动切到 **SystemJS 格式 + polyfill** 的降级产物。代价是额外生成一套代码并增加构建时间,所以 **targets 收敛到真实需求**,别默认覆盖最老的一批浏览器。

### 社区生态

| 插件                                               | 解决什么                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| `vite-plugin-checker`                              | 把 tsc / vue-tsc / ESLint 的报错**实时显示到页面上**(见第三节)            |
| `vite-plugin-pwa`                                  | 一键接入 PWA(Service Worker / 离线缓存)                                   |
| `unplugin-auto-import` / `unplugin-vue-components` | 自动按需导入 API 与组件(免手写 import)                                    |
| `vite-tsconfig-paths`                              | 让 Vite 识别 `tsconfig` 里的 `paths`(见 [配置篇](./config.md) 的别名说明) |

## 三、TypeScript:esbuild 只"转译",不"查类型"

### 1. esbuild 的定位

把类型写错、函数名拼错,Vite 照样跑——这是刻意设计:Vite 用 **esbuild 把 `.ts` 当"带类型的 JS"处理,只做"剥掉类型"的转译,不做类型检查**:

```
esbuild:  .ts  ──►  去类型 → 得到 JS   (快,毫秒级,不做跨文件分析)
tsc:      .ts  ──►  全量类型检查       (慢,秒级,需要类型信息与跨文件推断)
```

类型检查慢、且不影响"代码能不能跑"。Vite 把"让代码立刻跑起来"与"严格查类型"拆成两件事,分别交给 esbuild 与 tsc。

### 2. 代价:esbuild 是"孤立文件转译"

esbuild 一次只看一个文件,拿不到跨文件类型信息。某些依赖"全程序类型分析"的写法行为会变,应在 `tsconfig.json` 打开对应开关:

```jsonc
{
  "compilerOptions": {
    "isolatedModules": true, // 让 esbuild 不兼容的写法在编辑器/tsc 就报出来
    "verbatimModuleSyntax": true, // 可选:强制 type-only 导入显式写 import type
  },
}
```

最常踩的两条约束:

- **类型再导出必须写 `export type` / `import type`**:`export { SomeType }` 不加 `type`,esbuild 可能误当成值导出而保留下一个不存在的变量 → 运行时崩;
- **别依赖 `const enum` 等需跨文件内联的类型特性**:esbuild 按单文件处理,行为与 tsc 可能不一致。

> 分工:**转译问 esbuild,类型问 tsc**。"查类型"要显式接回来,见下。

### 3. 把类型检查"接回来"

| 时机    | 做法                                                              |
| ------- | ----------------------------------------------------------------- |
| 开发中  | 靠 IDE 内置 TS 实时标红 + `vite-plugin-checker` 把报错打到页面    |
| 提交/CI | `"typecheck": "tsc --noEmit"`,在 push/CI 里跑                     |
| 构建前  | `"build": "npm run typecheck && vite build"`——**先查类型,再构建** |

```jsonc
// package.json —— Vue 项目把 tsc 换成 vue-tsc 以覆盖模板类型
{
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc --noEmit",
    "build": "npm run typecheck && vite build",
  },
}
```

`vite-plugin-checker`:

```ts
import checker from 'vite-plugin-checker'

export default defineConfig({
  plugins: [
    checker({
      typescript: true, // 把 tsc 的报错实时渲染到浏览器(dev 下)
      // eslint: { lintCommand: 'eslint "./src/**/*.{ts,tsx}"' },
    }),
  ],
})
```

换来的是:开发期依旧毫秒级转译,**类型正确性由编辑器 + CI 守护**,两者互不拖累——"转译/检查分离"的意义所在。

## 四、静态资源与高级导入

资源"开箱即用",按"写法"而非"配置"记忆。

### 普通资源:import 即得 URL

```ts
import logo from './logo.png' // 开发返回原 URL;build 自动哈希、按体积内联
```

构建时小于 `build.assetsInlineLimit`(默认 **4KB**)的资源自动转 base64 内联,减少请求;超过则输出为带哈希的文件并返回 URL——心智与 Webpack 的 Asset Modules 一致(对照 [Webpack 工程化篇](../webpack/engineering.md))。

### JSON:直接导入,具名导入利于摇树

```ts
import pkg from './package.json' // 默认导出整个对象
// import { version } from './package.json' // 具名导入:构建时可摇掉没用的字段
```

### Glob 导入:批量拿一组模块

`import.meta.glob` 适合**约定式目录**批量加载(自动收集路由、按语言加载多语言文件):

```ts
// 懒加载:返回 { 路径: () => import(路径) }
const pages = import.meta.glob('./pages/*.vue')

// eager:构建期直接全部引入(对象值是模块本体)
const locales = import.meta.glob('./locales/*.json', { eager: true })

// 进阶:只要某个导出 + 让 glob 在构建期就报"匹配不到"的错误
const mods = import.meta.glob('./dir/*.js', { import: 'setup', eager: true })
```

### 动态导入:天然变成异步 chunk

```ts
const Chart = (await import('./charts/line.js')).default // build 时自动拆出独立 chunk
```

### new URL(..., import.meta.url):拿资源真实地址

浏览器标准写法,Vite 在构建期静态分析并解析成最终资源 URL。必须写成可静态分析的 `new URL('./相对路径', import.meta.url)` 形式,拼接变量无法解析:

```ts
const url = new URL('./assets/bg.png', import.meta.url).href // 开发=源地址,build=带哈希产物地址
```

### Web Worker:三种标准姿势

```ts
// ① new URL + type: module(最推荐,与主线程同一套模块规则)
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

// ② ?worker 后缀:导入即得到 Worker 构造函数
import MyWorker from './heavy?worker'
const w = new MyWorker()

// ③ ?worker&inline:打成 base64 内联(小 worker,避免额外请求)
import InlineWorker from './tiny?worker&inline'
```

## 速查

| 主题            | 一句话记住                                                                      |
| --------------- | ------------------------------------------------------------------------------- |
| 插件模型        | 继承 Rollup 插件接口,dev/build 通吃;Vite 独有钩子负责 dev server 与 index.html  |
| 顺序            | `enforce: 'pre'/'post'` 控制执行先后,别名/改写类常用                            |
| 官方插件        | vue / react / legacy 三件;legacy 为不支持 ESM 的旧浏览器产出 SystemJS 降级包    |
| TS 分工         | **esbuild 只转译不查类型**;类型检查靠 tsc/vue-tsc 在编辑器、CI、build 前补上    |
| isolatedModules | 打开它,提前暴露"esbuild 转译不了"的写法;类型再导出必须 `export type`            |
| 资源能力        | import 图片/JSON、`import.meta.glob` 批量、`new URL` 静态解析、`?worker` 三姿势 |

> 官方文档:vite.dev/guide/api-plugin、vite.dev/guide/features、vite.dev/guide/typescript;插件生态可在 vite.dev/plugins 检索。下一篇:[对比 Webpack 与生态视野](./ecosystem.md)。
