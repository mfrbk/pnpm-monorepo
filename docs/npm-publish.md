# @mzy1120 · scope 包发布到 npm

> [← 返回主 README](../README.md) · 版本变更规范见 [.changeset/README](../.changeset/README.md)(自定义分组 CHANGELOG)

本仓库子包采用 scope 命名(`@mzy1120/*`),本文说明 **scope 包与 npm 组织的关系、首次发布前准备、完整发布流程与常见坑**。

## 一、scope 包与 npm 组织

> 结论:**scope 包(`@组织名/包名`)必须在 npm 创建同名组织;无 scope 的普通包名(`xxx-utils`)不需要组织。**

- 本仓库 scope 即组织名 `mzy1120`,子包形如 `@mzy1120/http`。
- **免费组织只能发布公共包**;私有 scope 包需付费订阅。本仓库为公共开源库,免费组织即可。
- 不想建组织时,可放弃 scope,包名直接叫 `xxx-utils`,用个人 npm 账号即可发布(缺点:易重名、无统一归类)。

## 二、首次发布前准备(一次性)

1. 注册 npm 账号 https://www.npmjs.com/,并创建与 scope 同名的组织 `mzy1120`。
2. 本地登录:
   ```bash
   npm login   # 输入账号 / 密码 / 邮箱验证码
   ```
   > `pnpm publish` 与 changesets 底层复用 npm 登录态,`npm login` 一次即可,无需单独登录。
3. 子包 `package.json` 关键配置(scope 包必填;`@mzy1120/http` 已就绪,**新增子包照此**):
   ```json
   {
     "name": "@mzy1120/xxx",
     "version": "0.0.1",
     "publishConfig": { "access": "public" }
   }
   ```
   - `publishConfig.access: "public"` — **scope 包必写**;缺失时 npm 默认当私有包发布,直接报错。
   - 根 `package.json` 必须 `"private": true`,禁止发布根包(本仓库已设置)。

## 三、发布流程(与仓库脚本一致)

前置:已完成 [changeset 记录与版本更新](../.changeset/README.md)(`pnpm changeset` → `pnpm run version`,注意 `version` 是根脚本,勿漏 `run`)。

**批量发布(推荐)**:

```bash
pnpm run release:publish   # preflight(lint + build + typecheck)+ changeset publish 逐包发包
```

`preflight` 已包含 build,确保 `dist/` 最新;若需先核对发布内容,可 dry-run:

```bash
pnpm run pack:check        # 各包 tarball dry-run,确认仅含 dist + package.json
pnpm run build
pnpm -r publish --dry-run  # 模拟发布,打印待上传文件与版本号,不真正发包
```

**单包发布**(先完成版本提交,再手动构建 + 发布):

```bash
pnpm --filter @mzy1120/http run build
cd packages/http && pnpm publish --registry=<registry>
```

> 手动单包发布**不会自动 build**,务必先构建,否则会发出空包。

## 四、常见疑问与坑

**1. 个人账号 vs 组织**
个人账号只能发普通包名;`@xxx/yyy` scope 包必须由组织发布。组织名 = scope 名(组织 `mzy1120` → 包 `@mzy1120/*`),多人可加入同一组织协作管理。

**2. 子包间互相依赖,发布后如何联动**
本地开发:pnpm workspace 软链直达本地源码。发布后:安装方会按依赖声明自动安装上游正式 npm 包。changesets 的 `updateInternalDependencies: "patch"` 会在上游升版时自动给下游补一个 patch 版本,无需手动改。当前仓库仅 `@mzy1120/http`(依赖 npm 的 `axios`,无包间依赖),机制保留给后续子包。

**3. 企业内部私有源(verdaccio / nexus)**
私有源自带 scope,无需在 npm 建组织。通过 `--registry=<url>` 或 `npm_config_registry=<url>` 临时切换(勿长期写死 `.npmrc`);私有源通常还需认证 token,参考对应制品库配置。

**4. 发包失败高频坑**

- scope 包缺 `publishConfig.access: "public"` → 报"私有包需付费"
- 未打包 `dist` 就发包 → 发布空包,安装后找不到模块
- 包名在组织中已被占用 → 需换 scope 名或包名
- 根 `package.json` 未设 `private: true` → 误把根包一起发布而报错
