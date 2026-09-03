# Changesets 使用规范

本仓库用 Changesets 管理版本,但 CHANGELOG 由 `scripts/release/version.mjs` 自定义生成,
按提交类型自动划分为:💥 Breaking / 🚀 Features / 🐛 Bug Fixes / ⚡ Performance / 📚 Docs & Refactor。

## 如何写一个 changeset

```bash
pnpm changeset
```

交互选择受影响的包与版本级别(minor / patch / major),然后写 summary。**summary 必须以类型前缀开头**,与 Git 提交规范一一对应:

| 前缀                             | 含义               | 对应版本 |
| -------------------------------- | ------------------ | -------- |
| `break:`                         | 破坏性更新         | major    |
| `feat:`                          | 新增功能           | minor    |
| `fix:`                           | bug 修复           | patch    |
| `perf:`                          | 性能优化           | patch    |
| `docs:` / `refactor:` / `chore:` | 文档 / 重构 / 工程 | patch    |

示例:

```markdown
---
'@mzy1120/http': minor
---

feat: 新增请求防重复开关 dedupe,同 key 在途时自动取消旧请求
fix: 修复重复请求完成回调误删新请求取消信号的问题
```

## 发布流程

```bash
pnpm changeset                    # ① 记录变更
git add . && git commit -m "..."  # ② 规范提交(钩子强制)
pnpm run version                  # ③ 更新版本 + 生成分组 CHANGELOG(删除已消费 changeset)
git add . && git commit -m "chore: release vX.Y.Z"
pnpm run release:publish          # ④ 前置校验(lint/build/typecheck)+ 批量发包
```

> ⚠️ 根脚本名为 `version`,但 `pnpm version` 是 pnpm 内建命令(直接改版本号)会被拦截,
> 因此统一用 **`pnpm run version`** 走自定义版本 + 分组 changelog 流程。

- 内部依赖联动:若某上游子包升级,依赖它的下游子包会自动补一个 patch 版本并生成"依赖更新"说明(`updateInternalDependencies: patch`)。当前仓库可发布子包仅 `@mzy1120/http` 且依赖 npm 的 axios,暂无该场景,机制保留给后续新增子包。
- 单包发包 / 企业私有源切换见根目录 README。
