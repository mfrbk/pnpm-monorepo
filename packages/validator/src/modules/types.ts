/**
 * 校验库公共类型定义
 */

/** 内置校验规则名 */
export type BuiltinRuleName =
  | 'required'
  | 'email'
  | 'mobile'
  | 'url'
  | 'idCard'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'min'
  | 'max'
  | 'minLength'
  | 'maxLength'
  | 'length'
  | 'pattern'
  | 'enum'

/** 单条规则配置 */
export interface RuleConfig {
  /** 规则名:内置规则名或自定义规则名(需配合 createRule 注册,否则报未知规则) */
  name: BuiltinRuleName | (string & {})
  /** 规则参数:min/max → number;pattern → RegExp | string;enum → 候选值数组;... */
  param?: unknown
  /** 自定义错误文案,缺省使用内置文案 */
  message?: string
}

/** 自定义同步校验函数:返回 true 表示通过,false 表示不通过 */
export type CustomValidator = (value: unknown) => boolean

/** 字段可配置的规则:内置规则配置或自定义函数 */
export type FieldRule = RuleConfig | CustomValidator

/** 单个字段的校验结果 */
export interface FieldResult {
  valid: boolean
  errors: string[]
}

/** 以字段路径为键的错误集合 */
export type ObjectErrors = Record<string, string[]>

/** 整个对象的校验结果 */
export interface ObjectResult {
  valid: boolean
  errors: ObjectErrors
}
