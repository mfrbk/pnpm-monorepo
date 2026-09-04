# qiankun 样式隔离:DOM 与样式这堵墙怎么补

> 本系列第 4 篇:样式为什么还会打架 / 约定式 / experimental(Scoped CSS)/ strict(Shadow DOM)/ 组件库弹层。· [← 返回总纲](./README.md)

[沙箱篇](./sandbox.md)管住了 JS 全局,但子应用的 `<style>` 注入的是**同一个 `<head>`、同一个 document**,CSS 是全局级联的——**JS 沙箱管不到样式**。

## 一、问题:单实例也挡不住"样式残留"

同一时刻只挂一个子应用,样式依然会打架:

- 子应用 A 的全局规则(如 `.btn { color: red }`)注入后**不会随卸载自动消失/恢复**——切到主应用页面或子应用 B 时,A 的规则仍在生效;
- 主应用与子应用、多个子应用之间,**同名 class / 标签 / 全局选择器**互相覆盖;
- 现代 UI 库、CSS-in-JS、动态插入样式让"静态约定"更难守住。

核心困难在于:**样式跟随 DOM 走、而 DOM 是共享的**。JS 沙箱可以给每个应用发一个"假 window",样式却没法给每个应用发一个"假 document"——只能从三条路线里选(或组合)。

## 二、三条路线总览

| 路线                         | 手段                                         | 隔离强度 | 侵入性 | 成本 / 局限                               |
| ---------------------------- | -------------------------------------------- | -------- | ------ | ----------------------------------------- |
| **约定式(基础)**             | BEM / CSS Modules / Tailwind 前缀 / 少写全局 | 弱-中    | 改造期 | 依赖人守规矩,兜不住存量与第三方           |
| `experimentalStyleIsolation` | 运行时改写 CSS 选择器,加容器前缀(Scoped)     | 中       | 低     | 实验性;@keyframes/@font-face 等处理不全   |
| `strictStyleIsolation`       | 子应用挂进 **Shadow DOM**,浏览器原生隔离     | **强**   | 高     | 弹层 / 组件库 / 调试适配成本高,不是无脑开 |

**官方默认并不做强隔离**:`sandbox: true` 只保证 JS 隔离。需要样式墙时,由你在 `start()` 里显式打开下面两档之一。**两条路线都自动解决不了"挂到 body 的弹层"**,因为弹层脱离了子应用容器(下文详述)。

## 三、experimentalStyleIsolation:给选择器加"前缀"(Scoped CSS)

开启后,qiankun **运行时改写子应用注入的每一条 CSS**,把选择器限定在子应用容器范围内——思路同 Vue 的 scoped。做法:给子应用容器打上 `data-qiankun="<应用名>"` 属性,再给规则加前缀:

```css
/* 子应用原始规则 */
.layout {
  color: red;
}

/* 改写后:只有该子应用容器内的 .layout 才会命中 */
div[data-qiankun='react-app'] .layout {
  color: red;
}
```

**优点**:不改变 DOM 结构、对组件库兼容相对好、低成本兜底,适合"静态 CSS 冲突"。
**局限**(别当银弹):

- **只改选择器、不改 DOM 挂载位置**:规则命中依赖"元素在子应用容器内";凡挂到 `body` 的弹层(antd Modal/Dropdown、element-plus Dialog/Message 等),前缀匹配不到 → 样式依旧乱;
- **`@keyframes` / `@font-face` / `@import` / `@page` 等规则不会被作用域化**,动画名、字体仍可能全局冲突;
- **动态插入的 style 不一定被治理**;已带 `data-qiankun` 或 body/html/:root 的选择器会跳过;
- 实验性特性,对复杂项目可能"时灵时不灵"。

## 四、strictStyleIsolation:子应用装进 Shadow DOM

开启后,qiankun 给子应用容器套一层 **Shadow DOM**(Shadow Root),把子应用的 DOM 与样式**整个放进去**。浏览器原生保证:**Shadow 内的样式不出去、外面的普通 CSS 也进不来**——强度最高的静态样式隔离。

```js
start({ sandbox: { strictStyleIsolation: true } })
// 结构大致变成:
//   <div id="__qiankun_microapp_wrapper__">
//     #shadow-root
//        <link/ref: 子应用样式、子应用自己的 DOM 树都在这里面>
//   </div>
```

**代价是一串"适配债",开之前务必评估**:

1. **组件库弹层**是头号坑:antd 的 Modal/Select/Dropdown/Tooltip 默认渲染到 `document.body`,**一旦出去就脱离 Shadow**,样式全丢。antd 可用 `ConfigProvider.getPopupContainer` 把弹层指定挂回子应用容器内,但**其他组件库不一定提供该配置**;
2. **依赖全局覆盖 / `document` 查询的库要适配**:`:root`/`body` 上的 CSS 变量进不到 Shadow 内(除非挂在容器);`document.querySelector`、`document.body.style` 等全局操作拿不到 Shadow 内的东西;
3. **框架兼容性问题**:React 18 `createRoot` 挂载到 Shadow 内节点、React 已知的 Shadow DOM issue,都可能要额外处理;
4. **调试与测试变累**:DevTools 要展开 Shadow Root 看真实 DOM;自动化测试选择器需穿透;
5. **性能**:Shadow 边界本身有成本,大规模使用注意。

> 官方口径也是"**Shadow DOM 严格隔离并非无脑可用**",多数场景要接入方配合适配。**它把静态样式挡得最干净,但把"弹层/全局"问题放大**——很多团队反而只在"子应用样式极不可控"时才开它。

## 五、弹层问题与组合建议

弹层是两条框架级路线共同的软肋,根源都一样:**弹层被库默认挂到 `document.body`,脱离"容器 / Shadow / 前缀"的管辖范围**。落地组合建议:

1. **约定式打底(必做)**:子应用样式尽量 scoped(CSS Modules / style 前缀 / UI 库按需),少写全局选择器;这决定"框架兜底失灵时还有没有最后一道防线";
2. **按子应用可控度选框架级隔离**:
   - 静态样式冲突为主、组件库少 → `experimentalStyleIsolation` 低成本兜底;
   - 子应用样式极不可控、且能接受适配债(团队能改弹层挂载点)→ `strictStyleIsolation`;
   - 大量依赖 body 弹层的复杂业务 → 两种都可能力不从心,优先**约定式 + 工程手段**(见下);
3. **给弹层指定归属**:antd 系用 `getPopupContainer={() => container 节点}` / `ConfigProvider`;element-plus 配 `append-to` 之类,尽量让弹层挂回子应用容器内——让隔离方案"闭环";
4. **工程化兜底**:需要更强的"存量无脑隔离"时,用 `postcss-plugin-namespace` 等构建期给整包加命名空间(把 scoped 提前到构建期)。

> 诚实提醒:**微前端的样式问题没有"开个开关就全好"的免费午餐**。选型把"团队能否约束子应用样式规范、能否改组件库弹层挂载点"作为重要前提——这也关系[生态篇](./ecosystem.md)的"要不要上微前端"。

## 速查

| 主题           | 一句话记住                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------ |
| 根因           | 样式跟着共享的 document/head 走,JS 沙箱管不到 → 需要单独的墙                               |
| 默认状态       | qiankun 默认不做强样式隔离(`sandbox:true` 只隔离 JS)                                       |
| experimental   | 运行时给选择器加 `div[data-qiankun=应用]` 前缀;改动小但 @keyframes/动态样式处理不全,实验性 |
| strict         | 子应用装进 Shadow DOM,浏览器原生隔离最强;但弹层/全局/调试适配债高,不是无脑开               |
| 弹层(公共软肋) | 两种方案都管不到挂到 body 的弹层 → 用 `getPopupContainer` 等把弹层挂回子应用容器内         |
| 落地组合       | 约定式打底(必做)+ 按可控度选框架级隔离 + 弹层归位 + 必要时构建期加命名空间                 |

> 官方文档:qiankun.umijs.org/zh/api(start 的 sandbox 配置)、qiankun.umijs.org/zh/faq(样式隔离)。下一篇:[应用间通信:拆开的两个应用怎么说话](./communication.md)。
