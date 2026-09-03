// @mzy1120/eslint-config —— 全局 ESLint 10 flat 共享配置。
// 设计:本包自足(自带所需插件依赖),根 eslint.config.mjs 引入后覆盖整个 monorepo,
//       所有子包 / 配置文件自动继承,无需为子包单独配置。
// 格式化交给 prettier(见 tooling/prettier-config),末尾引入 eslint-config-prettier 仅用于关闭冲突规则。
const js = require('@eslint/js')
const tseslint = require('typescript-eslint')
const globals = require('globals')
const eslintConfigPrettier = require('eslint-config-prettier')

const tsFiles = ['**/*.{ts,mts,cts,tsx}']

// typescript-eslint recommended 预设(兼容其为单对象或多对象的形态),统一限定作用于 TS 文件
const recommended = tseslint.configs.recommended
const tsRecommendedConfigs = (Array.isArray(recommended) ? recommended : [recommended]).map(
  (cfg) => ({
    ...cfg,
    files: cfg.files ?? tsFiles,
  }),
)

module.exports = [
  // ---------- TypeScript 源码 ----------
  ...tsRecommendedConfigs,
  {
    files: tsFiles,
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // ---------- JS 配置 / 脚本(commitlint / tsup.config / scripts / *.config.*) ----------
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      ...(js.configs.recommended.rules || {}),
      'no-console': 'off',
    },
  },

  // ---------- 关闭与 prettier 冲突的规则(必须置于末尾) ----------
  eslintConfigPrettier,
]
