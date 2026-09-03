/**
 * @mfr/utils 统一入口
 *
 * 使用约定:
 * 1. 所有对外能力一律经本文件聚合导出,禁止跨包 / 跨层级内部导入;
 * 2. 新增工具方法时,在 src/modules 下按功能拆分新文件,再在此处 re-export。
 */

export * from './modules/is'
export * from './modules/array'
export * from './modules/object'
export * from './modules/string'
export * from './modules/number'
export * from './modules/function'
export * from './modules/clone'
