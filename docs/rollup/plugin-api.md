# Rollup 插件开发与 JavaScript API

> [← 返回总纲](./README.md) · 本系列第 3 篇:钩子生命周期 / 手写自定义插件 / rollup() 与 watch() 编程化构建

会用配置只是"用户",能写插件、能用 JS API 编排构建,才真正跨进"工具链开发者"的门槛。Rollup 的插件模型极其简单——**导出一个带 `name` 与若干钩子函数的对象**;但要把钩子用对,先得知道它们**在构建的哪个阶段、以什么顺序触发**。

## 一、钩子生命周期:构建钩子 vs 输出钩子

Rollup 一次构建分两个大阶段,插件钩子也据此分成两组:

```
阶段一 · 构建(build):把源码变成"模块图"
  options → buildStart
  然后对每个模块循环:
     resolveId(解析 import → 定位文件) → load(取内容) → transform(改内容) → moduleParsed
  …所有模块就绪… → buildEnd

阶段二 · 输出(output):把模块图渲染/写成文件
  outputOptions → renderStart
  对每个 chunk:renderChunk(改已渲染的代码)
  generateBundle(全部 chunk 渲染完、写盘前,可增删/改产物)→ writeBundle(已写盘)
收尾:closeBundle
```

| 组           | 钩子                      | 时机与用途                                                                 |
| ------------ | ------------------------- | -------------------------------------------------------------------------- |
| **构建钩子** | `resolveId`               | 每个 import 解析时调用;返回字符串 = 命中该 id,返回 `null` = 交给下一个插件 |
|              | `load`                    | 返回该 id 的代码内容                                                       |
|              | `transform`               | 拿到代码可改写(转译/替换),返回 `{ code, map }`                             |
|              | `buildStart` / `buildEnd` | 构建期开始/结束的通知点                                                    |
| **输出钩子** | `renderChunk`             | 每个 chunk 渲染完成后改其代码(如加 banner/替换)                            |
|              | `generateBundle`          | 所有 chunk 渲染完、**写盘之前**,可增删产物或提前终止写入                   |
|              | `writeBundle`             | 文件已写盘后(通知/收尾,如打日志)                                           |

两个要点:

- **构建钩子决定"模块图长什么样",输出钩子决定"产物文件长什么样"**——想拦导入/虚拟模块用前者,想改最终文件用后者;
- 钩子可以是同步函数,也可以返回 Promise(异步);`resolveId/load/transform` 是对**每个模块**都跑的,而 `generateBundle/writeBundle` 每次构建跑一次。

## 二、手写一个自定义插件:三个够用的样本

### 样本 A:字符串替换(最常见的"内联变量"需求)

把源码里的占位符替换成构建期才知道的值(等价于微缩版 `@rollup/plugin-replace`):

```js
// plugins/version.js
export function versionPlugin(version) {
  return {
    name: 'version-plugin',
    transform(code) {
      if (!code.includes('__VERSION__')) return null // 没命中就交还,别白改
      return {
        code: code.replaceAll('__VERSION__', JSON.stringify(version)),
        map: null, // 这里没改结构,可以不提供 map;改行号时需传 map
      }
    },
  }
}
```

源码里写 `export const VERSION = '__VERSION__'`,构建时注入真实版本号。**`transform` 返回 `null` = 不处理**,是插件礼貌的默认姿势。

### 样本 B:虚拟模块 + 输出额外产物(理解 `resolveId/load/generateBundle`)

虚拟模块 = "不存在的文件,由插件凭空造出来",可用来向业务代码注入构建期数据:

```js
// plugins/build-meta.js
export function buildMetaPlugin({ builtAt }) {
  const virtualId = '\0build-meta' // \0 开头 = 内部虚拟 id 约定:别的插件别去碰
  return {
    name: 'build-meta',
    resolveId(id) {
      return id === 'virtual:build-meta' ? virtualId : null // 拦下这个"伪导入"
    },
    load(id) {
      if (id === virtualId) {
        return `export const builtAt = ${JSON.stringify(builtAt)}` // 凭空产出模块
      }
    },
    generateBundle() {
      // 在输出目录里追加一个文件(产物层面的"额外输出")
      this.emitFile({
        type: 'asset',
        fileName: 'meta.json',
        source: JSON.stringify({ builtAt }, null, 2),
      })
    },
  }
}
```

业务代码 `import { builtAt } from 'virtual:build-meta'` 即可。这里示范了三件事:**`resolveId` 拦截导入、`load` 凭空造模块、`generateBundle` + `this.emitFile` 往产物里追加文件**——插件能"改源码"也能"加文件",两者都是常规操作。

### 样本 C:自动注入版本头(banner)

更常见也更省事的其实是 Rollup **内建的 `banner` 输出选项**(给每个 chunk 头部加注释),插件只在需要**复杂逻辑**时才出手:

```js
export default {
  output: {
    banner: `/*! my-lib v${pkg.version} | MIT */`, // 简单场景用它即可
  },
}
```

## 三、JavaScript API:把构建写进脚本

命令行 `rollup -c` 只是 JS API 的一层薄壳。用 `rollup()` / `watch()` 编程,能实现"构建 + 加工 + 发布"的自动流水线。

### 基本流程:rollup() → write / generate

```js
// build.mjs
import { rollup } from 'rollup'

const bundle = await rollup({
  input: 'src/index.ts',
  external: (id) => !id.startsWith('.') && !id.startsWith('/'),
  plugins: [/* 你的插件 */],
})

// 方式一:write —— 渲染并落盘(一次写一个 output 配置)
await bundle.write({ file: 'dist/index.js', format: 'es', sourcemap: true })
await bundle.write({ file: 'dist/index.cjs', format: 'cjs', exports: 'named' })

// 方式二:generate —— 只在内存渲染,便于加工后再自行写盘
// const { output } = await bundle.generate([...]) // 可传多个 output 配置
// output 里是 { type: 'chunk'|'asset', code/map/fileName, ... }

await bundle.close() // 记得关掉,释放 watcher/插件资源
```

### 一个"自动发布"脚本的骨架

把构建与发布串起来,是 JS API 最典型的实战场景(略去实现细节,看骨架):

```js
// release.mjs —— npm run release -- 1.0.0
import { rollup } from 'rollup'
import { execSync } from 'node:child_process'

const version = process.argv[2] ?? 'patch'

// ① 以插件拿到当前版本 / 或按参数更新 package.json 版本(略)
// ② 一次构建,多格式落盘
const bundle = await rollup({ input: 'src/index.ts', plugins: [/* … */] })
await bundle.write({ file: 'dist/index.js', format: 'es' })
await bundle.write({ file: 'dist/index.cjs', format: 'cjs', exports: 'named' })
await bundle.close()

// ③ 类型由 tsc 单独产出(声明与打包分离,逻辑同 Vite 的"转译/检查分离")
execSync('tsc --emitDeclarationOnly --outDir dist/types', { stdio: 'inherit' })

// ④ 把精简后的 package.json 拷进 dist,再发布
// (files 白名单只含 dist;发布命令可参考仓库 release 脚本思路)
console.log(`done: v${version}`)
```

### watch 模式编程

要用脚本管理"监听重构建",用 `watch()` 返回的 watcher + 事件订阅:

```js
import { watch } from 'rollup'

const watcher = watch({
  input: 'src/index.ts',
  output: [{ file: 'dist/index.js', format: 'es' }],
})

watcher.on('event', (event) => {
  if (event.code === 'BUNDLE_END') console.log('✓ 重新构建完成')
  if (event.code === 'ERROR') console.error('✗ 构建出错', event.error)
})
// 想停:watcher.close()
```

## 四、插件与 API 的边界心智

| 需求                           | 首选方案                         |
| ------------------------------ | -------------------------------- |
| 只是加个头注释 / 改产物头部    | 内建 `output.banner/footer`      |
| 只是替换固定字符串             | 官方 `@rollup/plugin-replace`    |
| 需要解析并改某个模块的**内容** | 写 `transform` 插件              |
| 需要凭空提供模块(虚拟导入)     | `resolveId + load`               |
| 需要在产物目录**追加文件**     | `generateBundle + this.emitFile` |
| 需要把整个发布流程自动化       | JS API(`rollup()`/`watch()`)     |
| 只想要极简命令行构建           | `rollup -c` / `-w`               |

**一句话分层**:先找官方插件,再考虑小钩子(transform/banner),最后才是完整插件或 JS API——**Rollup 的哲学是"内核极简 + 外挂补齐",你的插件也应当一事一职、返回 `null` 保持谦逊**。

## 速查

| 主题     | 一句话记住                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------- |
| 两组钩子 | 构建钩子(resolveId/load/transform)造模块图;输出钩子(renderChunk/generateBundle/writeBundle)定产物文件 |
| 顺序     | 构建:解析→取内容→转换→就绪→buildEnd;输出:渲染→generate(改/加)→write(落盘)                             |
| 虚拟模块 | `resolveId` 拦 `virtual:x` → `load` 造内容;内部 id 用 `\0` 前缀防误伤                                 |
| 加文件   | `generateBundle` 里 `this.emitFile({ type:'asset', ... })` 在写盘前插入                               |
| JS API   | `rollup(inputOptions)` → `bundle.write/generate(output)` → `bundle.close()`;多格式一次构建            |
| watch    | `watch(options)` + `on('event')` 订阅 `BUNDLE_END` / `ERROR`                                          |

> 官方文档:rollupjs.org/plugin-development、rollupjs.org/javascript-api;官方插件源码见 github.com/rollup/plugins(每个都是很好的读码样本)。下一篇:[对比 Webpack/Vite 与生态视野](./ecosystem.md)。
