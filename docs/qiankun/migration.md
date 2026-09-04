# qiankun 接入与工程实战

> 本系列第 6 篇:主应用侧改造 / 子应用侧(webpack 双模式)/ Vite 子应用特例 / 公共依赖 / 部署 / 高频踩坑清单。· [← 返回总纲](./README.md)

把一个真实工程改造成 qiankun 微前端。核心心法:**让每个应用"单独能跑、合体能挂"**,一切改造围绕这个双模式展开。

## 一、整体改造清单

```
① 主应用当"壳":注册 + 路由驱动 + 布局容器 + 全局状态 + 错误兜底
② 子应用双模式:独立运行(开发/HMR) ⇄ 被 qiankun 挂载(上线)
③ 链路配套:开发联调(跨域)→ 构建产物(UMD/公共依赖)→ 部署(Nginx/资源路径)→ 监控
```

## 二、主应用侧:注册、启动与布局

```js
// 主应用 main.js(以 history 路由为例)
import { registerMicroApps, start, initGlobalState } from 'qiankun'
import { actions } from './actions' // 见通信篇:initGlobalState 初始化 + 导出

registerMicroApps([
  {
    name: 'react-app',
    entry: '//localhost:7101',
    container: '#subapp-viewport',
    activeRule: '/react',
    props: { apiBase: '/api/react', user: currentUser, actions },
  },
  {
    name: 'vue-app',
    entry: '//localhost:7102',
    container: '#subapp-viewport',
    activeRule: '/vue',
    props: { apiBase: '/api/vue' },
  },
])

start({ prefetch: true })

// 布局:主应用提供顶栏/侧栏/登录框架,#subapp-viewport 作为子应用的"插槽"
// 主应用自身路由负责 /、/home 等框架页;不要把主应用路由与子应用 activeRule 前缀搞冲突
```

要点:

- **activeRule 前缀要"整段让渡"给子应用**:主应用别再注册 `/react/*` 自己的页面,那段 URL 属于子应用内部路由(子应用再设 `basename: '/react'`);
- **子应用之间跳转** = 普通路由跳转(`router.push('/vue/...')`),由主应用路由系统统一驱动;
- **错误兜底**:`addErrorHandler` 捕获加载失败/生命周期抛错,统一提示与上报。

## 三、子应用侧(webpack 典型工程):同一份代码,两种活法

以 React + webpack5 为例,拆成三步(其它框架同理)。

### ① 资源路径:public-path.js(必须入口第一行)

```js
// src/public-path.js
if (window.__POWERED_BY_QIANKUN__) {
  __webpack_public_path__ = window.__INJECTED_PUBLIC_PATH_BY_QIANKUN__
}
```

并在 `package.json` 里保它不被摇树:

```json
{ "sideEffects": ["./src/public-path.js"] }
```

### ② 入口:独立运行 + 导出生命周期

```js
// src/index.js(在 public-path 之后 import)
let root = null

function render(props = {}) {
  const { container } = props
  const dom = container ? container.querySelector('#root') : document.querySelector('#root')
  root = createRoot(dom)
  root.render(
    <App basename={props.basename} />, // 子应用内路由 basename = activeRule 前缀
  )
}

if (!window.__POWERED_BY_QIANKUN__) {
  render() // 独立运行:自己启动(HMR 生效)
}

export async function bootstrap() {}
export async function mount(props) {
  render(props)
} // 被挂载:交出去
export async function unmount(props) {
  root?.unmount() // 对称清理!不然重复挂载/泄漏
  root = null
}
```

### ③ webpack 产物:UMD + 唯一 chunk 全局名

```js
// webpack.config.js
output: {
  library: `${pkg.name}-[name]`,   // 暴露名,如 my-react-app-main
  libraryTarget: 'umd',             // qiankun 靠它捕获生命周期(见第 2 篇)
  chunkLoadingGlobal: `webpackJsonp_${pkg.name}`, // webpack5;webpack4 为 jsonpFunction
  globalObject: 'window',
},
devServer: {
  headers: { 'Access-Control-Allow-Origin': '*' }, // 主应用是跨域 fetch 子应用资源!
},
```

> 三个必查项:**umd library**(否则"找不到生命周期")、**chunkLoadingGlobal 唯一**(多个 webpack 应用共存,重名互相覆盖导致 chunk 加载错乱)、**devServer 开 CORS**(否则主应用 fetch 子应用 HTML/JS 被浏览器拦)。

## 四、Vite 子应用:为什么适配难、怎么办

根因都在[第 2 篇](./html-entry.md)的产物要求上:

| Vite 的"天然设定"                        | 与 qiankun 的冲突                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| dev 用原生 ESM(`<script type="module">`) | qiankun 沙箱用 `fetch + eval/new Function` 跑脚本,**不能执行 module 脚本** |
| 模块自带独立顶层作用域                   | 访问到的是**真 window** 而非沙箱代理 → JS 隔离在 dev 下失效                |
| 动态 `import()`                          | 被加载的模块会**逃出沙箱**,运行在真 window 下                              |
| 入口是 `index.html`,主入口导出常被摇树   | `main.ts` 导出的生命周期被 tree-shaking 删掉 → **挂载后白屏无报错**        |
| 无 `__webpack_public_path__`             | 异步资源 / 相对路径在运行时拿不到正确 base → 404                           |

可行的三条路(按推荐度):

1. **换"兼容 Vite 的方案"最省心**:若子应用 / 新项目是 Vite,优先考虑 micro-app / 无界等对 ESM 更友好的方案(对比见[生态篇](./ecosystem.md))或 Webpack 生态的 Module Federation——**qiankun 的 HTML-Entry 模型与 Vite 的 ESM 模型天生拧着**;
2. **坚持 qiankun + Vite 时**:引入社区插件(`vite-plugin-qiankun-lite` / `vite-plugin-qiankun-x` 等),它们在 dev 下桥接 qiankun 的 `window` 代理(暴露 `qiankunWindow`/自动替换)、修 `index.html` 入口与 `preserveEntrySignatures` 摇树、运行时 publicPath(`fixCssLink` / `vite-plugin-dynamic-base`)——但**要接受降级**:JS 沙箱在 dev/动态 import 下不完整、样式隔离在严格沙箱下可能失效,需子应用用 CSS Modules / 前缀约束样式;
3. **降级沙箱配置**:`start({ sandbox: { loose: true } })` 可避开部分"严格沙箱 + Vite 动态样式"的 bug,代价是隔离更弱——**慎用**,尤其子应用来源不可全信时。

> 结论:**存量 webpack 中后台接入 qiankun 很顺;全新项目若主打 Vite,把"是否兼容 qiankun"写进选型表**(详见[生态篇](./ecosystem.md))。

## 五、公共依赖、首屏性能与部署

### 公共依赖怎么共享

三个子应用各自打包一份 React/Vue,体积与内存都重复。按团队阶段选:

| 方案                              | 做法                                                                                         | 适用                         |
| --------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------- |
| 接受重复(最省事)                  | 各子应用照常自带框架                                                                         | 子应用少 / 体量小 / 快速起步 |
| externals + 主应用注入全局        | 子应用把 `react` 配 externals;主应用把 React 挂到 `window.React`(或由主应用先加载 React CDN) | 想明显减重、能统一框架版本   |
| **Module Federation 的 `shared`** | 依赖运行时共享 + 版本协商(qiankun 可叠加使用)                                                | 团队已 webpack5、要精细共享  |

> 模块级共享的完整机制见 [Webpack Module Federation 学习笔记](../webpack/module-federation.md)——它和 qiankun(页面级集成)不冲突,**业界常见组合是"qiankun 管应用、MF 管公共依赖"**。

### 首屏与性能

- `start({ prefetch: true })` 预取未激活子应用静态资源(首个挂载后空闲进行);
- 子应用自身照常做代码分割(hash 命名便于缓存);大依赖尽量延后 / 按需;
- 首屏只挂"默认子应用",其余靠路由懒激活;子应用资源走 CDN 并把 `publicPath` 指到 CDN。

### 部署(最容易翻车的一环)

- **每个子应用是独立静态站点**:可独立域名,也可主应用域下的子路径;生产上主应用 fetch 子应用资源同样要 CORS(同域子路径则天然同源);
- **history 路由刷新 404**:`/react/foo` 直刷时,服务器要把该子应用的路径回退到**它自己的 index.html**——Nginx 按子应用前缀分别 `try_files ... /index.html`(主应用同样配主前缀回退);
- **发版联动**:子应用独立发版后,主应用下一次进入才拉到新版本(HTML 不缓存);要"灰度某子应用"可让主应用按用户/开关决定 `entry` 指向哪个版本。

## 六、高频踩坑清单

| 症状                                     | 根因与对策                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| "找不到生命周期 / 应用加载报错"          | 子应用没配 `libraryTarget:'umd'` 或生命周期没从入口导出 → 补 webpack output + export                |
| 异步 chunk 加载错乱 / 覆盖               | 多个 webpack 应用的 `chunkLoadingGlobal`(jsonpFunction)重名 → 全局唯一化                            |
| 子应用资源 404                           | publicPath 没接管(`__INJECTED_PUBLIC_PATH_BY_QIANKUN__`)或 public-path.js 被摇树 → sideEffects 声明 |
| 切走再切回,页面叠加 / 报 root 已存在     | unmount 没卸载框架实例(React 没 `root.unmount()`)→ mount/unmount 对称清理                           |
| 监听重复触发 / 内存泄漏                  | 全局事件、定时器在 unmount 没 remove(沙箱不背锅,见[沙箱篇](./sandbox.md))                           |
| 切回主应用页面,样式被污染 / 残留         | 没做样式隔离 → 按[样式篇](./style-isolation.md)约定式打底 + 视需要开框架级隔离                      |
| antd Modal / Dropdown 样式丢失或错位     | 弹层挂到 body 脱离了子应用容器 → `getPopupContainer` 指回容器,或改为不依赖 body 的渲染方式          |
| Vite 子应用白屏 / dev 沙箱失效           | 见第四节:产物 ESM 与 qiankun 模型冲突 → 走兼容方案或接受降级                                        |
| 子应用间全局变量串(关了沙箱才出现)       | 别关 `sandbox`;需要共享走 props / 真 window 命名空间(见[通信篇](./communication.md))                |
| `window.__POWERED_BY_QIANKUN__` 时好时坏 | 该标志是"被加载"信号,独立运行判断用它没错;若同时手动 new 了 qiankun 容器要注意执行顺序              |

## 速查

| 主题       | 一句话记住                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| 双模式     | `window.__POWERED_BY_QIANKUN__`:独立 → 自己 render(保 HMR);被挂载 → 导出 bootstrap/mount/unmount        |
| 子应用产物 | `libraryTarget:'umd'` + 入口导出生命周期 + `chunkLoadingGlobal` 唯一 + `public-path.js`(配 sideEffects) |
| dev 联调   | 子应用 devServer 开 CORS;`entry` 直接指 dev server → 保留 HMR                                           |
| Vite       | 与 qiankun 的 eval+UMD 模型冲突;新 Vite 项目优先考虑兼容方案或 MF,硬接要接受沙箱/样式降级               |
| 公共依赖   | 重复 → externals 注入 → **MF shared**;与 qiankun"应用层"可叠加                                          |
| 部署       | 每子应用独立静态站点;history 直刷按前缀 try_files 回退;HTML 别缓存,子应用独立发版/灰度                  |
| 清理对称   | mount 建什么,unmount 拆什么(实例/DOM/监听/定时器)——本系列所有边界问题大多源自这句没做到                 |

> 官方文档:qiankun.umijs.org/zh/guide(getting-started)、qiankun.umijs.org/zh/faq;Vite 适配参见 vite-plugin-qiankun-lite / vite-plugin-qiankun-x 文档。下一篇:[生态对比与选型:该不该用、用哪个](./ecosystem.md)。
