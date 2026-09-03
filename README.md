# @mzy1120 前端工具库 Monorepo

基于 **pnpm workspace** 的前端工具库仓库:多个 `@mzy1120/*` 子包**独立版本、独立打包、独立发布**,包间可互相依赖(workspace 协议 + 本地软链联调),全工程统一 ESLint / Prettier / TypeScript / Git 提交规范,由 Changesets 驱动版本并产出**按提交类型分组的自定义 CHANGELOG**。

| 子包            | 说明                                                                                                                                                             | 依赖              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `@mzy1120/http` | 请求库:HTTP 内核(RESTful 语义化方法 / 业务信封解包 / 防重复 / 并发熔断 / 反馈适配器)+ 多接口编排层(MultiApiTask / BatchProcessor / DataLoaderService),零 UI 依赖 | `axios`(npm 依赖) |

## 技术栈

- 包管理:**pnpm workspace**(`pnpm@11.25.0`,corepack 锁定)
- 构建:**tsup**(ESM + CJS + d.ts 三产物)
- 类型:**TypeScript 5.9**,`tooling/tsconfig.base.json` 统一基座
- 规范:**ESLint 10 flat config** + **Prettier**(共享配置包集中在 `tooling/`,子包零配置)
- 提交:Husky(pre-commit: lint-staged)+ Commitlint(commit-msg,类型强制)
- 版本 / 发布:**Changesets** + 自定义分组 CHANGELOG(`scripts/release/version.mjs`)
- 质量闸门:**lint + typecheck**(按约定不引入测试框架)

## 目录结构

```
.
├── packages/                 # 可发布子包(packages/*)
│   └── http/                 # @mzy1120/http(http 封装内核 + 多接口编排)
├── tooling/                  # 工程共享配置(不可发布)
│   ├── eslint-config/        # @mzy1120/eslint-config(flat 数组)
│   ├── prettier-config/      # @mzy1120/prettier-config(shareable)
│   └── tsconfig.base.json
├── scripts/release/          # 自定义版本 + 分组 changelog
├── .changeset/               # Changesets 配置与团队约定
├── .husky/                   # git 钩子(pre-commit / commit-msg)
└── pnpm-workspace.yaml
```

每个子包统一结构:`src/index.ts`(唯一聚合导出,禁止跨层级内部 import),源码按能力分层组织
(新增能力 = 在 `src/` 下新建目录并在 `index.ts` 聚合)。以 `@mzy1120/http` 为例:
`src/http/`(方法一:封装 axios 请求)+ `src/orchestrator/`(方法二:批量处理请求),两层不互相 import;
`tsconfig.json` extends 基座;`tsup.config.ts` 双格式打包;`package.json` 仅发布 `dist`。

### @mzy1120/http 快速接入

```ts
import http, { createHttpClient } from '@mzy1120/http'

// ① 注入 UI 反馈适配器(库内零 UI 依赖;示例为 antd,ElementPlus 的 ElMessage 同理)
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

// ② 默认以 { code, message, data } 为业务信封,code === 200 时直接 resolve data;
//    泛型 T 直达后端载荷,免去每处手动 res.data 解包。
const user = await http.get<User>('/users/123', { verbose: true })
await http.post<User>('/users', { name: 'mfr' })

// ③ 需要隔离(不同 baseURL / token)时创建独立实例
const adminHttp = createHttpClient({ baseURL: '/admin-api' })

// ④ 进阶能力:防重复提交 / 并发熔断 / 全局取消
http.configure({ dedupe: true }) // 同 key 在途时取消旧请求
const [a, b] = await http.all([
  { method: 'get', url: '/a' },
  { method: 'get', url: '/b' },
])
http.abortAll() // 取消当前全部在途请求
```

> UI 反馈、token、401 登出均为适配器,不内置任何 UI 库;不注入 message 时错误会兜底 `console.error`,绝不静默吞错。

### @mzy1120/http 多接口编排

编排层(MultiApiTask / BatchProcessor / DataLoaderService)与传输、UI 完全无关:每条数据要拉
多个子接口时,把每个子接口封装成一个 `{ key, fetcher }` 配置,`fetcher(info, signal)` 返回
`Promise`,内部可用上文的 `http.get` 等实现。`DataLoaderService` 负责按 id 去重、取消后替换、
限流并发;每个子接口结算都会触发一次 `onUpdate`,UI 可据此做细粒度进度展示与失败重试。

```ts
import { DataLoaderService, TaskStatus, SubApiStatus } from '@mzy1120/http'
import type { DataItemViewModel } from '@mzy1120/http'

// 一行订单需要拼装多个接口:库存、价格、备注
interface OrderInfo {
  id: string
}
interface OrderVm {
  stock: number
  price: { amount: number; currency: string }
  remark: { note: string; updatedAt: number }
}

const loader = new DataLoaderService<OrderVm, OrderInfo>(5) // 并发上限 5 条数据

const loadOrders = (
  orders: OrderInfo[],
  render: (vm: DataItemViewModel<OrderVm, OrderInfo>) => void,
) =>
  loader.load(
    orders.map((info) => ({ id: info.id, info })), // load 按 id 去重,重复 load 会先取消旧任务
    (info) => [
      // 信封解包已就位:http.get<T> 直接 resolve 业务载荷;signal 支持随任务整体取消而 abort
      {
        key: 'stock',
        fetcher: (info, signal) => http.get<number>(`/orders/${info.id}/stock`, {}, { signal }),
      },
      {
        key: 'price',
        fetcher: (info, signal) =>
          http.get<{ amount: number; currency: string }>(
            `/orders/${info.id}/price`,
            {},
            { signal },
          ),
      },
      {
        key: 'remark',
        fetcher: (info, signal) =>
          http.get<{ note: string; updatedAt: number }>(
            `/orders/${info.id}/remark`,
            {},
            { signal },
          ),
      },
    ],
    (vm) => {
      // 每个子接口结算即回调一次:vm.status / vm.progress / vm.subStates / vm.data
      render(vm)
      if (vm.status === TaskStatus.PARTIAL_SUCCESS) {
        // 只重试失败的那个子接口(fire-and-forget),已成功的接口不重复请求
        Object.values(vm.subStates)
          .filter((s) => s.status === SubApiStatus.ERROR)
          .forEach((s) => loader.retrySubApi(vm.id, s.key))
      }
    },
  )

loadOrders([{ id: 'o1' }, { id: 'o2' }], updateRowView) // 逐条数据、逐子接口推进 UI
// 组件卸载时: loader.destroy() —— 取消全部在途请求并清空注册表
```

## 环境与常用命令

```bash
corepack enable                                # 首次:启用 pnpm(自动读取 packageManager)
pnpm install                                   # 安装(含 esbuild postinstall)
pnpm run build                                 # 全量子包打包(esm/cjs/d.ts → dist/)
pnpm run typecheck                             # 全量子包 tsc --noEmit
pnpm run lint / lint:fix                       # ESLint(flat config)
pnpm run format / format:check                 # Prettier
pnpm run preflight                             # 发布前置:lint + build + typecheck
pnpm run pack:check                            # tarball 内容 dry-run(应仅含 dist + package.json)
```

## 版本与发布

### 提交规范(Commitlint 强制)

类型枚举:`feat` `fix` `perf` `refactor` `docs` `chore` `break`(`break` 表示破坏性)。

### Changeset 书写与分组 CHANGELOG

每个 changeset 的 summary 以类型前缀开头,`pnpm run version` 会据此把变更归类进固定的五个模块并 prepend 到各包 `CHANGELOG.md`:

| 前缀                             | CHANGELOG 分组                 | 对应版本 |
| -------------------------------- | ------------------------------ | -------- |
| `break:` 或 bump = major         | 💥 Breaking Changes 破坏性更新 | major    |
| `feat:` 或 bump = minor          | 🚀 Features 新功能             | minor    |
| `fix:`                           | 🐛 Bug Fixes 问题修复          | patch    |
| `perf:`                          | ⚡ Performance 性能优化        | patch    |
| `docs:` / `refactor:` / `chore:` | 📚 Docs & Refactor 文档与重构  | patch    |

完整发布流程:

```bash
pnpm changeset                    # ① 记录变更(选包 + 版本级别 + 写前缀 summary)
git add . && git commit -m "feat: ..."   # ② 规范提交
pnpm run version                  # ③ 更新各包版本 + 生成分组 CHANGELOG,消费 changeset
git add . && git commit -m "chore: release v0.1.0"
pnpm run release:publish          # ④ preflight(lint/build/typecheck)+ 批量发包到当前 registry
```

> ⚠️ 根脚本名为 `version`,而 `pnpm version` 是 pnpm 内建命令(直接改号)会被拦截,
> 故统一使用 **`pnpm run version`**。若确需走 Changesets 默认行为(不带自定义 changelog),可用 `pnpm run version:default`。

### 内部依赖联动

当前可发布子包仅有 `@mzy1120/http`,其 `axios` 是 **npm 运行时依赖**(非 workspace 内部依赖),
暂无包间 workspace 依赖。内部依赖机制仍保留给后续新增子包:

- 包间依赖写作 `"@mzy1120/<pkg>": "workspace:^"`,本地开发通过软链直达源码;
- `updateInternalDependencies: "patch"` 使上游升版时,下游自动补一个 patch 版本,其 CHANGELOG 生成「⬆️ 依赖更新」块
  (发布产物中展示真实 semver,如 `@mzy1120/<上游包>@^0.1.0`)。

**workspace 协议说明**:仓库内依赖始终写作 `workspace:^`(保证本地开发永远链接本地包);发布时由 pnpm
在打包阶段自动改写为真实 semver(实测 `workspace:^` → `^0.1.0`),发布产物不含任何 `workspace:` 残留。

### 发布范围 / 目标源

- **批量发布(推荐,经 `changeset publish`,pnpm 检测后走 `pnpm publish`,自动改写 workspace 协议)**:
  `pnpm run release:publish`
- **单包发布**:先完成 ③ 版本提交,再单独发一个包:
  ```bash
  pnpm --filter @mzy1120/http run build
  cd packages/http && pnpm publish --registry=<registry>
  ```
- **企业私有源**(临时切换,勿长期写入 `.npmrc`):
  - 方式一:命令追加 `--registry=https://your-registry.example.com`
  - 方式二:环境变量注入(对 changeset/pnpm publish 均生效):
    `npm_config_registry=https://your-registry.example.com pnpm run release:publish`
  - 私有源通常还需认证 token,参考对应制品库(Verdaccio / Nexus / JFrog)配置,亦可为私有源单独写 `.npmrc` 并提交忽略。

### 发包内容核对

`files` 仅含 `dist`,`pnpm run pack:check` 会 dry-run 列出 tarball 内容,确认只包含
`dist/*`(js/cjs/map/d.ts/d.cts)与 `package.json`,不含 `src` / `tsconfig` 等源码。所有包 `sideEffects: false`,可安全被摇树。

## 常见问题

- **改了子包代码但被依赖方不生效**:workspace 协议指向软链,但对外导出类型来自 `dist/`,先 `pnpm run build` 再在消费侧 typecheck。
- **`pnpm version` 行为不对**:请改用 `pnpm run version`(见上)。
