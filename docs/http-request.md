# @mzy1120/http · 请求封装(HTTP 内核)

> 基于 axios 的 RESTful 语义化请求封装(内核):默认解包 `{ code, message, data }` 业务信封、泛型直达后端载荷;支持防重复提交、批量并发熔断、全局取消。UI 提示 / loading / token / 401 登出一律以**反馈适配器**注入,**零 UI 依赖**,宿主一行接入 antd / ElementPlus。另一能力见 [多接口编排](./http-orchestrator.md)。· [← 返回 docs 索引](./README.md)

- 依赖:`axios`(npm 运行时依赖,安装时自动带上)
- 入口导出:默认全局单例 `http`,以及 `createHttpClient()` 与相关类型

## 安装

```bash
pnpm add @mzy1120/http   # Node >= 18.17
```

默认全局单例 `http` 适合大多数项目;需要隔离(不同 baseURL / token)时用 `createHttpClient()`。

## 快速接入

```ts
import http, { createHttpClient } from '@mzy1120/http'

// ① 注入 UI 反馈适配器(库内零 UI 依赖;示例 antd,ElementPlus 同理)
http.setFeedback({
  message: {
    error: (t) => message.error(t),
    success: (t) => message.success(t),
    warning: (t) => message.warning(t),
  },
  loading: { show: () => messageLoading.show(), hide: () => messageLoading.hide() },
  getToken: () => localStorage.getItem('access_token'),
  onUnauthorized: () => {
    /* 清 token 并跳登录页 */
  },
})

// ② 默认以 { code, message, data } 为信封,code === 200 直接 resolve data;泛型直达载荷,免手写 res.data
const user = await http.get<User>('/users/123')
await http.post<User>('/users', { name: 'mfr' })

// ③ 需要隔离时创建独立实例
const adminHttp = createHttpClient({ baseURL: '/admin-api' })

// ④ 进阶:防重复提交 / 并发熔断 / 全局取消
http.configure({ dedupe: true }) // 同 key 在途时取消旧请求
const [a, b] = await http.all([
  { method: 'get', url: '/a' },
  { method: 'get', url: '/b' },
])
http.abortAll() // 取消当前全部在途请求
```

> UI 反馈、token、401 登出均为适配器;不注入 message 时错误兜底 `console.error`,不静默吞错。

## 方法一览

| 方法                     | 签名                                            | 说明                                          |
| ------------------------ | ----------------------------------------------- | --------------------------------------------- |
| `get` / `delete`         | `(url, params?, config?)`                       | 参数走 query                                  |
| `post` / `put` / `patch` | `(url, data?, config?)`                         | 载荷走 body                                   |
| `upload`                 | `(url, file: Blob, config?)`                    | 自动包 `FormData`(`field` / `filename` 可配)  |
| `download`               | `(url, params?, config?)`                       | 二进制流,resolve `Blob`                       |
| `all`                    | `(requests: HttpRequestConfig[]): Promise<T[]>` | 批量并发,**熔断**:任一失败即取消其余并 reject |
| `abortAll`               | `(reason?)`                                     | 取消当前全部在途请求                          |
| `request`                | `(config)`                                      | 底层统一入口,axios-like config                |
| `setFeedback`            | `(partial)`                                     | 注入 / 更新反馈适配器                         |
| `configure`              | `(partial)`                                     | 运行时改配置(见下)                            |

> 语义化方法末位 `config` 透传底层 axios 配置;本库另认 `hideLoading` / `dedupe` 两个开关(见下),并支持 `signal`,可与外部取消信号(如编排层的整体取消)联动。

## 配置要点

`createHttpClient(options)` 与 `http.configure(partial)` 均可配置:

- `envelope` — 信封解包规则(默认 `{ code, message, data }`,`code === 200` 成功直接 resolve data)
- `dedupe` — 防重复:同 key 请求在途时取消旧请求
- `showLoading` — loading 总开关(需先经 `setFeedback` 注入 `loading`)
- `auth` — 鉴权方案(header 名 / scheme),配合 `feedback.getToken`
- `feedback` — 反馈适配器,与 `setFeedback` 等价
- 其余透传为 axios 运行时配置(`baseURL` / `timeout` / headers 等)

`showLoading` / `dedupe` 均为客户端级默认;**单次请求**用末位 config 逐次覆盖:`{ hideLoading: true }` 关掉本次 loading、`{ dedupe: true }` 开启本次防重复。

`http.setFeedback(partial)` 只改适配器,便于运行期切换 message / token 实现。
