/**
 * 拷贝工具:deepClone 支持循环引用与 Date / RegExp / Map / Set / 普通对象 / 数组
 */
import { isDate, isMap, isRegExp, isSet } from './is'

/** 递归深度拷贝。遇到循环引用时保留同一引用关系,而非死循环。 */
export function deepClone<T>(value: T, seen?: Map<unknown, unknown>): T {
  const memo = seen ?? new Map<unknown, unknown>()

  // 原始值 / 函数:直接返回
  if (value === null || typeof value !== 'object') return value

  const existing = memo.get(value)
  if (existing !== undefined) return existing as T

  if (isDate(value)) {
    const clone = new Date(value.getTime())
    memo.set(value, clone)
    return clone as T
  }
  if (isRegExp(value)) {
    const clone = new RegExp(value.source, value.flags)
    clone.lastIndex = value.lastIndex
    memo.set(value, clone)
    return clone as T
  }
  if (Array.isArray(value)) {
    const clone: unknown[] = []
    memo.set(value, clone)
    for (const item of value) clone.push(deepClone(item, memo))
    return clone as T
  }
  if (isMap(value)) {
    const clone = new Map<unknown, unknown>()
    memo.set(value, clone)
    for (const [key, val] of value) clone.set(deepClone(key, memo), deepClone(val, memo))
    return clone as T
  }
  if (isSet(value)) {
    const clone = new Set<unknown>()
    memo.set(value, clone)
    for (const item of value) clone.add(deepClone(item, memo))
    return clone as T
  }
  // 普通对象及任意其它对象:枚举自有可枚举属性递归拷贝
  const clone: Record<string, unknown> = Object.create(Object.getPrototypeOf(value))
  memo.set(value, clone)
  for (const key of Object.keys(value)) {
    ;(clone as Record<string, unknown>)[key] = deepClone(
      (value as Record<string, unknown>)[key],
      memo,
    )
  }
  return clone as T
}
