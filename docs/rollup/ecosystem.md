# Rollup 对比 Webpack/Vite 与生态视野

> [← 返回总纲](./README.md) · 本系列第 4 篇:何时选 Rollup / Vite 为何以它做生产引擎 / 生态源码阅读路线图

三兄弟都叫"打包器",但**服务对象不同、价值曲线不同**。这一篇把 Rollup 放回坐标系:它和 Webpack 怎么分界、Vite 和它是什么关系、以及想再往上走一步该去读哪些源码。

## 一、Rollup vs Webpack:判断依据就一条

> **目标产物是不是"给其他代码 import 的模块"?是 → Rollup;是"给用户打开的可部署应用" → Webpack/Vite。**

这个判据能解释一切差异——类库的消费者是**下一层代码**;应用的消费者是**浏览器里的用户**。两者的需求注定不同:

| 维度          | Rollup(面向库)                  | Webpack / Vite(面向应用)         |
| ------------- | ------------------------------- | -------------------------------- |
| 目标产物      | 可被 import 的干净模块          | 可独立部署的页面资源             |
| 运行时开销    | **零运行时**,扁平化输出         | 有模块运行时/HMR 客户端          |
| 摇树深度      | 极强(库越小越受益)              | 强(但主要吃"入口引用"层面的收益) |
| 多格式        | 一等公民(es/cjs/iife/umd)       | 基本只出浏览器 bundle            |
| dev 体验      | 无 dev server/HMR(需自配 watch) | **全副武装**(HMR/热更/代理)      |
| 资源/应用管线 | 几乎全交给插件                  | 内置与生态极其丰富               |
| 内置压缩      | 否(加 terser 插件)              | 生产默认压缩                     |

**Rollup 是"打库的事实标准"**,生态里有大量例证:

- **Vue 核心、Preact** 等知名库的 npm 产物由 Rollup 构建;
- **React** 官方产物(ES/CJS/UMD 多格式)同样由 Rollup 产出——"一把源码出多格式"正是它的看家本领;
- **lodash-es** 则代表"以 ESM 形态发布、把摇树权交给下游"的库形态(理念与 [核心篇](./core.md) 里"保留 export"同源)。

**什么时候回头用 Webpack/Vite**:目标是"完整 Web 应用",需要 HMR、页面资源、代码分片、MF 等整套应用管线时——强行用 Rollup 搭应用等于把 Webpack/Vite 内置的活全部手动拼装,得不偿失。完整的应用侧对比见 [Webpack 工程化篇](../webpack/engineering.md) 与 [Vite 生态篇](../vite/ecosystem.md)。

| 你的情况                              | 建议                                                  |
| ------------------------------------- | ----------------------------------------------------- |
| 开发一个会被 import 的 npm 包/组件库  | **Rollup**(或 tsup/Vite lib mode 这些"Rollup 系"封装) |
| 需要一个干净、多格式、可摇树的 ESM 包 | **Rollup**                                            |
| 开发可部署的 SPA / 追求 dev 体验      | **Vite**(新)/ **Webpack**(遗留或强生态锁定)           |
| 需要 dev 热更 + 又要产库产物          | Vite(lib mode)或 tsup——库的产物与 dev 需求可兼得      |

## 二、Vite 与 Rollup:生产引擎就是 Rollup

很多人没意识到一个事实:**Vite 的 `build` 命令,底层就是 Rollup**。

回顾 [Vite 双引擎](../vite/architecture.md):开发期 Vite 靠"原生 ESM + esbuild 预构建"做到毫秒级,但那套"不打包"只服务于开发;上线前它仍要打包(请求数、摇树、分割、压缩),这一步交给的是 **Rollup**——Vite 复用 Rollup 的打包能力与插件生态,自己补上 dev server / 预构建 / 资源管线那层。

**这个关系带来三个"于是"**:

1. **Vite 配置里出现 `build.rollupOptions` 不是巧合**:Vite 把 Rollup 的选项原样透传,所以 [配置篇](./config.md) 学的 `input/external/output/rollup` 心智,在 Vite 里直接可用;
2. **Rollup 插件能用在 Vite 构建**:Vite 插件是"Rollup 插件接口 + 若干 Vite 专属钩子"的超集(见 [Vite 插件篇](../vite/plugins.md));能写 Rollup 插件,就懂 Vite 构建期一半;
3. **未来 Rolldown 也是平滑的**:Vite 正用 Rust 的 Rolldown 逐步替换生产引擎以统一 dev/build,但它仍是"Rollup 式心智"——**学透 Rollup,等于提前投资了 Vite 的现在与未来**。

```
Vite dev: 原生 ESM + esbuild 预构建(开发快)
Vite build: ──► Rollup 打包(产物优) ──(未来)──► Rolldown
                    ▲
              本系列讲的就是这一层
```

## 三、生态源码阅读:再往上走一步的路线图

Rollup 官方插件普遍**小而克制**(常在几百行内),且都遵循"极简内核 + 单职责钩子"哲学,**是读码学习的绝佳样本**。推荐顺序与看点:

| 阅读对象                      | 看点                                                              |
| ----------------------------- | ----------------------------------------------------------------- |
| `@rollup/plugin-replace`      | 最薄样本:一个 `transform` 走天下,先建立"插件到底长啥样"           |
| `@rollup/plugin-node-resolve` | `resolveId` 的深度用法:包名解析、`dedupe` 去重、`extensions` 兜底 |
| `@rollup/plugin-commonjs`     | 组合拳范本:`resolveId → load → transform` 如何协同把 CJS 转 ESM   |
| `@rollup/plugin-terser`       | 外部压缩器怎么在 `renderChunk/generateBundle` 阶段介入产物        |
| `rollup-plugin-dts`           | 高阶创意:用 Rollup 打包 `.d.ts`,看类型文件如何被当"模块"处理      |
| Rollup 内核 `lib/`            | 有余力再看 `Graph`(模块图)、`Chunk`(产物)、`ModuleLoader`         |

**读码的三条内功心法**:

1. **先找钩子,再看业务**:每个插件文件里,钩子函数(`resolveId/load/transform/...`)就是骨架,顺着钩子读实现最快;
2. **留意 `return null` 与 `\0`**:`null` = 交还控制权,`\0` = 内部虚拟 id——这两处约定藏着插件协作的礼仪;
3. **对照官方文档的钩子表读**:把 [插件篇](./plugin-api.md) 的生命周期图摆在旁边,读到哪个钩子就去图里找它的位置。

读毕再看 Vite 的构建管线([插件篇](../vite/plugins.md) + Vite 源码 `packages/vite/src/node/build.ts`),你会自然打通"Rollup 能力层"与"Vite 应用层"。

## 四、发布前自检清单:一个"打得专业"的库

把系列知识收成一张发版前的检查单:

- [ ] **external 收敛**:`peerDependencies`(React 等)不进产物;`dependencies` 视策略决定,绝不把消费方该提供的打进包里
- [ ] **多格式齐全**:`es`(主)+ `cjs`(Node 兼容),需要 `<script>`/老平台再加 `iife`/`umd`(配好 `name` + `globals`)
- [ ] **产物干净可摇树**:es 产物保留具名导出、无运行时外壳
- [ ] **类型三件套**:`declaration: true` 或 tsc 单独出 `.d.ts`,`exports.types` 指到正确文件
- [ ] **Source Map**:开启且按需选择是否随包分发(见 [配置篇](./config.md))
- [ ] **package.json `exports`**:`import`/`require` 条件各指各的文件,`main/module/types` 兜底
- [ ] **files 白名单**:发布只含 `dist/` 与必要文件,不含源码与测试

> 本仓库 `@mzy1120/*` 子包(如 `@mzy1120/http`)选用 **tsup**(esbuild 打码 + Rollup 合并 d.ts)走的就是同一条"库工程"路径:esm + cjs + d.ts、`files` 仅 `dist`、`sideEffects: false`。想换成"裸 Rollup"手控细节,把 [配置篇](./config.md) 的样板搬过去即可。

## 速查

| 主题       | 一句话记住                                                            |
| ---------- | --------------------------------------------------------------------- |
| 判据       | 产物给"别的代码 import" → Rollup;给"用户打开的应用" → Webpack/Vite    |
| vs Webpack | 库要零运行时/多格式/可摇树 → Rollup;应用要 HMR/资源/分片 → Webpack    |
| 与 Vite    | **Vite 的 build 就是 Rollup**;学 Rollup = 学 Vite 生产构建底层        |
| Rolldown   | Vite 的未来引擎,仍是 Rollup 式心智;本系列知识不过期                   |
| 读源码     | 从 plugin-replace → node-resolve → commonjs 读起;先找钩子再读实现     |
| 发布清单   | external / 多格式 / 类型 / sourcemap / exports / files 六件事缺一不可 |

> 官方文档:rollupjs.org、github.com/rollup/plugins(源码);对照阅读:[Webpack 学习系列](../webpack/README.md)、[Vite 学习系列](../vite/README.md)。整个系列回到 [总纲](./README.md)。
