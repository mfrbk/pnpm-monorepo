# qiankun JS 沙箱:拿进来的代码在什么环境里跑

> 本系列第 3 篇:为什么需要沙箱 / 三代实现演进 / Proxy 沙箱原理 / 边界:它挡不住什么。· [← 返回总纲](./README.md)

**微前端最难的从来不是"把多个应用拼在一起",而是"拼在一起后,它们彼此的全局变量不要互相污染"。**

## 一、为什么必须有 JS 沙箱

浏览器里同一时刻只有一个 `window`、一个全局作用域。子应用跑起来会不自觉地:

- 声明全局变量、往 `window.xxx` 挂东西(工具库、SDK、polyfill、缓存);
- 改全局对象(如给 `Array.prototype` 打补丁);
- 挂全局监听(`window.addEventListener`)与定时器。

A、B 两个子应用共享真 `window` 时:

```
路由切到 A:A 挂 window.currentUser、给 Array 打补丁、加了 resize 监听
路由切到 B:B 读到 A 留下的 window.currentUser(串数据)
              B 的行为被 A 的 Array 补丁影响(被串改)
              A 的 resize 监听还在跑(泄漏 / 误触发)
路由切回 A:B 写的全局又残留给 A(双向污染)
```

qiankun 的思路:**给每个子应用一个"假的 window"去玩**,尽量别让脏手碰到真 `window`。目标是"全局变量隔离",**不是** iframe 那种"连 DOM、事件、会话全隔离"(那属于[生态篇](./ecosystem.md)里无界等 iframe 方案的取舍)。

## 二、三代演进:从"拍快照还原"到"Proxy 隔离"

| 沙箱                  | 思路                                         | 是否动真 window | 多实例 | 兼容性       | 现状                     |
| --------------------- | -------------------------------------------- | --------------- | ------ | ------------ | ------------------------ |
| SnapshotSandbox(快照) | 激活时给真 window 拍快照,失活时 diff 还原    | 是(直接改)      | 否     | 最好(IE)     | 无 Proxy 环境降级用      |
| LegacySandbox(补丁)   | 代理 + 记录"运行期新增/修改",失活时逐条还原  | 是              | 否     | 较好         | 历史阶段,已被 Proxy 取代 |
| ProxySandbox(默认)    | 每个子应用一个独立代理上下文,写不落真 window | 否              | **是** | 需 ES6 Proxy | 现役默认                 |

两个演进动机:

1. **快照 / 补丁都是"先污染再还原"**:每次激活失活要遍历、比对、还原,性能差,且天然**只能单实例**(同一时刻只能有一个"脏"状态在还原);
2. **Proxy 把"还原"变成"不用脏"**:写只落在子应用自己的假 window 上,激活/失活只剩一个开关,多实例共存成为可能。

> 现役选择:**环境支持 Proxy → ProxySandbox(默认);不支持(如旧 IE)→ SnapshotSandbox 降级**。这就是 qiankun 文档里"多实例同存"总伴随"需 Proxy 沙箱"的原因。

## 三、ProxySandbox 怎么工作:读回退、写私有

核心一句话:**读——自己有的读自己的,没有的回退真 window;写——只写进自己的私有上下文,绝不落真 window。**

```js
// —— 为便于理解的高度简化示意,非 qiankun 源码 ——
function createProxySandbox() {
  const fakeWindow = Object.create(null) // 每个子应用一份私有"假 window"

  const proxy = new Proxy(fakeWindow, {
    get(target, key) {
      if (key === 'window' || key === 'self' || key === 'globalThis') return proxy // 自我指代
      if (key in target) return target[key] // ① 自己写过的 → 读自己的
      return window[key] // ② 没写过的 → 回退读真全局
    },
    set(target, key, value) {
      target[key] = value // ③ 写 → 只落私有上下文
      return true
    },
    has(target, key) {
      return key in target || key in window
    },
  })

  return proxy
}

// 让子应用代码里所有 window/self/globalThis 都指向这个 proxy
new Function('window', 'self', 'globalThis', code)(proxy, proxy, proxy)
```

qiankun 的真实实现远比上面复杂,读源码时会看到它在处理这些"脏活":

- **`window`、`self`、`globalThis` 三个名字全指向 proxy**,堵住"换名字绕过"的路;
- **方法要绑对 `this`**:真 window 上很多方法(如 `alert`、`addEventListener`)被单独取出调用时会丢 `this`,qiankun 要按需绑定/特判;
- **不可配置 / 危险属性要挡**:`location` 等不能真让你在假 window 里改着玩,有专门白名单/黑名单;
- **Symbol 陷阱**:`Symbol.unscopables`、`Symbol.toStringTag` 等要返回正确形状,否则框架代码会莫名崩。

**效果**:子应用 A 里 `window.__x = 1`,只落在 A 的假 window;切到 B 读 `window.__x` → 没有 → 回退真 window(也没有)→ `undefined`。真 window 全程没被碰过,"激活/失活"真的只剩 `running` 开关。

## 四、边界:能挡什么,挡不住什么

| qiankun 沙箱                        | 说明                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| ✅ **挡 window 写入污染**           | 子应用写全局、挂 window、改全局对象 → 只落在自己假 window,互不影响                                   |
| ✅ **支持多实例同存**               | 每个实例独立上下文,`loadMicroApp` 同页多个子应用互不污染                                             |
| ❌ **不挡 DOM 共享**                | 子应用往 `document.body` append 的节点、挂到 body 的弹层是**真的** → 卸载必须清理,弹层需单独处理     |
| ❌ **不挡全局事件与定时器**         | `window.addEventListener`、`setInterval` 是全局真副作用 → **卸载漏清理 = 泄漏 + 串扰**(见工程篇踩坑) |
| ❌ **不挡样式互相影响**             | 样式走 DOM/head,不在 window 上 → 需要[样式篇](./style-isolation.md)的墙                              |
| ❌ **不挡 storage / cookie / 网络** | localStorage 同源天然共享(登录态),这是特性不是 bug,但要知道它不是被"隔离"的                          |
| ❌ **不挡同源 iframe / 特殊逃逸**   | 子应用真要去搞 `iframe.contentWindow`、`window.open` 拿原生引用,软沙箱拦不干净——这是"软隔离"的天花板 |
| ✅ **读取回退 = 可控的共享通道**    | 子应用能读到真 window(浏览器全局 + 主应用预置),主应用往真 window 挂命名空间即"单向提供能力"          |

由此推出三条实践纪律(工程篇会反复用到):

1. **沙箱管 JS 变量,不管 DOM 与事件**:unmount 要对称清理 DOM、监听、定时器(呼应[模型篇](./model.md)的"mount/unmount 对称");
2. **需要跨应用能力,用 props / 真 window 命名空间显式给**,不要赌沙箱漏;
3. **样式污染不归 JS 沙箱管**,必须叠加[样式篇](./style-isolation.md)的方案。

## 五、配置与使用

```js
// 主应用
start({
  sandbox: true, // 默认开启。显式配对象可开精细项
  // sandbox: false,     // 不推荐:关掉后子应用全局互相污染,仅极特殊(如仅嵌入可信单应用)才考虑
  // sandbox: {
  //   strictStyleIsolation: true,     // 样式隔离选项,见第 4 篇(不在本节)
  //   experimentalStyleIsolation: true,
  //   loose: true,                    // 宽松模式:少拦一些,兼容性更好但隔离更弱
  // },
})
```

- **`sandbox: false`** 意味放弃全局隔离,两个应用共享真 window——只有"只挂一个且来源可信"的场景才可考虑;
- **多实例**:默认 `ProxySandbox` 支持;路由插拔的单实例场景同时兼容快照降级;
- Vite 子应用在沙箱里"跑了但沙箱失效"的特殊情况,见[工程实战篇](./migration.md)。

## 速查

| 主题       | 一句话记住                                                                               |
| ---------- | ---------------------------------------------------------------------------------------- |
| 为什么     | 共享真 window 会串全局变量 / 补丁 / 监听;沙箱 = 隔离墙一(JS 全局)                        |
| 三代       | 快照(拍/还原)→ 补丁(记/还原)→ Proxy(默认,不脏真 window);无 Proxy 环境降级快照            |
| Proxy 原理 | 每个子应用一份假 window:读"自己有→自己,没有→回退真全局",写只落私有;**激活/失活只剩开关** |
| 真实现难点 | window/self/globalThis 统一指 proxy;方法绑 this;location 等危险属性特判;Symbol 陷阱      |
| 边界       | 挡 window 写;不挡 DOM / 事件 / 定时器 / 样式 / storage;读取回退是真窗口,可做受控共享通道 |
| 纪律       | unmount 清 DOM+监听+定时器;跨应用能力走 props/真 window 命名空间;样式污染靠第 4 篇的墙   |

> 官方文档:qiankun.umijs.org/zh/guide/getting-started(沙箱)、qiankun.umijs.org/zh/faq;源码见 github.com/umijs/qiankun 的 `src/sandbox/`。下一篇:[样式隔离:DOM 与样式这堵墙怎么补](./style-isolation.md)。
