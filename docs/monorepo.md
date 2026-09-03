# pnpm Monorepo 使用手册

> [← 返回主 README](../README.md)
> 本文是 **pnpm workspace** 的通用速查(不绑定某个具体仓库);本仓库的实际脚本 / 发布落地见 README 与 [husky-changesets](./husky-changesets.md)。

一个 Git 仓库管理多个子包:各自独立 `package.json`、可独立发版,共享同一套工程规范。好处是配置复用、跨包改动一次提交、本地联调不用先发版。

## 一、最小结构

```
├── apps/                 # 应用(可选)
├── packages/             # 库 / 业务包(可发布)
│   └── ui/
│       ├── package.json
│       └── src/
├── tooling/              # 共享配置(private,不发布)
├── pnpm-workspace.yaml   # 工作区声明(核心)
├── package.json          # 根:private: true,公共脚本 + 共享 devDeps
└── pnpm-lock.yaml        # 全仓单一锁文件,保证依赖一致
```

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'tooling/*'
```

- 新增子包目录 → 建包 → 若目录不在 glob 内则补进 `pnpm-workspace.yaml` → `pnpm install`。
- 子包互不提升、互不可见:每个包只能看见自己 **声明** 的依赖(天然防"幽灵依赖")。
- 依赖装进全局 **store**(内容寻址、按内容去重),再硬链接到各包,装得快、占得省。`pnpm store path` 可查路径。
- 包名建议用 scope(`@company/ui`),与普通 npm 包区分、也便于 `--filter`。

## 二、安装与加依赖

```bash
pnpm install                    # 全仓安装(新增目录 / 改 workspace 后必跑)
pnpm install --frozen-lockfile  # CI:锁文件未变更才装

pnpm add lodash --filter @c/ui                 # 给某子包加运行时依赖
pnpm add -D typescript --filter @c/ui          # 加该子包 devDeps
pnpm add -D -w eslint                          # 装到根(共享 devDeps 必须带 -w)
pnpm add @c/utils --filter @c/ui               # 引入同仓内部包,自动写 workspace: 协议
pnpm remove lodash --filter @c/ui              # 移除
pnpm update --filter @c/ui                     # 更新
```

- `-w / --workspace-root`:操作根包;根只放公共脚本和共享配置,`private: true` 不发布。
- 想给"所有子包"加同款依赖,循环用 `pnpm --filter "./packages/**" add -D X`(glob 形式见下)。

## 三、内部依赖:workspace: 协议

引用同仓包**不写死版本**:

```jsonc
// packages/ui/package.json
{ "dependencies": { "@c/utils": "workspace:^" } }
```

| 写法                | 本地效果             | 发布时 pnpm 自动改写为 |
| ------------------- | -------------------- | ---------------------- |
| `workspace:*`       | 永远链接工作区该包   | 精确版本,如 `1.5.0`    |
| `workspace:^`       | 同上                 | caret 范围,如 `^1.5.0` |
| `workspace:~`       | 同上                 | tilde 范围,如 `~1.5.0` |
| 内部包跨包 dev 依赖 | 一般写 `workspace:*` | 不随包发布,无影响      |

- 本地:目标包以**软链**挂进来,改源码即生效(见 §五),无需发版重装。
- 发布:改写依赖的是 **`pnpm publish`**(会先 pack 并替换)。用 `npm publish` 会把 `workspace:*` 原样打进去,导致下游装不上 —— 千万别混用。
- 想精确控制可写 `workspace:^1.2.3`,但日常用上表三种即可。

## 四、按范围执行:`--filter`

选包的两种维度:**包名 / 目录**。筛选可与所有子命令组合(`run / add / exec / ...`)。

```bash
pnpm --filter @c/ui run build      # 只跑 @c/ui
pnpm --filter "./packages/**" run build   # 目录通配一批包
pnpm --filter "@c/*" run lint      # 包名通配(需引号防 shell 展开)
pnpm --filter . run lint           # 只跑根脚本
```

依赖关系后缀(`...`)控制"连带谁":

| 写法          | 命中                        |
| ------------- | --------------------------- |
| `@c/ui`       | 仅该包                      |
| `@c/ui...`    | 该包 **+ 它依赖的包**(上游) |
| `...@c/ui`    | 该包 **+ 依赖它的包**(下游) |
| `...@c/ui...` | 上下游全部                  |
| `!@c/ui`      | 排除某包(可多段叠加)        |

开发期最常用的两种场景:

```bash
# 只重构一个库并检查它的下游没被改坏
pnpm --filter "...@c/ui" run typecheck
# 库改完,重新构建它及所有用它的人
pnpm --filter "...@c/ui" run build
```

## 五、递归执行脚本(全仓/拓扑)

| 命令                               | 效果                                            |
| ---------------------------------- | ----------------------------------------------- |
| `pnpm -r run build`                | 所有子包执行 build(默认按依赖**拓扑序**,依赖先) |
| `pnpm -r run test -- --watch`      | 参数透传给每个包                                |
| `pnpm -r --no-sort run build`      | 不排序                                          |
| `pnpm -r --parallel run build`     | 忽略顺序并行跑(适合互不依赖的 lint 等)          |
| `pnpm -r --stream run build`       | 并行 + 输出带包名前缀,好读                      |
| `pnpm -r run build --filter @c/ui` | 与 --filter 叠加                                |

- `-r` 默认**不含根**;要连根一起跑加 `--include-workspace-root`。
- 在根 `package.json` 里预设常用入口,人人 `pnpm run build` 即全量:
  ```jsonc
  {
    "scripts": {
      "build": "pnpm --filter \"./packages/**\" run build",
      "typecheck": "pnpm --filter \"./packages/**\" run typecheck",
      "lint": "eslint .",
    },
  }
  ```
  这里用 glob 而非 `-r`,是为了**不含根**、避免递归调用自身。

## 六、版本统一 / 锁定 catalog

多包用**同一版本范围**,避免每个包里各自手抄一遍、升版本到处改 —— **catalogs**(pnpm ≥ 9.5):

```yaml
# pnpm-workspace.yaml
catalog:
  react: ^18.3.1
  typescript: ^5.4.5
catalogs: # 具名 catalog(如老/新两套)
  legacy:
    react: ^17.0.2
```

```jsonc
// 任意子包 package.json
{ "dependencies": { "react": "catalog:" }, "devDependencies": { "typescript": "catalog:legacy" } }
```

改版本只需动 `pnpm-workspace.yaml` 一处,`pnpm install` 后全仓生效。

**强制统一某传递依赖的版本**(子依赖升级冲突 / 安全修复),用 overrides:

```yaml
# pnpm-workspace.yaml
overrides:
  lodash: 4.17.21
```

> pnpm 9.5+ 起 `catalog` 就声明在 `pnpm-workspace.yaml`;pnpm 10+ 又把 `overrides` / `allowBuilds` / `patchedDependencies` 等一并收进 `pnpm-workspace.yaml`,`.npmrc` 只留 registry / 提升类等少量项。

## 七、依赖生命周期脚本(pnpm ≥ 10)

出于供应链安全,pnpm 10+ **默认不执行任何依赖的 `install/postinstall` 脚本**,原生模块(esbuild、@swc/core、sharp、electron 等)需要显式放行:

```yaml
# pnpm-workspace.yaml
allowBuilds: # v10.26+ 的推荐写法(true 放行 / false 拒绝)
  esbuild: true
  '@swc/core': true
```

```bash
pnpm ignored-builds     # 列出被拦下的脚本
pnpm approve-builds     # 交互式逐个放行(自动写入 pnpm-workspace.yaml)
```

install 报 "Ignored build scripts" 即由此而来,按需放行即可。

## 八、版本管理与发布

**核心原则:不手动改 `version`,交给专门的流程。**

- 单包手动发布:`cd packages/ui && pnpm publish`(或根目录 `pnpm publish -r`)。用 `pnpm publish`,否则 `workspace:` 不会被改写。
- 多包联动发版,业界标配 **Changesets**(版本号 + CHANGELOG 一起管):

```bash
pnpm changeset          # ① 交互记录本次变更(自动写 .changeset/*.md)
git commit -am "feat: ..."
pnpm changeset version  # ② 按语义化升各包版本 + 生成/合并 CHANGELOG
git commit -am "chore: version packages"
pnpm changeset publish  # ③ 逐个发包(内部依赖版本已改写)
```

要点:

- 谁发了 changeset,谁进本次发布;没变的不升版。
- 想让"上游升 minor 时下游自动补 patch",配置:`.changeset/config.json` → `"updateInternalDependencies": "patch"`。
- 发包内容收敛:子包 `package.json` 配 `"files": ["dist"]`;`pnpm pack --dry-run` 可预览将打进 tarball 的文件。
- 只发到自己的私有源:命令带 `--registry=<url>`,或 `npm_config_registry=<url> pnpm ...`(env 方式对 changeset publish 同样生效)。

## 九、Node / pnpm 版本统一

根 `package.json` 声明工具链版本,开发者与 CI 一致:

```jsonc
{ "packageManager": "pnpm@11.0.0", "engines": { "node": ">=20" } }
```

```bash
corepack enable        # 首次开启后,pnpm 版本由 packageManager 字段决定
```

## 十、常见疑问

- **改了内部包源码,消费方(类型/行为)不生效?** 库包入口通常指向构建产物 `dist/`。本地联调需先构建依赖方,或用 `--filter` 起 watch:`pnpm --filter @c/utils run dev`(如 `tsup --watch`)。
- **装了依赖但子包 import 不到?** 子包只能看到自己声明的依赖——把它加进该包 `dependencies`/`devDependencies` 再 install;全局工具类放根 + `-w`。
- **`pnpm install` 报 lockfile 冲突 / "not up to date"?** 提交锁文件、用 `--frozen-lockfile` 进 CI;本地有分歧时先 `pnpm install`。
- **依赖装哪去了 / 为什么 node_modules 不像平铺?** pnpm 用 store + 软链结构;`pnpm why <pkg>` 查谁引入了它,`pnpm list -r` 列各包依赖。
- **想临时跑个包不想装进项目?** `pnpm dlx <pkg>`(等价 npx)。`pnpm exec <cmd>` 跑本地 node_modules 里的命令。
- **根脚本被执行 `-r` 漏掉?** `-r` 默认不含根,用 `pnpm --filter . run <script>` 或加 `--include-workspace-root`。

> 官方文档:pnpm workspaces / filters / catalogs / overrides 各页,命令细节以 `pnpm help <command>` 为准。
