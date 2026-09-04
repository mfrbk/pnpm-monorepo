# Husky + Changesets · 提交质量与版本发布

> 提交质量与版本发布:两个工具**定位不同、互补使用、不做直接集成**——Husky 管 Git Hooks(commit 时自动检查),Changesets 管版本与 CHANGELOG(发布前统一升版)。changeset 书写与分组规则见 [.changeset/README](../.changeset/README.md)。· [← 返回 docs 索引](./README.md)

## 一、分工一览

| 环节            | 工具                             | 作用                                     |
| --------------- | -------------------------------- | ---------------------------------------- |
| `git commit` 前 | Husky `pre-commit` + lint-staged | 对暂存文件跑 `eslint --fix` / `prettier` |
| `git commit` 时 | Husky `commit-msg` + commitlint  | 校验 message 类型(feat / fix / …)        |
| 开发完成        | Changesets                       | `pnpm changeset` 记录本次变更            |
| 准备发布        | Changesets                       | 升版本 + 生成分组 CHANGELOG + 发包       |

## 二、Husky:提交时的自动检查

本仓库已配好(husky@9),钩子文件在 `.husky/`,安装依赖后 `prepare`(`"prepare": "husky"`)自动激活钩子,无需手动干预。

**pre-commit → lint-staged**:只处理暂存文件,格式 + 修复:

```bash
# .husky/pre-commit
pnpm exec lint-staged
```

```jsonc
// 根 package.json
"lint-staged": {
  "*.{ts,js,cjs,mjs}": ["eslint --fix", "prettier --write"],
  "*.{json,md,yml,yaml}": ["prettier --write"]
}
```

**commit-msg → commitlint**:校验提交信息类型必须取自枚举:

```bash
# .husky/commit-msg
pnpm exec commitlint --edit "$1"
```

```js
// commitlint.config.js —— 类型与 Changesets 分组语义一一对应
rules: { 'type-enum': [2, 'always', ['feat', 'fix', 'perf', 'refactor', 'docs', 'chore', 'break']] }
```

> 新增钩子:`pnpm exec husky add .husky/<hook> "<命令>"`(如 `commit-msg`、`pre-push`)。

## 三、Changesets:版本与 CHANGELOG

```bash
pnpm changeset       # ① 交互:选受影响子包 → 级别(major/minor/patch)→ 写 summary
pnpm run version     # ② 升级版本 + 生成分组 CHANGELOG + 删除已消费 changeset
pnpm run release:publish   # ③ preflight(lint+build+typecheck)+ changeset publish 批量发包
```

- ① 在 `.changeset/` 生成一个 markdown 记录;summary **必须以类型前缀开头**,`pnpm run version` 据此把变更归类进固定的 CHANGELOG 分组(💥 Breaking / 🚀 Features / 🐛 Bug Fixes / ⚡ Performance / 📚 Docs & Refactor),见 [.changeset/README](../.changeset/README.md)。
- ② `version` 是**根脚本**(`scripts/release/version.mjs` 自定义生成 changelog),务必用 `pnpm run version` —— `pnpm version` 是 pnpm 内建命令会被拦截。
- ③ 默认发到当前 registry;单包子包先手动构建再发:
  ```bash
  pnpm --filter @mzy1120/http run build
  cd packages/http && pnpm publish
  ```

## 四、一次完整迭代

```bash
# 1. 写代码 → 提交(触发 Husky 质量检查)
git add .
git commit -m "feat: 新增 xxx"        # lint-staged 修复暂存文件;commitlint 校验类型

# 2. 记录变更(类型前缀写进 summary)
pnpm changeset                         # 选 @mzy1120/http + minor + "feat: 新增 xxx"
git add . && git commit -m "chore: add changeset"

# 3. 发版
pnpm run version                       # 升版本 + 生成分组 CHANGELOG
git add . && git commit -m "chore: release v0.1.0"
pnpm run release:publish               # 质量闸门通过后批量发布
```

> 单仓库同样适用:变化只有一处 —— Changesets 只面向"包"的版本,单仓库可视为单个"包"记录。
