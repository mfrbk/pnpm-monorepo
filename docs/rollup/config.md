# Rollup 工程化配置与实战

> [← 返回总纲](./README.md) · 本系列第 2 篇:rollup.config 全解 / external / node-resolve · commonjs · babel · typescript / 分割与 Source Map

上一篇讲清 Rollup 的"为什么强",这一篇把它落进真实类库工程:配置不多,但**顺序和职责比字段本身更重要**——尤其要理解"Rollup 内核只认 ESM + 相对路径导入",其余全靠配置与插件补齐。

## 一、一份配置的结构:input → output → plugins

```js
// rollup.config.js
export default {
  input: 'src/index.js', // 入口(库的公共出口)
  output: {
    file: 'dist/index.js',
    format: 'es',
    sourcemap: true, // 见第四节
  },
  external: [...], // 不要把第三方打进来,见第二节
  plugins: [...],   // Rollup 内核只认 ESM,其余靠插件,见第三节
}
```

执行 `rollup -c` 即按此构建。与 Webpack 最大的心智差异:**Rollup 没有 dev/prod 的"mode"概念、默认不做压缩**——环境差异基本都体现在"输出哪种格式 + 是否压缩"上,由你自己组织(可写多个 output,或配合命令行/环境变量)。

## 二、external:库的边界,决定"哪些不进产物"

**问题**:如果库代码 `import { debounce } from 'lodash'`,而你把 lodash 也打进产物,消费者 `require('my-lib')` 时会被迫**重复装一份 lodash**,体积与版本都失控。类库的原则是:**第三方依赖(尤其 `dependencies`/`peerDependencies`)应当 external——留在外面,由消费者提供。**

```js
import { readFileSync } from 'node:fs'
import pkg from './package.json'

const external = [
  ...Object.keys(pkg.dependencies || {}), // 运行时依赖:外部化
  ...Object.keys(pkg.peerDependencies || {}), // 对等依赖:外部化(如 react)
  /^node:/, // Node 内置模块
]

export default {
  input: 'src/index.js',
  external, // 命中这些 id 的 import 不会被解析打包,原样留在产物里
  // 或写成函数:id 不是相对/绝对路径 → 视为外部(等价且更通用)
  // external: (id) => !id.startsWith('.') && !id.startsWith('/'),
}
```

**external 与产物格式的关系**:

- `format: 'es'/'cjs'`:外部依赖保留为 `import ... from 'lodash'` / `require('lodash')`,由 Node 或打包器在运行时解析;
- `format: 'iife'/'umd'`:**没有模块系统可 require**,必须配合 `output.globals` 把外部依赖映射到运行时全局变量(见 [核心篇](./core.md) 的例子),否则浏览器里找不到 `lodash` 这个标识。

> 判断一句话:**"这个模块最终由谁提供?"** 由消费者提供 → external;由你的库自带/内联 → 打包进来。基础库(React)、运行时依赖统统走前者。

## 三、核心插件:把"ESM + 相对路径"之外的现实补上

Rollup 内核只做三件事:解析相对路径、拼接模块、输出。真实世界还有 node_modules、CJS 包、TS/Babel 源码、压缩——全部交给插件。四个必会的 `@rollup/plugin-*`:

| 插件                          | 解决什么                      | 说明                                                                                                                           |
| ----------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `@rollup/plugin-node-resolve` | **通过包名导入 node_modules** | 默认行为是把"裸模块导入"当 external;不加它,`import 'lodash'` 会留在产物里等运行时,而不是被解析打包(对库常配合 external 排除掉) |
| `@rollup/plugin-commonjs`     | **把 CJS 转成 ESM**           | npm 大量包是 `require/exports` 写的,Rollup 不认 → 必须先转                                                                     |
| `@rollup/plugin-babel`        | Babel 转译(业务代码语法降级)  | 类库常用来兼容老环境语法;配 `babelHelpers` 策略                                                                                |
| `@rollup/plugin-typescript`   | TypeScript 编译(tsc 全权)     | 走 tsc:能做类型检查 + 产出 `.d.ts`;想要 esbuild 级别的快可换 `rollup-plugin-esbuild`                                           |

典型组合(从 npm 依赖 + TS 源码打库):

```js
import { nodeResolve } from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import typescript from '@rollup/plugin-typescript'
import terser from '@rollup/plugin-terser'
import pkg from './package.json'

export default {
  input: 'src/index.ts',
  external: [...Object.keys(pkg.peerDependencies || {})],
  plugins: [
    nodeResolve({ extensions: ['.ts', '.js'] }), // ① 先能解析到包
    commonjs(), // ② 再把解析到的 CJS 转 ESM(顺序在 nodeResolve 之后)
    typescript({ declaration: true, declarationDir: 'dist/types' }), // ③ 编译 TS
    terser(), // ④ 需要压缩时再加
  ],
  output: [
    { file: 'dist/index.js', format: 'es', sourcemap: true },
    { file: 'dist/index.cjs', format: 'cjs', exports: 'named', sourcemap: true },
  ],
}
```

**两条实战提醒**:

1. **顺序即语义**:`nodeResolve`(定位文件)要在 `commonjs`(转换内容)之前,`commonjs` 要在 **transform 类插件之后、但处理的是其转译产物**——遇到"CJS 包没被转换"的报错,先查插件顺序。
2. **CommonJS 具名导出的坑**:CJS 包的导出是运行时对象,`commonjs` 只能**尽力静态推断**具名导出,推断不出时就只剩 default。老 CJS 包若在库内被具名导入失败,优先换 ESM 版依赖(如 `lodash-es`),而不是硬拗配置——这与 [Webpack 系列](../webpack/README.md) 里"摇树要 ESM"是同一课。

## 四、代码分割 / 多入口 / Source Map

### 代码分割与多入口

类库通常**不主动分割**(一个文件最好分发),但两个场景会用到:

- **多入口**:一个包暴露多个子入口(如 `my-lib/core`、`my-lib/react`)时,`input` 写成对象并 `output.dir` + `output.format: 'es'`:

```js
export default {
  input: {
    index: 'src/index.ts',
    'react-adapter': 'src/react/index.ts',
  },
  output: { dir: 'dist', format: 'es' }, // 多入口必须用 dir 而不是 file
}
```

- **动态 `import()` 懒加载**:Rollup 会自动把异步依赖拆成独立 chunk(需要 `output.dir`)。注意 **`format: 'iife'/'umd'` 不支持代码分割**(单文件无法承载异步 chunk),要用回 `es`/`cjs` 或交给 `system`。

### Source Map:库里要不要带

打库的标准答案是:**带**,但默认生成 map 文件、引用写在产物末尾:

```js
output: {
  sourcemap: true, // 生成独立的 .map;业务源码(TS 前)经插件映射,线上报错可还原到源
  // 'inline' | 'hidden' 等变体同 Webpack 语义,详见 Webpack 工程化篇的 map 红线
}
```

配合第三节的 `typescript({ declaration: true })` 输出 `.d.ts`,一个库的"JS + Map + 类型"三件套就齐了——**别只发 JS 不发类型**,否则 TS 消费者拿到的是 `any`,等于浪费了库的类型设计。

## 五、一份"打真实库"的配置全貌

把本篇知识点整合(以 TS 源码 + React peerDependency + 多格式为例):

```js
import { nodeResolve } from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import typescript from '@rollup/plugin-typescript'
import terser from '@rollup/plugin-terser'
import pkg from './package.json'

export default {
  input: 'src/index.ts',
  external: ['react', 'react-dom', ...Object.keys(pkg.peerDependencies || {}), /^node:/],
  plugins: [
    nodeResolve({ extensions: ['.ts', '.tsx'] }),
    commonjs(),
    typescript({
      declaration: true,
      declarationDir: 'types',
      exclude: ['**/__tests__/**'],
    }),
    terser(), // 压缩:三个 output 会分别压缩;不需要的话去掉
  ],
  output: [
    { file: 'dist/index.js', format: 'es', sourcemap: true },
    { file: 'dist/index.cjs', format: 'cjs', exports: 'named', sourcemap: true },
    {
      file: 'dist/index.umd.js',
      format: 'umd',
      name: 'MyLib',
      globals: { react: 'React', 'react-dom': 'ReactDOM' },
      exports: 'named',
    },
  ],
}
```

> 与"开箱即用"的 tsup(本仓库 `@mzy1120/*` 子包正在用,底层 esbuild 打码 + Rollup 合并 d.ts)相比,**裸 Rollup** 的优点是极致的可控与零隐式依赖,代价是上面的配置要自己攒——这也是 [Vite 系列](../vite/README.md) 说"打包库可选 tsup/Rollup/Vite lib mode"的原因,三者按团队掌控力取舍。

## 速查

| 主题         | 一句话记住                                      | 最易踩的坑                                        |
| ------------ | ----------------------------------------------- | ------------------------------------------------- |
| `external`   | 由消费者提供的模块一律不进产物                  | iife/umd 忘了配 `globals` → 运行时 ReferenceError |
| node-resolve | 让 Rollup 能解析 node_modules 裸模块            | 只加 commonjs 忘了 nodeResolve,CJS 找不到         |
| commonjs     | 把 CJS 转 ESM;顺序在 nodeResolve 之后           | CJS 包具名导入失效时,优先换 ESM 版依赖            |
| typescript   | 用 tsc 编译并可出 `.d.ts`;要极速换 esbuild      | 忘了 `declaration: true` → 消费者拿不到类型       |
| 分割/多入口  | `input` 对象 + `output.dir`;iife/umd 不支持分割 | 动态 import 想用 iife → 报错/无法分割             |
| sourcemap    | 库默认带上 map + `.d.ts`                        | 只发 JS 不发类型,TS 消费者全 any                  |

> 官方文档:rollupjs.org/configuration-options、rollupjs.org/plugins(官方插件目录)。下一篇:[插件开发与 JavaScript API](./plugin-api.md)。
