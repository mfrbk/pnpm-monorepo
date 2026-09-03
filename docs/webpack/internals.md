# Webpack 底层原理与源码架构

> [← 返回总纲](./README.md) · 本系列第 3 篇:构建生命周期 / Compiler 与 Compilation / Tapable 钩子 / AST 解析与依赖图

会写配置的人很多,能讲清"Webpack 内部到底怎么转"的人是少数,而这恰恰是**排查诡异问题、手写插件、应对源码面试**的分水岭。这一篇请换一种心态:**别把 Webpack 当"配置工具",把它当成一个跑在 Node 上的 JS 程序**——配置只是它的入参,我们来看它拿到入参后,内部那个状态机是怎么一路转下去的。

## 一、整体构建流程:一次打包的完整生命周期

先看骨架。Webpack 一次完整构建,可以压缩成四个阶段:

```
① 初始化        读配置、合并参数,创建 Compiler 对象,注册所有插件的钩子
② 编译(make)    从 Entry 出发,递归解析依赖、构建出"模块依赖图"(只算不改输出)
③ 封装(seal)    把模块图 → chunk 图 → 逐块渲染生成代码 → 产出内存中的 asset(文件内容)
④ 输出(emit)    把 asset 写入磁盘,通知 done
```

### 阶段一:初始化——配置只是"剧本",Compiler 才是"总导演"

- CLI / 配置文件 / 环境变量被合并成一份最终 `options`(配置 merge 与校验就发生在这里)。
- 用 `options` **实例化全局唯一的 `Compiler` 对象**(整个构建期只存在一个),设置 context、文件系统、缓存等基础设施。
- 遍历配置里的 `plugins`,逐个调用其 **`apply(compiler)`**,把插件的回调**注册**到对应生命周期钩子上。
- 触发 `environment` / `afterEnvironment` / `entryOption` 等钩子,准备就绪。

> **一个关键顺序**:插件的 `apply` 在构建**开始之前**就跑完了,所以插件能监听到从 `compile` 到 `done` 的全程事件。这也是为什么 [核心篇](./core-config.md) 说 Plugin 是"全局能力"。

### 阶段二:make——构建模块依赖图

`compiler.run()` 触发 `run` 钩子后进入 `compile`,创建本次的 **`Compilation`**,然后进入最重要的 **`make`** 钩子(AsyncParallel):

- 遍历入口,把每个 Entry 封装成"入口依赖",交给 `NormalModuleFactory` **创建入口模块**;
- 对每个模块执行 **build**:读文件 → 跑 [Loader 链](./core-config.md)(把 TS/Sass/JSX 转成标准 JS)→ 用 **Parser 解析 AST** → 收集它 import/require 的**依赖列表**;
- 对每个依赖**递归**重复上一步,直到"没有尚未解析的依赖"为止 → **模块依赖图(Module Graph)构建完成**,`finishMake`。

这一阶段干的是**纯逻辑推理**:只摸清"谁依赖谁",**不产出任何文件**。类比:**make = 调研画图,seal = 出图纸**,emit = 盖楼。

### 阶段三:seal——模块图如何变成文件

这是源码最复杂的部分,内部又分两小步:

1. **模块图 → chunk 图**:根据入口归属、`import()` 懒加载点、`splitChunks` 规则(见 [性能篇](./performance.md)),把成百上千个 module **归并进一个个 chunk**(chunk 是"浏览器加载单元")。同时分配 module / chunk 的 id(production 用确定性短 id)。
2. **优化与渲染**:触发一串 `optimize*` 钩子 —— **摇树(`usedExports` / `sideEffects`)、压缩(Terser)、作用域提升**都发生在这里;然后逐 chunk **code generation** 拼接代码、算出 `contenthash`,最终产出一批内存里的 **asset**(文件名 + 内容)。Webpack 5 的 `processAssets` 钩子让你在此时对 asset 做增删改。

### 阶段四:emit——落到磁盘

- `emit`(AsyncSeries)钩子触发,**此刻还能修改将写入的 asset**;
- 把 asset 通过 `compiler.outputFileSystem` 写入 `output.path`;
- `afterEmit` → `done`,一次构建结束,进入回调 / 触发编译完成的插件逻辑。

**四条线索速记**:

| 阶段      | 干的事                          | 产物                       | 关键 hooks                         |
| --------- | ------------------------------- | -------------------------- | ---------------------------------- |
| 初始化    | 合并参数、建 Compiler、注册插件 | Compiler(options, plugins) | `environment` `entryOption`        |
| 编译 make | 递归构建模块图                  | Module Graph               | `compile` `make` `finishMake`      |
| 封装 seal | 模块归 chunk、优化、生成代码    | Chunk Graph + asset        | `seal` `optimize*` `processAssets` |
| 输出 emit | 写盘、收尾                      | dist/ 文件                 | `emit` `afterEmit` `done`          |

## 二、Compiler 与 Compilation:全局调度 vs 单次编译

新手最容易混淆的两个类。记住一句话:**Compiler 是整个构建的"一次进程生命周期",Compilation 是"一次编译"**。watch 模式下,一个进程里会跑无数次编译,所以关系很清晰。

|            | `Compiler`                                              | `Compilation`                                                    |
| ---------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| 数量       | 整个运行期**唯一**                                      | **每次编译新建**一个                                             |
| 职责       | 总控:启动 / 调度 / 收尾,持有全局配置与基础设施          | 干活:承载本次构建的所有模块、依赖、chunk、asset                  |
| 类比       | 项目经理(管整场项目)                                    | 这次任务的工单 / 现场(管这轮产物)                                |
| watch 下   | 复用同一个                                              | 每次文件变更都 `new` 一个重新编译                                |
| 关键数据   | `options`、`hooks`、`context`、`outputFileSystem`、缓存 | `modules`(Set)、`chunks`、`assets`、`moduleGraph` / `chunkGraph` |
| 典型 hooks | `run` `compile` `make` `emit` `done`                    | `buildModule` `seal` `optimizeModules` `processAssets`           |

**为什么必须拆成两个?** 因为**"全局状态"和"单次状态"必须分开**。watch / HMR 场景里,Compiler 要一直活着(管监听、管缓存、管下一轮编译),而每次编译的 modules / chunks 都是**全新一批**,若混在同一个对象里,上一轮数据会污染下一轮。职责分离后:

- **要"每轮都做、且要动全局配置"的事**,挂在 Compiler hooks 上;
- **要"针对当前这批产物"做的事**(遍历本次模块、改本次 asset),挂到 `compilation` 的 hooks 上。

```js
compiler.hooks.emit.tap('P', (compilation) => {
  // emit 参数是 compilation:此刻能读到/改写这轮的 assets
})
```

## 三、Tapable:让插件能"插一脚"的事件总线

Webpack 能如此可扩展,全靠底层的 **Tapable** 库——一个精密的**发布 / 订阅(事件)系统**。`compiler.hooks` 和 `compilation.hooks` 上的每个钩子,都是 Tapable 提供的某种 Hook 实例。

### 钩子的类型决定"行为语义"

不同的钩子决定:回调是同步还是异步、能否中断、前一个的结果要不要传给下一个:

| Hook 类型           | 语义                                           | 真实例子                                               |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------ |
| `SyncHook`          | 同步串行,互不传参                              | `compiler.hooks.done`、`compilation.hooks.buildModule` |
| `SyncBailHook`      | 同步串行,某回调返回非 undefined 即**短路中止** | `compiler.hooks.shouldEmit`(返回 false 则不输出)       |
| `SyncWaterfallHook` | 同步,上一个回调的**返回值作为下一个的入参**    | 数据加工链                                             |
| `AsyncSeriesHook`   | 异步**串行**,一个个等回调完成                  | `compiler.hooks.run`、`emit`、`processAssets`          |
| `AsyncParallelHook` | 异步**并行**,一起跑完再继续                    | `compiler.hooks.make`                                  |

### 插件如何"注册"回调:三种 tap

插件本质是 **"一个带 `apply(compiler)` 方法的对象"**,在 `apply` 里按钩子类型用不同方式注册:

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

> 命名规范:`tap('插件名', ...)` 的第一个参数是**插件标识**,一个钩子上可以挂很多插件,靠名字区分、顺序清晰——这也是 Tapable 名字的由来:多个订阅者像水龙头(Tap)一样接到同一条管道上。

### 写一个能落地的自定义插件

把上面拼起来,写个"在产物里加一个版本说明文件 + 统计本轮模块数"的插件(Webpack 5 API):

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

用法与内置插件一致:配置里 `new VersionPlugin()`。**这个插件同时示范了两件事**:通过 `compiler.hooks.compilation` 钩到"单次编译内部"去监听 `Compilation` 的子钩子;以及用 `compilation.emitAsset` 在输出前改写资产——这正是 [核心篇](./core-config.md) 说的"Plugin 能在构建全程介入"的底层真相。

## 四、模块解析与依赖图:Webpack 怎么"看懂"代码

### 一个"模块"在 Webpack 眼里是什么

不要把模块等同于"一个文件"。Webpack 视角下,一个 **module** 是**一条独立的构建单元**:一个文件 + 经过 loader 链转译后的代码 + 解析出的依赖集合。不同文件经不同 loader 处理,但最终都归一到"标准 JS + 依赖列表",方便统一分析。

### 路径解析:从 import 到真实文件(enhanced-resolve)

拿到 `import './foo'` 或 `import 'lodash'`,首先要把它变成**磁盘上的真实路径**:

- 相对路径按 `context` 定位;裸模块名(`lodash`、`@scope/pkg`)去 `node_modules` 找;
- 依次尝试 `resolve.extensions` 里的扩展名(缺省 `.js`、`.json`);
- 命中 `resolve.alias` / `resolve.modules` 时按别名 / 指定目录解析。

这步由 **enhanced-resolve** 完成,也是很多人调 `resolve` 配置提速的地方(见 [性能篇](./performance.md))。

### 依赖收集:为什么要动 AST,不能正则匹配

拿到文件内容后,Loader 输出的是标准 JS 字符串。Webpack 用 **Parser(基于 acorn)把代码解析成 AST(抽象语法树)**,再遍历 AST 找出 `import` / `export` / `require` / `import()` 节点,为每个依赖生成一个 **Dependency 描述对象**(记录目标 specifier、是 ESM 还是 CJS 等信息)。

**为什么必须上 AST?** 因为模块关系是**语法级**的信息,靠正则/字符串匹配会错:

- `import { a as b } from './x'`——重命名、别名都要准确记录;
- `import './polyfill'`——**纯副作用导入**,没有导出可引;
- `require(someVar)`——CJS 的依赖是**运行时才知道**,静态分析根本无从下手。

这同时解释了 [性能篇](./performance.md) 里"摇树为什么只有 ESM 能做":**依赖关系必须在编译期(静态)就能枚举**,CJS 做不到。

### 递归与依赖图:一张图如何被"走"出来

每个模块 build 完后,对它的每条 Dependency **递归创建下一个模块**,流程可概括为:

```
import './a' ──► 创建模块 a → build(loader→AST→收集依赖)
                        │
                        ├─ import './b' ──► 创建模块 b → build → …
                        └─ import './c' ──► 创建模块 c → build → …
       ……直到所有依赖都已解析 → 模块依赖图完整
```

**循环依赖为什么不会死循环?** 两个模块互相 `import` 很常见。关键在构建顺序:**模块在开始 build 之前就被注册进依赖图**(先占位、后填内容)。当 `a → b → a` 时,第二次遇到的 `a` 拿到的还是**同一个、正在构建中的 a 模块对象**,不会重新创建,递归自然终止。Webpack 允许循环 import,因为构建期只需要静态依赖列表,不需要先拿到"值"。

### 三张图,别混:Module Graph / Chunk Graph / Asset

构建到输出,Webpack 内部其实经历了**三张不同性质的图**,面试与读源码都爱考:

| 图           | 含义                                             | 形成时机            | 回答的问题                            |
| ------------ | ------------------------------------------------ | ------------------- | ------------------------------------- |
| Module Graph | 模块间的**逻辑依赖**(谁 import 谁)               | 编译(make)阶段      | "应用由哪些模块组成、关系如何"        |
| Chunk Graph  | 模块如何被**归并成加载单元**(chunk)              | 封装(seal)阶段      | "按入口/懒加载/分包规则,分成几个文件" |
| Asset        | chunk 渲染后生成的**最终文件**(名 + 内容 + hash) | 渲染(processAssets) | "磁盘上到底写入哪些文件"              |

`contenthash` 之所以稳定,正因为它由 **asset 所依赖的模块内容**算出(见 [核心篇](./core-config.md));而 [性能篇](./performance.md) 里 `splitChunks` 改的是 **Module → Chunk** 这一步的归并策略。搞清这三层,配置和优化就都有了"落点"。

## 速查

| 主题                    | 一句话记住                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| 四大阶段                | 初始化建 Compiler、make 建模块图、seal 模块归 chunk 并渲染成 asset、emit 写盘                                 |
| Compiler vs Compilation | 进程级单例总控 vs 单次编译实例;watch 下 Compiler 常驻、Compilation 每轮新建                                   |
| Tapable                 | 发布订阅事件总线;钩子分同步/异步、可中断/传值;插件用 tap / tapAsync / tapPromise 注册                         |
| 插件本质                | `apply(compiler)` 里往 hooks 上挂回调;Compilation 子钩子需经 `compiler.hooks.compilation` 桥接                |
| 依赖图                  | enhanced-resolve 找文件 → loader 转译 → acorn 建 AST → 收集 Dependency → 递归建图;先注册后 build 解决循环依赖 |

> 官方文档:webpack.js.org/api/compiler-hooks、/api/compilation-hooks、/api/plugins、/contribute/plugin-patterns、/api/parser;Tapable 见 github.com/webpack/tapable。下一篇:[工程化实践与生态](./engineering.md)。
