/**
 * 校验执行核心:validateField 校验单值,validateObject 按 schema 校验对象。
 */
import { getByPath } from '@mfr/utils'
import { BUILTIN_RULES } from './rules'
import type {
  BuiltinRuleName,
  CustomValidator,
  FieldResult,
  FieldRule,
  ObjectErrors,
  ObjectResult,
  RuleConfig,
} from './types'

function isRuleConfig(rule: FieldRule): rule is RuleConfig {
  return typeof rule !== 'function'
}

/** 解析单个规则的错误文案 */
function runSingleRule(value: unknown, rule: FieldRule): string | null {
  if (isRuleConfig(rule)) {
    const impl = BUILTIN_RULES[rule.name as BuiltinRuleName]
    if (!impl) return `未知校验规则:${rule.name}`
    return impl.test(value, rule.param) ? null : (rule.message ?? impl.message(rule.param))
  }
  // 自定义校验函数:返回 false 则校验失败
  const pass = (rule as CustomValidator)(value)
  return pass ? null : '校验不通过'
}

/** 校验单个值:返回 { valid, errors },errors 为该值所有未通过的规则文案 */
export function validateField(value: unknown, rules: readonly FieldRule[]): FieldResult {
  const errors: string[] = []
  for (const rule of rules) {
    const message = runSingleRule(value, rule)
    if (message !== null) errors.push(message)
  }
  return { valid: errors.length === 0, errors }
}

/** 校验单个值的别名,便于表单场景语义化调用 */
export const validate = validateField

/**
 * 按 schema 校验对象。
 * @param schema 字段路径 → 规则数组;字段路径支持 'a.b' 与 'a[0].b'(经 @mfr/utils getByPath 读取)
 * @param data   待校验对象
 */
export function validateObject(
  schema: Record<string, readonly FieldRule[]>,
  data: Record<string, unknown> | null | undefined,
): ObjectResult {
  const errors: ObjectErrors = {}
  for (const field of Object.keys(schema)) {
    const result = validateField(getByPath(data, field), schema[field])
    if (!result.valid) errors[field] = result.errors
  }
  return { valid: Object.keys(errors).length === 0, errors }
}

/** 判断单个值是否满足全部规则(常用于纯判断场景) */
export function isValid(value: unknown, rules: readonly FieldRule[]): boolean {
  return validateField(value, rules).valid
}
