# Webpack 底层原理与源码架构

> 本系列第 3 篇:构建生命周期 / Compiler 与 Compilation / Tapable 钩子 / AST 解析与依赖图。· [← 返回总纲](./README.md)

把 Webpack 当"跑在 Node 上的 JS 程序"来读:配置只是它的入参,内部是一个状态机一路转到底。理解它是排查诡异问题、手写插件、应对源码面试的分水岭。

## 一、整体构建流程

Webpack 一次完整构建可压缩成四个阶段:

```
① 初始化        读配置、合并参数,创建 Compiler 对象,注册所有插件的钩子
② 编译(make)    从 Entry 出发,递归解析依赖、构建出"模块依赖图"(只算不改输出)
③ 封装(seal)    把模块图 → chunk 图 → 逐块渲染生成代码 → 产出内存中的 asset(文件内容)
④ 输出(emit)    把 asset 写入磁盘,通知 done
```

### 阶段一 初始化

- CLI / 配置文件 / 环境变量合并成一份最终 `options`(配置 merge 与校验发生在这里)。
- 用 `options` **实例化全局唯一的 `Compiler` 对象**(整个构建期只存在一个),设置 context、文件系统、缓存等基础设施。
- 遍历 `plugins`,逐个调用其 **`apply(compiler)`**,把插件的回调**注册**到对应生命周期钩子。
- 触发 `environment` / `afterEnvironment` / `entryOption` 等钩子,准备就绪。

> **关键顺序**:插件的 `apply` 在构建开始之前就跑完,所以插件能监听到从 `compile` 到 `done` 的全程事件——这正是[核心篇](./core-config.md)说 Plugin 是"全局能力"的原因。

### 阶段二 make:构建模块依赖图

`compiler.run()` 触发 `run` 后进入 `compile`,创建本次 **`Compilation`**,随后进入最核心的 **`make`** 钩子(AsyncParallel):

- 遍历入口,把每个 Entry 封装成"入口依赖",交给 `NormalModuleFactory` 创建入口模块;
- 对每个模块 **build**:读文件 → 跑 [Loader 链](./core-config.md)→ 用 Parser 解析 AST → 收集 import/require 的**依赖列表**;
- 对每个依赖**递归**重复,直到没有未解析依赖 → **模块依赖图(Module Graph)构建完成**,`finishMake`。

这一阶段只做"谁依赖谁"的纯逻辑推理,**不产出文件**(make = 调研画图,seal = 出图纸,emit = 盖楼)。

### 阶段三 seal:模块图如何变成文件

内部两小步:

1. **模块图 → chunk 图**:按入口归属、`import()` 懒加载点、`splitChunks` 规则(见[性能篇](./performance.md))把 module **归并成 chunk**(chunk = 浏览器加载单元),同时分配 module/chunk 的 id(production 用确定性短 id)。
2. **优化与渲染**:触发一串 `optimize*` 钩子——**摇树(`usedExports`/`sideEffects`)、压缩(Terser)、作用域提升**都在这里;然后逐 chunk code generation、算出 `contenthash`,产出内存中的 **asset**(文件名 + 内容)。Webpack 5 的 `processAssets` 钩子可在此时增删改 asset。

### 阶段四 emit:落到磁盘

- `emit`(AsyncSeries)触发,**此刻仍可修改将写入的 asset**;
- 通过 `compiler.outputFileSystem` 写入 `output.path`;
- `afterEmit` → `done`,一次构建结束。

四阶段速记:

| 阶段      | 干的事                          | 产物                       | 关键 hooks                         |
| --------- | ------------------------------- | -------------------------- | ---------------------------------- |
| 初始化    | 合并参数、建 Compiler、注册插件 | Compiler(options, plugins) | `environment` `entryOption`        |
| 编译 make | 递归构建模块图                  | Module Graph               | `compile` `make` `finishMake`      |
| 封装 seal | 模块归 chunk、优化、生成代码    | Chunk Graph + asset        | `seal` `optimize*` `processAssets` |
| 输出 emit | 写盘、收尾                      | dist/ 文件                 | `emit` `afterEmit` `done`          |

## 二、Compiler 与 Compilation

一句话:`Compiler` 是"进程级"的总控对象,`Compilation` 是"单次编译"实例。watch 模式下一个进程跑无数次编译,每次新建一个 Compilation。

|            | `Compiler`                                              | `Compilation`                                                    |
| ---------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| 数量       | 整个运行期唯一                                          | 每次编译新建一个                                                 |
| 职责       | 总控:启动 / 调度 / 收尾,持有全局配置与基础设施          | 干活:承载本次构建的所有模块、依赖、chunk、asset                  |
| 类比       | 项目经理(管整场项目)                                    | 这次任务的工单 / 现场(管这轮产物)                                |
| watch 下   | 复用同一个                                              | 每次文件变更都 `new` 一个重新编译                                |
| 关键数据   | `options`、`hooks`、`context`、`outputFileSystem`、缓存 | `modules`(Set)、`chunks`、`assets`、`moduleGraph` / `chunkGraph` |
| 典型 hooks | `run` `compile` `make` `emit` `done`                    | `buildModule` `seal` `optimizeModules` `processAssets`           |

**为何必须拆开**:watch / HMR 下 Compiler 要一直活着(管监听、缓存、下一轮编译),而每次编译的 modules/chunks 都是全新一批。若混在同一对象,上一轮数据会污染下一轮。分工:

- "每轮都做、且要动全局配置"的事 → 挂 Compiler hooks;
- "针对当前这批产物"的事(遍历本次模块、改本次 asset)→ 挂 `compilation` 的 hooks。

```js
compiler.hooks.emit.tap('P', (compilation) => {
  // emit 参数是 compilation:此刻能读到/改写这轮的 assets
})
```

## 三、Tapable:插件的事件总线

Webpack 可扩展性的底座是 **Tapable**——一个发布/订阅系统。`compiler.hooks` 与 `compilation.hooks` 上的每个钩子都是某种 Tapable Hook。

### 钩子类型决定行为语义

| Hook 类型           | 语义                                       | 真实例子                                               |
| ------------------- | ------------------------------------------ | ------------------------------------------------------ |
| `SyncHook`          | 同步串行,互不传参                          | `compiler.hooks.done`、`compilation.hooks.buildModule` |
| `SyncBailHook`      | 同步串行,某回调返回非 undefined 即短路中止 | `compiler.hooks.shouldEmit`(返回 false 则不输出)       |
| `SyncWaterfallHook` | 同步,上个回调的返回值作下个入参            | 数据加工链                                             |
| `AsyncSeriesHook`   | 异步串行,一个个等回调完成                  | `compiler.hooks.run`、`emit`、`processAssets`          |
| `AsyncParallelHook` | 异步并行,一起跑完再继续                    | `compiler.hooks.make`                                  |

### 三种 tap 注册

插件 = 一个带 `apply(compiler)` 方法的对象,在 `apply` 里按钩子类型注册:

```js
class MyPlugin {
  apply(compiler) {
    // 同步钩子:直接 tap
    compiler.hooks.done.tap('MyPlugin', (stats) => {
      console.log(`构建完成,耗时 ${stats.endTime - stats.startTime}ms`)
    })

    // 异步串行钩子:用 tapAsync 拿到回调,或 tapPromise 返回 Promise
    compiler.hooks.run.tapPromise('MyPlugin', async () => {
      await prepareSomething()
    })
  }
}
```

> `tap('插件名', ...)` 第一个参数是插件标识;一个钩子可挂很多插件,靠名字区分、顺序清晰——这也是 Tapable 名字的由来(订阅者像水龙头 Tap 一样接在同一条管道上)。

### 自定义插件示例

一个"产物里加版本说明文件 + 统计本轮模块数"的插件(Webpack 5 API):

```js
const { RawSource } = require('webpack').sources

class VersionPlugin {
  apply(compiler) {
    // ① 编译中:数这轮构建了多少个模块
    compiler.hooks.compilation.tap('VersionPlugin', (compilation) => {
      compilation.hooks.seal.tap('VersionPlugin', () => {
        console.log(`本轮构建模块数:${compilation.modules.size}`)
      })
    })

    // ② emit 前:向输出 assets 里塞一个文件
    compiler.hooks.emit.tap('VersionPlugin', (compilation) => {
      compilation.emitAsset('version.txt', new RawSource(`build @ ${new Date().toISOString()}`))
    })
  }
}

module.exports = VersionPlugin
```

用法与内置插件一致:`new VersionPlugin()`。它同时示范两件事:经 `compiler.hooks.compilation` 桥接到"单次编译内部"监听 Compilation 子钩子;用 `compilation.emitAsset` 在输出前改写资产——即 Plugin"构建全程介入"的底层实现。

## 四、模块解析与依赖图

### 模块 = 一条构建单元

Webpack 视角下,module **不等于文件**,而是一条**独立构建单元**:一个文件 + loader 链转译后的代码 + 解析出的依赖集合。不同文件经不同 loader 处理后归一为"标准 JS + 依赖列表",便于统一分析。

### 路径解析:enhanced-resolve

`import './foo'` 或 `import 'lodash'` 要先变成磁盘上的真实路径:

- 相对路径按 `context` 定位;裸模块名(`lodash`、`@scope/pkg`)去 `node_modules` 找;
- 依次尝试 `resolve.extensions` 里的扩展名(缺省 `.js`、`.json`);
- 命中 `resolve.alias` / `resolve.modules` 时按别名 / 指定目录解析。

由 **enhanced-resolve** 完成,也是调 `resolve` 提速的落点(见[性能篇](./performance.md))。

### 依赖收集:为何动 AST 而非正则

Loader 输出的是标准 JS 字符串。Webpack 用 Parser(基于 acorn)把代码解析成 AST,遍历找出 `import`/`export`/`require`/`import()` 节点,为每个依赖生成 Dependency 描述对象(specifier、ESM/CJS 等)。

模块关系是**语法级**信息,正则/字符串匹配会错:

- `import { a as b } from './x'`——重命名、别名要准确记录;
- `import './polyfill'`——纯副作用导入,没有导出可引;
- `require(someVar)`——CJS 依赖运行时才知道,静态分析无从下手。

这也解释了[性能篇](./performance.md)里"摇树只有 ESM 能做":依赖关系必须在编译期(静态)就可枚举,CJS 做不到。

### 递归建图与循环依赖

每个模块 build 完,对每条 Dependency 递归创建下一个模块:

```
import './a' ──► 创建模块 a → build(loader→AST→收集依赖)
                        │
                        ├─ import './b' ──► 创建模块 b → build → …
                        └─ import './c' ──► 创建模块 c → build → …
       ……直到所有依赖都已解析 → 模块依赖图完整
```

**循环依赖为何不死循环**:模块在 build 前就被注册进依赖图(先占位、后填内容)。`a → b → a` 时第二次遇到的 `a` 是同一个、正在构建中的模块对象,不会重新创建,递归自然终止。构建期只需要静态依赖列表,不需要先拿到"值"。

### 三张图:Module / Chunk / Asset

构建到输出经历三张不同性质的图:

| 图           | 含义                                         | 形成时机            | 回答的问题                            |
| ------------ | -------------------------------------------- | ------------------- | ------------------------------------- |
| Module Graph | 模块间逻辑依赖(谁 import 谁)                 | 编译(make)阶段      | "应用由哪些模块组成、关系如何"        |
| Chunk Graph  | 模块如何归并成加载单元(chunk)                | 封装(seal)阶段      | "按入口/懒加载/分包规则,分成几个文件" |
| Asset        | chunk 渲染后生成的最终文件(名 + 内容 + hash) | 渲染(processAssets) | "磁盘上到底写入哪些文件"              |

`contenthash` 稳定因为它由 asset 所依赖的模块内容算出(见[核心篇](./core-config.md));`splitChunks` 改的是 **Module → Chunk** 这步的归并策略(见[性能篇](./performance.md))。搞清这三层,配置与优化都有了"落点"。

## 速查

| 主题                    | 一句话记住                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| 四大阶段                | 初始化建 Compiler、make 建模块图、seal 模块归 chunk 并渲染成 asset、emit 写盘                                 |
| Compiler vs Compilation | 进程级单例总控 vs 单次编译实例;watch 下 Compiler 常驻、Compilation 每轮新建                                   |
| Tapable                 | 发布订阅事件总线;钩子分同步/异步、可中断/传值;插件用 tap / tapAsync / tapPromise 注册                         |
| 插件本质                | `apply(compiler)` 里往 hooks 挂回调;Compilation 子钩子经 `compiler.hooks.compilation` 桥接                    |
| 依赖图                  | enhanced-resolve 找文件 → loader 转译 → acorn 建 AST → 收集 Dependency → 递归建图;先注册后 build 解决循环依赖 |

> 官方文档:webpack.js.org/api/compiler-hooks、/api/compilation-hooks、/api/plugins、/contribute/plugin-patterns、/api/parser;Tapable 见 github.com/webpack/tapable。下一篇:[工程化实践与生态](./engineering.md)。
