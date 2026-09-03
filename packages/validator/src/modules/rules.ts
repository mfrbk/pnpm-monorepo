/**
 * 内置正则校验器与规则注册表
 *
 * 表单校验、正则校验、业务规则统一在此维护:每个规则 = 校验函数 + 缺省文案。
 */
import type { BuiltinRuleName } from './types'

/** 邮箱 */
export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(value)
}

/** 中国大陆手机号 */
export function isMobile(value: unknown): value is string {
  return typeof value === 'string' && /^1[3-9]\d{9}$/.test(value)
}

/** URL(http/https/ftp) */
export function isUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ftp:'
  } catch {
    return false
  }
}

/** 身份证号(15 位旧版或 18 位新版) */
export function isIdCard(value: unknown): value is string {
  return typeof value === 'string' && /^(?:\d{15}|\d{17}[\dXx])$/.test(value)
}

/** 将参数格式化为可读文案 */
function formatParam(param: unknown): string {
  if (Array.isArray(param)) return param.join('、')
  if (param instanceof RegExp) return param.toString()
  return String(param)
}

export interface BuiltinRule {
  /** 校验函数:value 为被校验值,param 为规则参数 */
  test: (value: unknown, param?: unknown) => boolean
  /** 缺省错误文案生成器 */
  message: (param?: unknown) => string
}

/** 内置规则注册表 */
export const BUILTIN_RULES: Record<BuiltinRuleName, BuiltinRule> = {
  required: {
    test: (value) =>
      value !== null &&
      value !== undefined &&
      value !== '' &&
      !(Array.isArray(value) && value.length === 0),
    message: () => '不能为空',
  },
  email: {
    test: (value) => isEmail(value),
    message: () => '邮箱格式不正确',
  },
  mobile: {
    test: (value) => isMobile(value),
    message: () => '手机号格式不正确',
  },
  url: {
    test: (value) => isUrl(value),
    message: () => 'URL 格式不正确',
  },
  idCard: {
    test: (value) => isIdCard(value),
    message: () => '身份证号格式不正确',
  },
  number: {
    test: (value) => typeof value === 'number' && !Number.isNaN(value),
    message: () => '必须是数字',
  },
  integer: {
    test: (value) => typeof value === 'number' && Number.isInteger(value),
    message: () => '必须是整数',
  },
  boolean: {
    test: (value) => typeof value === 'boolean',
    message: () => '必须是布尔值',
  },
  min: {
    test: (value, param) =>
      typeof value === 'number' && typeof param === 'number' && value >= param,
    message: (param) => `不能小于 ${formatParam(param)}`,
  },
  max: {
    test: (value, param) =>
      typeof value === 'number' && typeof param === 'number' && value <= param,
    message: (param) => `不能大于 ${formatParam(param)}`,
  },
  minLength: {
    test: (value, param) => {
      const length = typeof value === 'string' || Array.isArray(value) ? value.length : -1
      return typeof param === 'number' && length >= param
    },
    message: (param) => `长度不能小于 ${formatParam(param)}`,
  },
  maxLength: {
    test: (value, param) => {
      const length =
        typeof value === 'string' || Array.isArray(value) ? value.length : Number.POSITIVE_INFINITY
      return typeof param === 'number' && length <= param
    },
    message: (param) => `长度不能大于 ${formatParam(param)}`,
  },
  length: {
    test: (value, param) => {
      const length = typeof value === 'string' || Array.isArray(value) ? value.length : -1
      return typeof param === 'number' && length === param
    },
    message: (param) => `长度必须等于 ${formatParam(param)}`,
  },
  pattern: {
    test: (value, param) => {
      if (typeof value !== 'string') return false
      if (param instanceof RegExp) return param.test(value)
      if (typeof param === 'string') return new RegExp(param).test(value)
      return false
    },
    message: () => '格式不正确',
  },
  enum: {
    test: (value, param) => Array.isArray(param) && param.includes(value),
    message: (param) => `必须是 ${formatParam(param)} 之一`,
  },
}
