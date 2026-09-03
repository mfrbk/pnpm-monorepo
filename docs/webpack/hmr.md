# Webpack 热更新(HMR)原理:不刷新页面,它到底怎么做到的

> [← 返回总纲](./README.md) · 系列深度专题:从"WS 推 hash"到"模块原地替换",拆穿 HMR 的整条链路

HMR(Hot Module Replacement)是前端开发体验最容易被"理所当然"掉的技术:**保存一下,页面没跳、状态没丢,新代码就生效了**。但仔细想想这很反常——代码都换了,为什么表单里打到一半的字还在?这背后是一套 **dev server、webpack 编译器、浏览器三端协作 + 模块级替换协议**的精密系统。

[性能篇](./performance.md) 给过一句话概览,这一篇把它彻底拆开:一条消息从"你按 Ctrl+S"开始,到"新模块替换旧模块"结束,中间每一步发生了什么。

## 先建立心智模型:HMR 是三层结构

HMR 不是"webpack 的一个开关",而是**三个角色 + 两个阶段**的协作:

```
┌─────────────┐   WebSocket(通知)   ┌──────────────┐   HTTP(取货)   ┌──────────────┐
│  dev server │◄───────────────────►│  浏览器端 HMR │◄───────────────►│  webpack 编译 │
│ (推送者)     │   hash / ok / errors │  Runtime(消费者)│ hot-update.json│  产物提供方   │
└─────────────┘                     └──────────────┘   + .js 补丁    └──────────────┘
```

- **生产者**:webpack 以 **watch 模式**常驻,监听文件变更、做增量重编译,产出"这次改了哪些模块"的补丁。
- **信使**:dev server 与浏览器维持一条 **WebSocket**,负责把"编译好了、这是新 hash"通知过去。注意:**WS 只做通知,不传新代码**。
- **消费者**:产物里内置的一段 **HMR Runtime** 住在浏览器里,收到通知后主动去**拉补丁、执行替换**。

整个流程还能抽象成**两个阶段**:

1. **通知阶段(WS)**:编译完成 → server 推 `hash` 与 `ok`;
2. **拉取 + 应用阶段(HTTP + Runtime)**:浏览器拿 manifest → 下载更新 chunk → 在运行的模块图上"打补丁"。

## 一、Producer:watch 模式下,webpack 怎么"知道改了什么"

### 增量编译:文件变了,不代表全部重来

开启 `devServer.hot` 后,webpack 以 **watch 模式**运行:内部用 **watchpack** 监听整个 `context`(及依赖)下的文件系统事件。你保存 `a.js`,watchpack 把"哪个文件变了"告诉 Compiler,触发**一轮新的 Compilation**。

这里承接 [底层原理篇](./internals.md):watch 下 **Compiler 常驻复用,Compilation 每轮新建**——上一轮的内存缓存、模块图基础还在,配合 [性能篇](./performance.md) 的持久化缓存,这一轮往往只**重编译受影响的那一小片依赖**,这就是为什么热更新几乎"瞬间完成"。

### 产出物:一份清单 + 若干补丁

一轮编译结束,产物目录里除了普通资源,还会多出**两类给热更新用的文件**:

| 文件                             | 角色               | 内容                                                 |
| -------------------------------- | ------------------ | ---------------------------------------------------- |
| `[hash].hot-update.json`         | **清单(manifest)** | 本次 hash;哪些 chunk 变了、每个 chunk 里哪些模块变了 |
| `[chunkId].[hash].hot-update.js` | **补丁代码**       | 变更 chunk 里"新版本模块"的 JS 代码                  |

也就是说:webpack **不会把整个 bundle 推给浏览器**,而是精确到"哪个 chunk 的哪个模块版本过期了",只生成对应的最小补丁。

## 二、Messenger:WebSocket 只负责"喊一嗓子"

dev server(webpack-dev-server,内置 WebSocket server)等这轮编译结束、拿到 stats 后,通过那条浏览器早已连好的 WS 通道推送控制消息。核心就两条:

```text
{ "type": "hash", "data": "e07f9c..." }   // ① 新一轮构建的 hash
{ "type": "ok" }                          // ② 编译成功,可以去拉更新了
```

(另有 `invalid` = 开始编译、`errors`/`warnings` = 出错或告警。)

**关键认知:WS 消息里没有任何代码。** 它只负责三件事:**告知有新版本、给出新 hash、确认可以更新**。真正的"货"在下一步由浏览器主动来取。这么设计的好处是:通知信道永远轻量;补丁按需拉取,与普通 HTTP 缓存体系天然兼容。

> 一个容易混淆的点:如果你看过老文章,可能听说"HMR 用 sockjs 推 manifest"——其实**manifest 从未通过 WS 推送**。WS 推的只是 hash,浏览器拿 hash 去 HTTP 侧请求 manifest 与补丁。分清"推 hash、拉清单"就再也不会绕晕。

## 三、Consumer:HMR Runtime 如何"原地换芯"

### 产物里住着一段"热更新代理"

只要启用 HMR,webpack 的 **HotModuleReplacementPlugin** 会在产物里注入一段独立的 **HMR Runtime**(产物中 `webpack/hot/*` 那部分代码)。它维护着运行时最重要的数据结构:**已加载模块的注册表**(module id → 模块实现)与当前的"hot hash"。你可以把它理解成"运行中应用与编译产物的翻译层"。

Runtime 里几个关键函数的名字,读源码时能对上号:

| 函数(webpack 5 runtime)  | 职责                                           |
| ------------------------ | ---------------------------------------------- |
| `hotDownloadManifest`    | 请求 `hot-update.json`,拿到本次变更清单        |
| `hotDownloadUpdateChunk` | 以 JSONP 方式下载变更 chunk 的 `hot-update.js` |
| `hotApply`               | 核心:把新模块应用到运行中的模块图              |
| `hotAddDisposeHandler`   | 模块注册"卸载前清理"回调(见第五节)             |

### 应用更新:从"清单"到"换芯"

Runtime 收到 WS 的 `hash` 先**存起来不急着动**;收到 `ok` 才开始真正更新,顺序是:

```
① 请求 [新hash].hot-update.json ──► 拿到 { 变更chunk, 每chunk的变更模块 }
② 对每个变更 chunk,JSONP 加载其 .hot-update.js
   └─► 补丁脚本执行时,调用 runtime 的全局回调,
       把"新版本模块"写进运行时模块注册表(覆盖旧实现),并记录"哪些模块过期了"
③ hotApply:以"变更模块"为起点,确定替换范围并逐个替换(核心,见下节)
```

这里有个很妙的点:补丁文件靠 **JSONP** 加载——它不是一个返回数据的接口,而是一段**主动执行**的脚本。脚本跑完、把模块塞给 runtime、再触发 `hotApply`,加载本身与"应用"就自然衔接了。

## 四、hotApply:谁"接受"更新,决定替换还是刷新

这是 HMR 的灵魂:**并不是所有模块变了都能原地替换**。Runtime 需要回答一个问题——"这个模块被替换了,但还有没有代码**依赖着旧版本、需要一起处理**?"

### accept:模块声明"我能接住更新"

模块可以自己声明"我(或我依赖的某个模块)更新后,用新版本替换并执行一段回调就行"——这就是 **`module.hot.accept`**:

```js
// a.js 依赖 data.js;data.js 变了 → 重新拉最新值重渲染,不刷新页面
import { loadData } from './data.js'

export function render() {
  document.querySelector('#app').textContent = loadData()
}

if (module.hot) {
  module.hot.accept('./data.js', () => render()) // data.js 更新后执行回调
}
```

注意两个参数各有分工:

- **第一个参数(依赖模块)**:声明"哪些依赖变了我能兜住";
- **回调**:依赖真的更新后,用新模块重新跑一段逻辑。

### 冒泡:没人 accept,就往上找

现实里你几乎不会给每个模块写 accept,而是让框架(见第六节)在**组件边界**统一接住。Runtime 的策略是**从变更模块出发向上冒泡**:

```
      变更模块 data.js
         │  没人 accept data.js 自己?
         ▼
  依赖它的模块 a.js ──► a.js 里写了 accept('./data.js')? ──是──► 就地替换,完成 ✅
         │  没有?
         ▼
  再往上层:入口/组件容器模块
         └─► 有组件级 accept(如 Fast Refresh)? ──是──► 局部重渲染该组件 ✅
         └─► 一直冒到模块图根部都无人 accept? ───────► 整页刷新(reload)兜底 ❌
```

**为什么会"无人 accept 就整页刷新"?** 因为如果没人声明"我知道怎么用新版本接续",runtime 无法保证替换后应用还处于一致状态——**刷新是最安全的退路**。这正是 HMR 稳定性的设计哲学:**能局部换就局部换,换不了就整体重载,绝不产生"半新半旧"的脏状态**。

### 为什么状态不会丢:换的是"函数",不是"实例"

回到开头的反直觉问题:**为什么代码换了,页面状态还在?**

HMR 替换的粒度是"**模块文件导出的实现**"(函数、类、组件定义),而**应用运行时真正持有的是"基于旧实现创建的实例与数据"**(React Fiber 上的 hooks 状态、全局 store、DOM)。替换时:

1. 旧实现被新实现覆盖;
2. **已经存在的实例/数据并没有被销毁**,框架在 accept 回调里用"新组件函数"把已有状态**重新渲染一遍**,而不是推倒重建。

所以"状态保留"的本质不是 HMR 帮你存了份快照,而是**它更新的是"怎么画",你手里"画到一半的东西"原样没动**。对没有框架兜底的裸模块,状态要不要留、旧资源(定时器/订阅/事件)要不要清,都由你自己通过 dispose 决定:

```js
if (module.hot) {
  // 卸载旧模块前:清理它留下的副作用,防止"旧 + 新"两份并存
  module.hot.dispose(() => {
    clearInterval(timer)
    el.removeEventListener('click', handler)
  })
  module.hot.accept() // 我这个模块自身更新也能被接住
}
```

> `dispose` 与 `accept` 往往成对出现:accept 决定"怎么接续",dispose 保证"接续前先把旧的收拾干净"。漏写 dispose,热更新几次后可能堆积重复的定时器 / 监听器——这是手写 HMR 最常见的 bug。

## 五、三类"接住更新"的玩家

| 场景           | 谁来 accept                   | 更新后发生什么                                                                                                                                                     |
| -------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CSS**        | `style-loader`                | 天然支持:style-loader 在 accept 回调里**删除旧 `<style>` 标签、插入新样式**,页面不刷新、其他状态无损。所以"改样式秒生效且不丢状态"其实是 HMR + style-loader 的功劳 |
| **框架组件**   | react-refresh / vue-loader 等 | 在组件/路由边界 accept,用新组件函数**局部重渲染**,尽力保留 hooks/组件 state                                                                                        |
| **裸业务模块** | 你自己 `module.hot.accept`    | 完全由你掌控:接续逻辑、dispose 清理都自己写                                                                                                                        |

CSS 为什么是最"省心"的玩家值得多说一句:**样式本质是"注入即生效"的全局副作用**,不牵扯组件实例与数据,替换成本最低;而框架组件替换要照顾 hooks 状态、类组件实例,才需要专门运行时(React Fast Refresh)介入。

## 六、接住 React:Fast Refresh 做了什么

工程里你配置的是 `react-refresh`(React Fast Refresh),它本质是"**一个更聪明的、为 React 量身定做的 accept 实现**"。它要解决普通 `module.hot.accept(() => re-render)` 解决不好的问题:**怎么在保留组件状态的前提下换掉组件函数**。

它的核心决策(原则性概述,细节随版本演进):

- **函数组件 + hooks**:新函数拿到后,**用旧 Fiber 上的 hooks 状态重渲染** → 状态保留;
- **只改了 hooks 调用顺序 / 改了组件为非函数形态**等"不安全"变更:识别出无法安全保留,**降级为局部重挂载**,而不是状态错乱或整页刷新;
- **class 组件**等无法安全保留的场景:走 remount 或整页兜底。

Fast Refresh 还保证:**热更新永远只是"重跑你编辑的模块 + 它直接/间接渲染的子树",页面其他部分不动**——这比"整页刷新后靠路由还原"要快且状态更完整。

## 七、边界与降级:整套系统如何保证"不脏"

HMR 的健壮性来自它对"失败"的设计,而不是假设一定成功:

| 情况                            | 系统行为                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------- |
| 变更模块被 accept 接住          | 局部热替换                                                                       |
| 变更模块冒泡到根部仍无人 accept | **整页刷新**兜底,保证状态一致                                                    |
| 编译报错(`errors`)              | 不推送 `ok`;页面保持旧版本运行,错误打在终端 / overlay                            |
| 想连刷新兜底都关掉              | `devServer.hot: 'only'` → 更新失败只记日志,绝不自动 reload(便于在复杂调试时观察) |

配置层面回顾([性能篇](./performance.md) 有配法):

```js
module.exports = {
  devServer: {
    hot: true, // 开启 HMR(webpack-dev-server 会自动注入 HotModuleReplacementPlugin)
    // hot: 'only', // 连整页刷新兜底都禁用
  },
}
```

**生产环境为什么没有 HMR?** 生产构建没有 watch、没有 dev server、没有那条 WS 通道,HMR Runtime 也不被注入(被 `HotModuleReplacementPlugin` 只在开发注入)。上线后的"代码更新"走的是另一套东西:**新版本部署 + 带 `contenthash` 的文件名让浏览器精准失效缓存**(见 [核心篇](./core-config.md))——开发要"毫秒级原地换",生产要"稳妥地全量换",诉求不同,机制自然不同。

## 八、一次完整更新的时序回放

把全链路拼起来,一次典型 HMR 的完整时序:

```
你: Ctrl+S 保存 a.js
  │
webpack(watch): watchpack 感知 → 新 Compilation → 增量重编译 → 产出新 hash + 补丁
  │
dev server: 通过 WebSocket 推送 { hash } → { ok }
  │
浏览器 Runtime: 记住新 hash → 请求 [hash].hot-update.json(清单)
  │              → 对每个变更 chunk JSONP 加载 [chunk].hot-update.js(新模块代码)
  │              → hotApply:从变更模块冒泡找 accept 边界
  │                  ├─ 被 accept 接住 → dispose 清理旧副作用 → 替换模块 → 执行回调 / 框架重渲染
  │                  └─ 无人 accept  → 整页刷新兜底
  ▼
你: 页面没刷新,表单数据还在,新代码已生效
```

## 速查

| 环节      | 一句话记住                                                                       |
| --------- | -------------------------------------------------------------------------------- |
| 分层      | 生产者(watch 增量编译)/ 信使(WS 推 hash)/ 消费者(浏览器 Runtime 拉补丁替换)      |
| WS 传什么 | 只传控制消息(`hash`/`ok`),**代码永远走 HTTP**                                    |
| 补丁文件  | `hot-update.json` = 变更清单,`[chunk].hot-update.js` = 变更模块的新代码(JSONP)   |
| 应用逻辑  | `hotApply` 从变更模块**向上冒泡找 accept**;无人 accept → 整页刷新兜底            |
| 状态保留  | 换的是"模块实现(函数)",不销毁"已有实例/数据",框架用新函数带着旧状态重渲染        |
| 谁在接    | CSS 由 style-loader 接、React 由 Fast Refresh 接、裸模块自己 `module.hot.accept` |
| 稳定性    | 可局部换则局部换,换不了整体重载,绝不产生"半新半旧"脏状态                         |
| 生产      | 无 watch / 无 WS / 无 HMR runtime,靠 contenthash 走正常部署缓存                  |

> 官方文档:webpack.js.org/concepts/hot-module-replacement、/guides/hot-module-replacement、/api/module-variables(module.hot)、webpack.js.org/configuration/dev-server;Fast Refresh 见 react-refresh。相关阅读:[性能篇 · HMR 概览](./performance.md)、[底层原理篇 · Compiler/Compilation](./internals.md)。
