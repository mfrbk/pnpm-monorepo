# qiankun 应用模型与生命周期(第 1 篇)

> [← 返回总纲](./README.md) · 本系列第 1 篇:为什么微前端要"生命周期化" / 注册与启动 / activeRule 路由活动 / loadMicroApp 手动加载

看 qiankun 的 API 之前,先回答一个更根本的问题:**它凭什么能把一个"独立网页应用"装进另一个应用、切走、再装回来?** 答案是——它要求子应用不再是"自己启动的页面",而是**一个暴露了若干生命周期函数的模块**,由主应用决定何时调用哪个函数。这一篇把整个"应用如何被组织与调度"的模型讲透。

## 一、核心思想:把应用从"启动"改成"被调度"

普通单页应用是**自己启动**的:入口 JS 被加载,立刻创建根组件、mount 到 `#root`,生命周期自此由框架内部管理。

微前端要求子应用**让出启动权**:把"什么时候启动"("何时激活"、挂到哪)交给主应用。于是子应用入口从"一段启动代码"变成**一个带 `bootstrap / mount / unmount` 的模块**(single-spa 称作 lifecycle,是它作为"应用管理器"的核心抽象, qiankun 完整继承了这一点):

```
iframe 方案:        整页嵌套,主 / 子各自独立 document —— 隔离天然,但通信、样式、弹层、路由全要桥接
single-spa 思路:    子应用交出生命周期,主应用像"插拔"一样挂载 / 卸载 —— 共享同一个 document/window
```

对比 iframe 就能理解 qiankun 的取舍:iframe 的隔离"强得过头"(连 DOM、会话都分开,后续沟通成本极高);而 single-spa 式"软集成"共享同一环境,**代价是需要沙箱与样式隔离来补墙**(这正是[沙箱篇](./sandbox.md)、[样式篇](./style-isolation.md)存在的理由)。

## 二、生命周期五件套:子应用的核心契约

子应用入口必须导出(至少 `mount`、`unmount`,其余按需)这些异步函数:

| 生命周期    | 调用时机                                       | 典型职责                                                             |
| ----------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| `bootstrap` | 应用**第一次**加载时调用一次,之后不再调用      | 一次性初始化(如建立全局缓存、只读配置),不应包含会被卸载销毁的东西    |
| `mount`     | 每次进入该应用时调用(含首次)                   | 渲染:创建框架实例并挂到容器;注册全局监听;绑定路由                    |
| `unmount`   | 每次切走 / 卸载时调用                          | **反向清理**:卸载框架实例、移除监听与定时器、清 DOM(漏了会泄漏/串扰) |
| `update`    | 仅 `loadMicroApp` 手动加载场景下可用(见第五节) | 接收主应用发来的更新(props),做增量刷新                               |

```js
// 子应用入口(sub-app/src/index.js)——以 Vue2 为例
let instance = null

function render(props = {}) {
  const { container } = props
  instance = new Vue({
    router,
    store,
    render: (h) => h(App),
  }).$mount(container ? container.querySelector('#app') : '#app')
}

// ① 独立运行时自己启动(没被 qiankun 接管时)
if (!window.__POWERED_BY_QIANKUN__) {
  render()
}

// ② 被 qiankun 接管时,把生命周期交出去
export async function bootstrap() {
  /* 只做一次的事 */
}
export async function mount(props) {
  render(props)
}
export async function unmount() {
  instance?.$destroy()
  instance = null
}
```

几个关键设计,后面所有篇目都建立在这之上:

- **同一份代码、两种环境**:靠 `window.__POWERED_BY_QIANKUN__` 判断自己是"独立跑"还是"被挂载"——开发时子应用照常独立运行(有 HMR),上线后被 qiankun 加载。
- **`props` 是主应用与子应用的唯一握手通道**:固定包含 `name`、`container`(当前挂载容器,供渲染定位);若启用了全局状态,还会注入通信方法(见[通信篇](./communication.md));其余是主应用注册时透传的业务数据。
- **`instance` 要挂在模块外、每次 mount 重建**:保证"反复进入 = 反复挂载/卸载",而不是重复创建导致内存泄漏或渲染叠加。

## 三、注册与启动:主应用把"谁 + 何时 + 挂哪"说清楚

主应用侧只做两件事:**注册** 与 **启动**。

```js
// 主应用入口(main/src/main.js)
import { registerMicroApps, start } from 'qiankun'

registerMicroApps(
  [
    {
      name: 'react-app', // 应用唯一名(勿重名)
      entry: '//localhost:7101', // 子应用入口:一个 URL(HTML Entry,见第 2 篇)
      container: '#subapp-viewport', // 子应用挂到主应用的哪个节点
      activeRule: '/react', // 路由命中该规则 → 激活该应用
      props: { user: currentUser }, // 传给子应用 mount(props) 的业务数据
    },
    {
      name: 'vue-app',
      entry: '//localhost:7102',
      container: '#subapp-viewport',
      activeRule: '/vue',
    },
  ],
  {
    // 全局生命周期钩子:对每个子应用都生效,适合统一打点 / loading 控制
    beforeLoad: () => console.log('before load'),
    beforeMount: () => console.log('before mount'),
    afterMount: () => console.log('after mount'),
    beforeUnmount: () => console.log('before unmount'),
    afterUnmount: () => console.log('after unmount'),
  },
)

start({ prefetch: true }) // 启动应用托管;建议在 registerMicroApps 之后调用
```

### 字段与常见配置

| 维度         | 说明                                                                                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | 应用唯一标识;需与子应用打包产物暴露的名字呼应(见[第 2 篇](./html-entry.md)),不可重复                                                                                                                                 |
| `entry`      | 子应用入口地址;支持 `//host:port`、`http(s)://` 或带路径的 HTML;**dev 时期指到子应用 dev server 即可,顺带保留其 HMR**                                                                                                |
| `activeRule` | 见下节"路由活动";命中即激活                                                                                                                                                                                          |
| `props`      | 业务数据 / 通信通道,透传给子应用 `mount(props)`                                                                                                                                                                      |
| `start()`    | 关键选项:`prefetch`(默认 true,首个子应用挂载完成后空闲预取其余)、`sandbox`(默认开启,见[沙箱篇](./sandbox.md))、`singular`(单实例开关,默认同路由只激活一个应用)、`urlRerouteOnly`、`fetch`(自定义资源拉取,可配鉴权头) |

> 主应用一般也要处理错误兜底:`addErrorHandler((err) => ...)`(single-spa 的错误机制)可统一捕获子应用加载失败、生命周期抛错并上报。**规则是先 register 后 start**,且注册一般在路由就绪前完成,避免首屏跳变。

## 四、activeRule:路由如何"叫醒"子应用

`activeRule` 就是子应用的"闹钟",支持三种写法,命中时 qiankun 自动 `mount`,离开时自动 `unmount`:

```js
activeRule: '/react',                              // 字符串:URL pathname 前缀匹配
activeRule: (location) => location.hash.startsWith('#/react'), // 函数:完全自定义(hash 路由场景常用)
activeRule: ['/react', '/react2'],                 // 数组:多个路径都激活同一应用
```

**路由配合的两个要点**(落地细节见[工程实战篇](./migration.md)):

1. **主应用路由与子应用路由要"各管一段"**:通常约定主应用用自己的路由管"框架页",`activeRule` 只认某个前缀(如 `/react`),该前缀**以下的路径交给子应用内部路由**(react-router 设 `basename`、vue-router 设 `base`,均取该前缀)。
2. **历史路由模式决定刷新是否 404**:子应用用 history 模式时,直接刷新 `/react/foo` 需要服务器把该前缀回退到子应用入口 HTML(部署时要配),否则 404——这是微前端部署里最常见的坑之一。

## 五、手动加载:loadMicroApp 与"多实例 / 嵌入式"

`registerMicroApps` 是**路由驱动**的"插拔式"整页应用;还有一种更灵活的**手动加载** `loadMicroApp`,适合"在页面内嵌一块子应用"或"同页同时存在多个实例":

```js
import { loadMicroApp } from 'qiankun'

// 返回该微应用的控制器实例(它加载完成即自动挂载;可用实例方法手动控制)
const microApp = loadMicroApp(
  { name: 'chart-app', entry: '//localhost:7103', container: '#chart-root', props: {...} },
  { /* 仅作用于该应用的全局钩子 */ }
)
microApp.mount()     // 再次挂载
microApp.unmount()   // 卸载
microApp.update({ newProp: 1 })  // 触发子应用 update 生命周期(仅此场景可用)
```

| 对比       | registerMicroApps(路由插拔)                  | loadMicroApp(手动嵌入式)                               |
| ---------- | -------------------------------------------- | ------------------------------------------------------ |
| 触发方式   | `activeRule` 路由命中自动挂载 / 离开自动卸载 | 代码显式控制 mount / unmount                           |
| 典型场景   | 整页级 :主框架 + 若干整页业务应用            | 页面内嵌组件级微应用、同页多实例、动态开关             |
| 多实例共存 | 单实例为主                                   | **天然支持**(依赖 Proxy 沙箱,见[沙箱篇](./sandbox.md)) |
| 路由归属   | 主应用统一路由管 `activeRule`                | 与主应用路由解耦,完全由业务代码决定何时加载            |

> 单实例 vs 多实例是理解 qiankun 沙箱演进的钥匙:快照沙箱只能"一次一个",Proxy 沙箱才是"各玩各的"(详见[沙箱篇](./sandbox.md))。

## 速查

| 主题          | 一句话记住                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| 核心思想      | 子应用不再自己启动,而是交出 `bootstrap/mount/unmount`,由主应用"插拔"调度                                       |
| 双环境        | `window.__POWERED_BY_QIANKUN__` 区分"独立运行"与"被挂载";独立时自己 render,挂载时导出生命周期                  |
| mount/unmount | mount 负责建(渲染+绑监听),unmount 负责拆(卸载+清监听/定时器)——**一对对称操作,漏一个必出问题**                  |
| 主应用三步    | `registerMicroApps(apps, lifeCycles)` 描述"谁 + 挂哪 + 何时激活" → `start()` 启动托管 → `addErrorHandler` 兜底 |
| activeRule    | 字符串(路径前缀)/ 函数(自定义)/ 数组(多路径);命中即 mount,离开即 unmount                                       |
| loadMicroApp  | 手动加载的"嵌入式 / 多实例"方案;返回控制器实例,可 `mount/unmount/update`;update 仅此场景生效                   |
| props         | 主 ↔ 子唯一握手:固定有 name/container,业务数据 + 通信方法都由它下发                                            |

> 官方文档:qiankun.umijs.org/zh/guide/getting-started、qiankun.umijs.org/zh/api;single-spa.js.org(lifecycle / applications)。下一篇:[HTML Entry:子应用的网页资源如何被加载执行](./html-entry.md)。
