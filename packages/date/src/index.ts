/**
 * @mfr/date 统一入口
 *
 * 使用约定:
 * 1. 所有对外能力一律经本文件聚合导出;
 * 2. 新增日期能力时,在 src/modules 下按功能拆分新文件,再在此处 re-export。
 */

export * from './modules/format'
export * from './modules/calc'
export * from './modules/diff'
export * from './modules/relative'
export * from './modules/tz'
