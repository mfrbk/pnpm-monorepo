# Vite 对比 Webpack 与生态视野

> [← 返回总纲](./README.md) · 本系列第 4 篇:何时选 Vite 何时留 Webpack / 框架与元框架版图 / Vitest 与 Storybook 工具链

前三篇都在讲 Vite"自己";最后一篇把它放回**整个前端工程化坐标系**里看:它和 Webpack 的差距到底在哪、什么场景该选谁、围绕它长出了多大的工具生态。理解这一点,你才不会被"Vite 就是快"这类口号带偏——**快是有代价的,选型要按项目诉求来**。

## 一、与 Webpack 的核心差异:不是"快一点",是"机制不同"

两者最本质的区别是**开发模式的工作机制**不同(详见 [架构篇](./architecture.md)):

- **Webpack dev**:先把整棵依赖图**打包好**再交给浏览器,冷启动 / HMR 都要让**编译器**处理整张图——时间与项目规模强相关;
- **Vite dev**:浏览器**原生按需 import**,Vite 只转译被请求到的单文件,没有"打包"这一步——冷启动近秒级,HMR 毫秒级,且**与规模几乎无关**。

由此带来的体验差距(实践层面的常见体感,非精确基准):

| 维度     | Vite                       | Webpack                                            |
| -------- | -------------------------- | -------------------------------------------------- |
| 冷启动   | 秒级(依赖预构建后近乎秒开) | 大型项目可达几十秒~分钟级                          |
| HMR      | 单文件级更新,几乎瞬时      | 较快,但每次改动需编译器重走图(增量/缓存后仍可接受) |
| 内存占用 | dev server 无整图驻留,较轻 | 维护整张 module graph + 缓存,大型项目吃内存        |
| 配置心智 | 少而精,开发零配置起步      | 概念多、默认少,复杂项目配置庞大                    |
| 插件生态 | 继承 Rollup,新项目/库常用  | 体量最大,Webpack 专属插件极多                      |
| 产物品质 | Rollup 打包,摇树/分割成熟  | 打包 + 压缩久经考验,优化面最全                     |

**⚠️ 但要破除一个神话**:"Vite 生产更快更小"并不总是成立。双引擎下,dev 的"快"来自**不打包**,而这套优势**不延伸到 build**(build 还是要 Rollup 全量打包,甚至比 Webpack 大项目快不了多少)。**把 Vite 的"快"精确理解为"开发快",是避免误判的关键。**

### 什么场景首选 Vite

- **新起的 SPA / 中后台**:开发体验是压倒性优势;
- **追求极致的开发反馈**(改样式、改组件要毫秒级);
- **框架官方已把 Vite 当默认**(Vue、Svelte、Solid 等,见下节),跟着生态走最省心。

### 什么场景仍要 Webpack

- **历史大型项目,重度依赖 Webpack 专属插件/配置**:迁移成本远大于收益;
- **需要 Webpack 特有能力的**:某些老牌插件的独家能力、极度细粒度的 loader 定制;
- **团队已沉淀大量 Webpack 经验与基建**:稳字当头时,"够用 + 熟练"比"更快"更重要;
- 微前端里 **Module Federation 的本家实现**在 Webpack(Vite 侧用社区插件,成熟度看项目取舍)。

> 判断标准一句话:**新项目、Dev 体验优先 → Vite;老项目、重度定制与既有生态锁定 → 留在 Webpack**。两者不是"新替代旧",而是"不同项目阶段的正确工具"。Webpack 侧的完整原理可对照 [Webpack 系列](../webpack/README.md)。

## 二、广泛的框架支持:它不是"Vue 专属"

一个常见误会:Vite 因为常和 Vue 一起出现,被当成"Vue 的构建器"。实际上 **Vite 核心是框架无关的**,它的策略是"核心只做模块与资源,Vue/React/Svelte 的编译全部由**插件**接入"——所以对任何框架,接入成本都是一个插件。

| 框架     | 插件                           | 元框架(全家桶)                        |
| -------- | ------------------------------ | ------------------------------------- |
| Vue      | `@vitejs/plugin-vue`           | **Nuxt**                              |
| React    | `@vitejs/plugin-react`         | **Remix**、Expo(React Native web)     |
| Svelte   | `@sveltejs/vite-plugin-svelte` | **SvelteKit**                         |
| Solid    | `vite-plugin-solid`            | SolidStart                            |
| Preact   | `@preact/preset-vite`          | —                                     |
| Lit      | `@lit-labs/vite-plugin` 等     | —                                     |
| Qwik     | 官方 Vite 插件                 | Qwik City                             |
| (内容站) | —                              | **Astro**(默认基于 Vite,islands 架构) |

看点:**每个主流框架都长出了自己的元框架**,而底层都是 Vite。这带来一个很实际的结论:**学好 Vite 本身,等于同时理解了 Nuxt / SvelteKit / Astro 这些框架的构建底层**——技能可以跨框架迁移,这是很多人在"工具链迁移"时忽略的红利。

## 三、测试与周边生态:一套配置通吃全链路

Vite 的另一大优势,是把**同一套配置心智延伸到测试与文档**:

### Vitest:和 Vite 共享一切的测试框架

Vitest 直接把 Vite 当底层,因此**你的 alias、plugins、env、tsconfig 处理,测试环境原样生效**,不必像 Jest 时代那样单独维护一套 transform 配置:

```ts
// vitest.config.ts —— 通常直接复用 Vite 配置
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom', // 或 'happy-dom' / 'node'
    globals: true,
  },
})
```

- 单元测试(纯逻辑)、组件测试(Vue/React 组件 + DOM 环境)都覆盖;
- 冷启动快、watch 模式极速,**测试反馈节奏接近开发**。

### Storybook:组件文档的 Vite 底座

Storybook 早已原生支持 Vite(builder),意味着组件库的**开发/文档/测试/示例**与真实应用共享同一套构建规则,组件在 Storybook 里能跑通,进了应用也大概率一致。

### 收益总结:"工具链收敛"

对一个组件库/中型项目,Vite 让以下环节**共用配置与心智**:

```
业务应用(vite) ──► 测试(vitest, 复用 vite.config)
       │                    │
       └────► Storybook(vite builder) ──► 文档/示例
```

**少维护 N 套 build 配置**,是 Vite 生态在"纯性能"之外、常常被低估的生产力优势。

## 四、决策速查:站在项目面前怎么选

| 你的情况                        | 建议                                   | 理由                                                                       |
| ------------------------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| 新 SPA / 中后台,重开发体验      | **Vite**                               | Dev 快、配置少、生态成熟                                                   |
| 新库/组件要发 npm               | **Vite lib mode 或 tsup/Rollup**       | 产物干净;本仓库 `@mzy1120/*` 即用 tsup(esbuild 系),纯 JS 库不必然需要 Vite |
| Vue / Svelte / Solid 新项目     | **Vite**(框架官方默认)                 | 元框架(Nuxt/SvelteKit…)底层就是 Vite                                       |
| 大型遗留,重度 Webpack 插件/配置 | **留在 Webpack**                       | 迁移成本 ≫ 收益,稳定优先                                                   |
| 需要 Module Federation 且求稳   | **Webpack 本家**(或评估 Vite 联邦插件) | Webpack 侧是 MF 的原始实现                                                 |
| 极致产物优化/深度定制           | 两者都行,按团队熟悉度                  | 产物都由 Rollup/专业打包器承担,差别不大                                    |
| 内容站 / 岛屿架构               | **Astro**(底层 Vite)                   | 内容优先 + 按需水合                                                        |

**几条通用心法**:

- **别用"快"一票否决 Webpack**:老项目的瓶颈往往是迁移风险,不是 dev 速度;
- **Vite 的"快"是开发快**,build 环节两家处于同一量级;评估要分"开发体验"与"产物/构建"两本账;
- **跟着生态走**:框架官方默认用谁,新项目就优先信谁——省下的是长期的踩坑成本;
- 工具概念高度同构(入口/别名/代理/摇树/分割/Source Map/缓存),**学通一家,换工具只是换方言**。

## 速查

| 主题         | 一句话记住                                                                 |
| ------------ | -------------------------------------------------------------------------- |
| 与 Webpack   | 差异集中在 **dev 机制**:Vite 按需转译 vs Webpack 全量打包;build 两家同量级 |
| 何时 Vite    | 新项目、Dev 优先、框架官方默认                                             |
| 何时 Webpack | 大型遗留、重度 Webpack 插件/配置锁定、MF 本家需求                          |
| 框架支持     | 核心框架无关;Vue/React/Svelte/Solid… 都靠插件接入,元框架底层皆 Vite        |
| 工具链       | Vitest / Storybook 复用 Vite 配置,一套配置通吃应用/测试/文档               |
| 心法         | 开发体验与产物质量分两本账评估;概念同构,迁移成本主要在生态而非心智         |

> 官方文档:vite.dev/guide(生态与框架)、vitest.dev、storybook.js.org。整个系列回到 [总纲](./README.md);体系内对照阅读:[Webpack 学习系列](../webpack/README.md)。
