# @mzy1120 前端工具库 Monorepo

基于 **pnpm workspace** 的前端工具库仓库:多个 `@mzy1120/*` 子包**独立版本、独立打包、独立发布**,包间可互相依赖(workspace 协议 + 本地软链联调),统一 ESLint / Prettier / TypeScript / Git 提交规范,由 Changesets 驱动版本并产出按提交类型分组的自定义 CHANGELOG。

## 功能库文档

| 功能库                       | 说明                                                                                                                      | 文档                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `@mzy1120/http` · 请求封装   | 基于 axios 的统一封装(RESTful 语义化方法 / 业务信封解包 / 防重复 / 并发熔断 / 全局取消 / 反馈适配器 / 多实例),零 UI 依赖  | [http-request.md](./docs/http-request.md)           |
| `@mzy1120/http` · 多接口编排 | MultiApiTask / BatchProcessor / DataLoaderService —— 去重、取消后替换、限流并发、整体取消、失败子接口重试与细粒度进度回调 | [http-orchestrator.md](./docs/http-orchestrator.md) |

> 两篇同属已发布子包 `@mzy1120/http`,分别对应其 `src/http/`(请求内核)与 `src/orchestrator/`(多接口编排),由单一入口聚合导出。完整使用文档见 [`docs/`](./docs/)。

## 技术栈

- 包管理:**pnpm workspace**(corepack 锁定);构建:**tsup**(ESM + CJS + d.ts)
- 类型:**TypeScript**(`tooling/tsconfig.base.json` 统一基座)
- 规范:**ESLint flat config** + **Prettier**(共享配置集中在 `tooling/`,子包零配置)
- 提交 / 版本:**Husky + Commitlint**、**Changesets** + 自定义分组 CHANGELOG
- 质量闸门:**lint + typecheck**(按约定不引入测试框架)

## 目录结构

```
├── packages/                 # 可发布子包
│   └── http/                 # @mzy1120/http(http 封装内核 + 多接口编排)
├── docs/                     # 功能库使用文档
├── tooling/                  # 工程共享配置(eslint / prettier / tsconfig)
├── scripts/release/          # 自定义版本 + 分组 changelog
├── .changeset/               # Changesets 配置与团队约定
└── pnpm-workspace.yaml
```

子包统一结构:`src/index.ts` 唯一聚合导出(新增能力 = 新建目录并在 `index.ts` 聚合),按能力分层组织,两层互不 import;仅发布 `dist`。

## 常用命令

```bash
corepack enable              # 首次:启用 pnpm
pnpm install                 # 安装
pnpm run build               # 全量子包打包(esm/cjs/d.ts → dist/)
pnpm run typecheck           # 全量子包 tsc --noEmit
pnpm run lint / format       # ESLint / Prettier
pnpm run preflight           # 发布前置:lint + build + typecheck
pnpm run pack:check          # tarball 内容 dry-run
```

## 版本与发布

> changeset 书写规范见 [.changeset/README](.changeset/README.md);scope 包发布 / npm 组织说明见 [docs/npm-publish.md](docs/npm-publish.md)。

提交类型:`feat` `fix` `perf` `refactor` `docs` `chore` `break`。Changeset 的 summary 以类型前缀开头,`pnpm run version` 据此归类进 CHANGELOG 分组并对应版本:

| 前缀 / bump         | CHANGELOG 分组      | 版本  |
| ------------------- | ------------------- | ----- |
| `break:` · major    | 💥 Breaking Changes | major |
| `feat:` · minor     | 🚀 Features         | minor |
| `fix:`              | 🐛 Bug Fixes        | patch |
| `perf:`             | ⚡ Performance      | patch |
| docs/refactor/chore | 📚 Docs & Refactor  | patch |

发布流程:

```bash
pnpm changeset                  # ① 记录变更(前缀 summary)
git add . && git commit -m "feat: ..."
pnpm run version                # ② 更新版本 + 生成分组 CHANGELOG(非 pnpm 内建 version,勿漏 run)
git add . && git commit -m "chore: release v0.1.0"
pnpm run release:publish        # ③ preflight + 批量发包到当前 registry
```

要点:

- **内部依赖**:包间依赖写作 `"@mzy1120/<pkg>": "workspace:^"`,发布时自动改写为真实 semver(如 `^0.1.0`);`updateInternalDependencies: "patch"` 使上游升版时下游自动补 patch。当前仅 `@mzy1120/http`,其 `axios` 为 npm 运行时依赖。
- **发布范围**:批量走 `pnpm run release:publish`;单包可 `pnpm --filter @mzy1120/http run build && cd packages/http && pnpm publish`。私有源通过 `--registry=<url>` 或 `npm_config_registry=<url>` 临时切换。
- **发包内容**:`files` 仅含 `dist`,`pack:check` 确认 tarball 无源码残留;`sideEffects: false` 可安全摇树。

## 常见问题

- **改了子包代码但消费方不生效**:对外导出类型来自 `dist/`,先 `pnpm run build` 再在消费侧 typecheck。
- **`pnpm version` 行为不对**:请用 `pnpm run version`。
