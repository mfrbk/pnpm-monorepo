import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// demo 仅用官方 react 插件,无自定义 transform / node 侧依赖。
// 已纳入 tsconfig include 一并做类型检查;bundler 解析下即可解析 vite 类型,无需 @types/node。
export default defineConfig({
  plugins: [react()],
})
