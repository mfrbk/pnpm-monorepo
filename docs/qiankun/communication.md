# qiankun 应用间通信

> 本系列第 5 篇:谁和谁通信 / props 静态下传 / initGlobalState(Actions)双向广播 / 事件与存储 / 契约设计。· [← 返回总纲](./README.md)

应用拆开了,数据还得流动。通信的难点不在 API,而在**边界**:**哪些数据该跨应用共享、哪些留在自己手里**——设计错了,拆微前端就退化成"分布式传参地狱"。

## 一、谁在通信、为什么通信

| 通信双方                | 典型内容                                          | 推荐手段                        |
| ----------------------- | ------------------------------------------------- | ------------------------------- |
| 主应用 → 子应用(一次性) | 用户信息、环境配置、路由前缀、API base、主题      | **props**(mount 时下传)         |
| 主应用 ⇄ 子应用(动态)   | 登录态变化、菜单权限、语言/主题切换、页面跳转通知 | **全局状态 Actions**            |
| 子应用 → 主应用         | 改标题、回顶栏、通知主应用某事件                  | Actions 或全局事件              |
| 子应用 ⇄ 子应用         | 一般**不直接**,经由主应用转发 / 共享存储          | Actions(先经主应用)/ 事件       |
| 跨应用持久状态          | 登录 token、用户身份(同源域名下)                  | localStorage / cookie(有意共享) |

两条设计前提(比 API 重要):

1. **尽量少通信**:能留在子应用内部的状态绝不外传;微前端的分工粒度是"整块业务",不是"组件级状态共享";
2. **通信传"事件与轻量状态",不传"大对象与强引用"**:把跨应用共享压到"登录态 / 权限 / 主题 / 语言"这类契约字段,而不是把某个应用的内部 store 塞给别的应用。

## 二、props:一次性"下发配置"的通道

注册 / 加载时透传,子应用在 `mount(props)` 里收。适合"静态、只读、每次进入重新下发"的数据:

```js
// 主应用
registerMicroApps([
  {
    name: 'react-app',
    entry: '//localhost:7101',
    container: '#viewport',
    activeRule: '/react',
    props: {
      user: currentUser, // 进入时拿到的登录态快照
      apiBase: '/api/micro/react', // 环境配置
      basename: '/react', // 供子应用设置内部路由 base
    },
  },
])
```

```js
// 子应用 mount
export async function mount(props) {
  render(props) // props.user / props.apiBase / props.basename 直接用
}
```

**注意**:props 是"下发时的快照",不是响应式的。**用户信息变了要主动再通知**(用全局状态),别指望 props 自动更新。

## 三、全局状态 Actions:主 ⇄ 子双向广播

qiankun 内置一个简单的**发布订阅式全局状态**。主应用创建,子应用通过 props 使用:

```js
// 主应用:初始化全局状态,拿到 actions(建议在入口初始化一次,导出复用)
import { initGlobalState } from 'qiankun'

const actions = initGlobalState({ user: null, theme: 'light' })

actions.onGlobalStateChange((state, prev) => {
  // 主应用自己也能订阅
  console.log('主应用视角:', prev, '→', state)
}, true) // fireImmediately=true:注册后立即触发一次

export { actions }
```

| actions 方法                                      | 说明                                                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `onGlobalStateChange(callback, fireImmediately?)` | 注册监听;回调 `(state, prevState)`;每次 `setGlobalState` 广播时被调用                               |
| `setGlobalState(partialState)`                    | 更新状态并通知所有监听;参数按**一级属性浅合并**;只能更新**已存在**的一级属性(新增 key 被忽略并告警) |
| `offGlobalStateChange()`                          | 注销当前监听(子应用 unmount 时会自动调用,一般不必手动)                                              |

子应用侧两种拿法,效果等价(同一套发布订阅):

```js
// 方式 A:注册时主应用显式把 actions 塞进 props
props.actions.setGlobalState({ theme: 'dark' })

// 方式 B:qiankun 在 initGlobalState 存在时,自动把通信方法并入子应用 props
props.onGlobalStateChange((state, prev) => { /* 消费 */ }, true)
props.setGlobalState({ user: { ... } })
```

```js
// 子应用独立运行(无 qiankun 环境)时的兜底:给通信方法"空实现"占位,
// 等被挂载、真实 props 注入后再替换——保证单独开发时组件不因调空方法而崩
const empty = (..._args) => {
  /* warn: 当前为独立运行 */
}
```

**四个必踩的坑**:

1. **浅合并不是深合并**:`setGlobalState({ user: { name: 'x' } })` 会拿整对象覆盖 `user`,丢掉其它字段 → **嵌套对象要整体替换**(先读旧值再合并);
2. **只能更新已存在的一级 key**:`setGlobalState({ brandNew: 1 })` 无效——初始化时把要用的一级键都先占好位;
3. **监听别注册在路由组件里**:每次切路由重复注册会触发 "listener already exists" 告警,放在应用根部 / 模块级;
4. **子应用里别自己再 `initGlobalState`**:全局状态属于主应用,子应用只消费 props 里下发的通信方法。

> qiankun 3 对 Actions 有重构计划,当前(2.x)用法如上;升级前关注其 API 变更说明。

## 四、其他手段:全局事件、存储、共享 store

- **`CustomEvent`(window 事件)**:适合"一次性通知"(如"去订单页")。跨应用、任意一对多都行,但**无类型、难追踪、易泄漏**——必须加命名空间(如 `mfe:order:open`)并在 unmount 时 `removeEventListener`;
- **localStorage / cookie**:同源域名下天然共享,**适合登录态等必须持久化的状态**(刷新不丢);用 `storage` 事件做跨标签页同步;key 加应用前缀防冲突;
- **共享 store(模块级)**:若某些应用真的要共享一份 React/Vue store 实例,本质是"把 store 当共享模块",与 [Webpack Module Federation](../webpack/module-federation.md) 的 `shared` 同思路——这属于[生态篇](./ecosystem.md)说的"模块级共享",与 qiankun 的 Actions 是两个层次,可叠加使用。

## 五、把它做成"契约"而非"玄学"

多团队协作时,通信最容易变成"谁都往里塞、没人说得清字段"的全局垃圾桶:

- **定义一份状态契约**:字段名、类型、谁写谁读、变更事件语义写成文档(跨仓库共享一份 `.d.ts` 或用 TS 类型导入,见本仓库 [Monorepo 思路](../monorepo.md));
- **收口入口**:子应用不直接 `window.dispatchEvent` 满天飞,在自己内部封装一层 `mfeBus`(内部转调 Actions/事件),业务组件不感知底层;
- **只广播"事件与轻量状态"**:比如广播"登录态变更"这一事件,而不是把整个用户详情对象反复全量下发;
- **API base / 环境配置走 props 注入**:子应用不写死后端地址,由主应用统一注入(便于多环境与灰度)。

## 速查

| 主题       | 一句话记住                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------ |
| 设计前提   | 能不外传就不外传;通信传"事件 + 轻量契约状态",别传大对象/内部 store                               |
| props      | 一次性下发(user/base/配置)于 mount 时到达;**非响应式**,动态变化要另通知                          |
| Actions    | 主应用 `initGlobalState` → 子应用 props 拿 `onGlobalStateChange/setGlobalState`;发布订阅双向广播 |
| Actions 坑 | 浅合并(嵌套整体替换)、只能改已存在一级 key、监听别注册在路由组件、子应用勿重复 init              |
| 事件/存储  | CustomEvent 加命名空间 + 卸载清理;storage 适合登录态持久化(key 加前缀)                           |
| 契约化     | 收口成 bus、定义类型契约、主应用统一注入环境配置——通信要"可查、可控、可清理"                     |

> 官方文档:qiankun.umijs.org/zh/api(initGlobalState)、qiankun.umijs.org/zh/guide(应用间通信 FAQ)。下一篇:[接入与工程实战:把真实项目改造成微前端](./migration.md)。
