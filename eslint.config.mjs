// ESLint 10 flat config 根入口:全局规范集中在 tooling/eslint-config 共享包(@mzy1120/eslint-config),
// 所有子包与配置文件自动继承,无需为子包单独配置。
import shared from '@mzy1120/eslint-config'

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.changeset/**',
      '**/*.tsbuildinfo',
      '**/*.tgz',
      'pnpm-lock.yaml',
    ],
  },
  ...shared,
]
