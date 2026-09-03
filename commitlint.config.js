// Git 提交信息规范:类型必须取自以下枚举,支撑 Changesets 分组 Changelog 的类型语义。
//   feat    新增功能(对应 minor)      fix    bug 修复(对应 patch)
//   perf    性能优化                   refactor 重构(无功能变更)
//   docs    文档更新                   chore  工程配置 / 依赖更新
//   break   破坏性更新(对应 major)
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'perf', 'refactor', 'docs', 'chore', 'break']],
    'header-max-length': [2, 'always', 100],
    'subject-empty': [2, 'never'],
  },
}
