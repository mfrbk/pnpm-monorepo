# @mfr 前端工具库 Monorepo

基于 **pnpm workspace** 的前端工具库仓库:多个 `@mfr/*` 子包**独立版本、独立打包、独立发布**,包间可互相依赖(workspace 协议 + 本地软链联调),全工程统一 ESLint / Prettier / TypeScript / Git 提交规范,由 Changesets 驱动版本并产出**按提交类型分组的自定义 CHANGELOG**。

| 子包             | 说明                                                               | 内部依赖     |
| ---------------- | ------------------------------------------------------------------ | ------------ |
| `@mfr/utils`     | 通用方法库(函数式 / 克隆 / 数组 / 对象 / 字符串 / 数字 / 类型判断) | —            |
| `@mfr/validator` | 校验库(表单校验 / 正则校验 / 参数与业务规则校验)                   | `@mfr/utils` |
| `@mfr/date`      | 日期库(格式化 / 计算 / 差值 / 相对时间 / 时区,纯 Intl 无依赖)      | —            |

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
│   ├── utils/                # @mfr/utils
│   ├── validator/            # @mfr/validator
│   └── date/                 # @mfr/date
├── tooling/                  # 工程共享配置(不可发布)
│   ├── eslint-config/        # @mfr/eslint-config(flat 数组)
│   ├── prettier-config/      # @mfr/prettier-config(shareable)
│   └── tsconfig.base.json
├── scripts/release/          # 自定义版本 + 分组 changelog
├── .changeset/               # Changesets 配置与团队约定
├── .husky/                   # git 钩子(pre-commit / commit-msg)
└── pnpm-workspace.yaml
```

每个子包统一结构:`src/index.ts`(唯一聚合导出,禁止跨层级内部 import)+ `src/modules/` 按功能拆分;
`tsconfig.json` extends 基座;`tsup.config.ts` 双格式打包;`package.json` 仅发布 `dist`。

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

`@mfr/validator` 通过 `"@mfr/utils": "workspace:^"` 依赖 `@mfr/utils`(workspace 协议,本地软链直达源码)。
`updateInternalDependencies: "patch"` 使上游升版时,下游自动补一个 patch 版本,其 CHANGELOG 生成「⬆️ 依赖更新」块
(展示发布后的真实范围,如 `@mfr/utils@^0.1.0`)。

**workspace 协议说明**:仓库内依赖始终写作 `workspace:^`(保证本地开发永远链接本地包);发布时由 pnpm
在打包阶段自动改写为真实 semver(实测 `workspace:^` → `^0.1.0`),发布产物不含任何 `workspace:` 残留。

### 发布范围 / 目标源

- **批量发布(推荐,经 `changeset publish`,pnpm 检测后走 `pnpm publish`,自动改写 workspace 协议)**:
  `pnpm run release:publish`
- **单包发布**:先完成 ③ 版本提交,再单独发一个包:
  ```bash
  pnpm --filter @mfr/date run build
  cd packages/date && pnpm publish --registry=<registry>
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
