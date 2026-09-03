# Vite 工程化配置与最佳实践

> [← 返回总纲](./README.md) · 本系列第 2 篇:vite.config 全解 / `.env` 与 `import.meta.env` / `index.html` 即入口的设计

上一篇确立了 Vite 的"双引擎"心智,这一篇把它落进真实项目:配置项不多,但**每个都对应一个真实工程问题**(部署路径、别名、跨域、多环境、多页)。照着"问题 → 配置"的顺序读,比背 API 强得多。

## 一、先看一份工程该长什么样

```
my-app/
├── index.html            # 根目录的 html 就是应用入口(见第四节)
├── vite.config.ts        # 构建配置(Vite 官方脚手架默认 TS)
├── public/               # 不经处理的静态资源,原样拷到产物根
├── src/                  # 源码;被 index.html 的 <script type="module"> 引入
└── .env.development / .env.production   # 环境变量
```

`vite.config.ts` 的骨架:

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  // ...各项配置
})
```

`defineConfig` 不是可有可无的装饰——它提供**类型提示与校验**,写配置时拼错字段立刻报错。

## 二、高频配置项:每个都对应一个工程问题

### base:应用部署在子路径 / CDN 时,资源从哪找

**问题**:SPA 通常部署在站点的根路径,但也有大量场景要部署到**子路径**(如 GitHub Pages 的 `/my-repo/`、统一网关下的某段路由)或**CDN**。默认 `base: '/'`,所有资源 URL 都从根开始拼,**子路径部署必 404**。

```ts
export default defineConfig({
  base: '/my-app/', // 部署在 https://host/my-app/ 下
  // base: './'  ← 产物用相对路径引用(适合静态文件任意目录分发,较不常见)
})
```

配套地,Vite 会把 `import.meta.env.BASE_URL` 暴露给你(默认 `/`),做**需要感知部署路径的运行时拼接**(比如动态加载的图片):

```ts
const logo = `${import.meta.env.BASE_URL}logo.png`
```

### resolve.alias:告别一长串 `../../../`

**问题**:深层组件引公共工具,`import x from '../../../utils'` 既丑又脆(一挪目录全断)。

```ts
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)), // 唯一真源:src
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
    },
  },
})
```

> 注意两点:Vite **默认不会**替你读 `tsconfig` 的 `paths` 映射(除非装了 `vite-tsconfig-paths` 之类插件),别名要靠 `resolve.alias` 显式声明;用 `fileURLToPath(new URL(...))` 而非 `__dirname`,是因为 `vite.config.ts` 默认按 ESM 处理。

### css:预处理器与 CSS Modules

**问题**:项目要写 SCSS 变量 / 用样式隔离(CSS Modules)。

```ts
export default defineConfig({
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@/styles/var.scss" as *;`, // 每个 scss 都自动注入变量
      },
    },
    modules: {
      localsConvention: 'camelCase', // .module.css 里 .btn-primary → styles.btnPrimary
    },
    devSourcemap: true, // 开发期保留样式源码映射,便于定位
  },
})
```

配合使用:普通样式 `import './index.css'` 走全局;需要隔离的写 `X.module.css`,导入后得到**作用域化的类名对象**:

```tsx
import styles from './Card.module.css'
;<div className={styles.card}>内容</div> // 类名被编译成带哈希的唯一名字
```

### server.proxy:开发环境的跨域代理

**问题**:开发时前端在 `localhost:5173`,后端接口在 `localhost:8080`,直接 `fetch('/api/...')` 必然跨域。**不要在 dev 里给后端开 CORS 满天飞**,更不该写死后端地址——让 dev server 做一层代理,前端永远只写相对路径:

```ts
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // 前端请求 /api/* → 代理到后端,并把 /api 前缀剥掉
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // WebSocket 接口同样可代理(ws: true)
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
})
```

**proxy 只活在 dev**:产物上线后由网关 / Nginx 承担同样的"转发到后端"职责。所以代码里**永远用相对路径 `/api/...`,把"后端到底在哪"留给环境层解决**——这是前后端分离的黄金习惯。

## 三、环境变量:`.env` 与 `import.meta.env`

### 一套文件管理多环境

```
.env                     # 所有环境共有的
.env.development         # 开发(默认 mode: development)
.env.production          # 生产(默认 mode: production)
.env.local               # 本地私有,优先级最高,通常 gitignore
.env.production.local    # 特定环境 + 本地
```

按文件加载,后读的覆盖先读的,**`.local` 系优先级最高**——适合放个人本地的调试地址,且不该提交进仓库(记得进 `.gitignore`)。

```bash
# .env.development
VITE_API_BASE=/api
VITE_ENABLE_MOCK=true

# .env.production
VITE_API_BASE=https://api.example.com
```

### 代码里怎么安全地读:import.meta.env 与 VITE_ 前缀

代码里通过 `import.meta.env` 访问,并带上**几个内建字段**:

| 字段                           | 含义                                       |
| ------------------------------ | ------------------------------------------ |
| `import.meta.env.MODE`         | 当前 mode(如 `development` / `production`) |
| `import.meta.env.DEV` / `PROD` | 是否为开发 / 生产                          |
| `import.meta.env.SSR`          | 是否在 SSR 下                              |
| `import.meta.env.BASE_URL`     | `base` 配置值(默认 `/`)                    |
| `import.meta.env.VITE_*`       | 你在 `.env` 里写的、以 `VITE_` 开头的变量  |

**为什么强制 `VITE_` 前缀?这是安全设计。** 客户端能拿到的 env 会被**直接打进产物**,任何人都能在浏览器里看到。默认 `envPrefix: 'VITE_'`,**只有带这个前缀的变量才会被注入到 `import.meta.env`**——你 `package.json` 里的 `NPM_TOKEN`、`SECRET_KEY` 等敏感项就永远不会泄漏进前端 bundle:

```ts
const api = import.meta.env.VITE_API_BASE // ✅ 前缀正确,可用
// import.meta.env.NPM_TOKEN              // ❌ 不在白名单,undefined,也进不了产物
```

> 反过来记住一条铁律:**凡是 `VITE_` 开头的,都等于公开**。任何密钥、Token 一律不要用 `VITE_` 暴露;要读真正的服务端机密,走代理/网关,而不是塞进 `.env` 再指望前缀防住。

### 让 env 有类型(而不是玄学字符串)

`.env` 的键 Vite 不熟,`import.meta.env.VITE_XXX` 默认是 `any`/`string`。建 `src/vite-env.d.ts` 补全类型:

```ts
/// <reference types="vite/client" /> // 提供 import.meta.env 与资源导入的基础类型

interface ImportMetaEnv {
  readonly VITE_API_BASE: string
  readonly VITE_ENABLE_MOCK: 'true' | 'false'
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

## 四、index.html 即入口:一种不同的"入口哲学"

Webpack 的入口藏在 `webpack.config.js` 的 `entry` 里;Vite 把它**明晃晃放在项目根目录的 `index.html`**。这不是摆放习惯不同,而是架构使然:

- **index.html 是源码和模块图的一部分**,而非"最后的壳"。Vite 解析它,通过其中的 `<script type="module">` 找到应用入口(见 [架构篇](./architecture.md) 的按需编译);
- index.html 本身也会被 Vite **转译**(脚本会被处理、`<link>` 引用的资源会被解析打包),而不是原样复制;
- 好处:**入口即所见**——打开 HTML 就能知道这个应用从哪启动,多页应用也只需多放几个 html 并声明入口。

**多页应用(MPA)**:多个 html 各带自己的 module 入口,构建时把它们都声明为输入:

```ts
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
      },
    },
  },
})
```

**与 `public/` 的分工**:`public/` 里的文件**不做任何处理**(不转译、不哈希、不可 import),原样拷进产物根,通过绝对路径 `/xxx.png` 引用——适合 favicon、robots.txt、第三方不经过构建的脚本;而 `src/assets/` 下**经过 import 的资源**才走打包管线(哈希、压缩、懒加载)。**"要处理的走 import,不处理的放 public"** 是唯一需要记住的判据。

## 五、一份贴近真实的最佳实践配置

把上面串起来(去掉了与具体需求无关的项):

```ts
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/', // 子路径部署时改这里
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  css: {
    preprocessorOptions: { scss: { additionalData: `@use "@/styles/var.scss" as *;` } },
    modules: { localsConvention: 'camelCase' },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist', // 产物目录
    assetsDir: 'assets', // 静态资源子目录
    sourcemap: false, // 生产 map 按需开(参考 Webpack 篇的 map 红线)
    // 默认用 esbuild 压缩;追求更小体积可切 terser,代价是慢
    // minify: 'terser',
  },
})
```

## 速查

| 主题            | 一句话记住                                                  | 最易踩的坑                           |
| --------------- | ----------------------------------------------------------- | ------------------------------------ |
| `base`          | 部署在子路径/CDN 时改它,`import.meta.env.BASE_URL` 同步可用 | 子路径部署忘配 → 全 404              |
| `resolve.alias` | 显式声明路径别名,Vite 不读 tsconfig paths                   | 以为配了 tsconfig 就行               |
| `css`           | preprocessorOptions 管预处理器,modules 管样式隔离           | `.module.css` 才隔离,别当普通 css 用 |
| `server.proxy`  | 只活在 dev,后端地址交给代理环境                             | 线上忘配网关 → 接口全挂              |
| `.env`          | `VITE_` 前缀 = 会进产物的白名单                             | 把密钥写进 `VITE_` 变量              |
| `index.html`    | 根目录 html 就是入口与模块图一部分                          | 把资源塞 public 又想让它走打包管线   |
| MPA             | 多个 html 配 `build.rollupOptions.input`                    | 只留一个入口,admin 页打不进产物      |

> 官方文档:vite.dev/config、/guide/env-and-mode、/guide/features(静态资源/public/多页)。下一篇:[插件系统与 TypeScript](./plugins.md)。
