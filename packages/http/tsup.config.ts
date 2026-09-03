import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  // 本包含默认导出(http 单例),开启 cjs 默认导出互操作,使 require() 消费方同时拿到 default 与具名导出
  cjsInterop: true,
  target: 'es2020',
})
