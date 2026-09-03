/**
 * 类型判断工具
 * 统一从 instanceof / typeof / Object.prototype.toString 三种视角提供类型守卫。
 */

const objectToString = Object.prototype.toString

/** 判断是否为 null 或 undefined */
export function isNil(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

/** 判断是否为 null */
export function isNull(value: unknown): value is null {
  return value === null
}

/** 判断是否为 undefined */
export function isUndefined(value: unknown): value is undefined {
  return value === undefined
}

/** 判断是否为 string */
export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/** 判断是否为 number(不含 NaN 判断,如需可用 Number.isFinite) */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

/** 判断是否为有限数字 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 判断是否为 boolean */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

/** 判断是否为 symbol */
export function isSymbol(value: unknown): value is symbol {
  return typeof value === 'symbol'
}

/** 判断是否为 bigint */
export function isBigInt(value: unknown): value is bigint {
  return typeof value === 'bigint'
}

/** 判断是否为函数 */
export function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function'
}

/** 判断是否为数组 */
export function isArray<T = unknown>(value: unknown): value is T[] {
  return Array.isArray(value)
}

/**
 * 判断是否为纯对象(原型为 Object.prototype 或 null 的对象)。
 * 用于区分普通对象字面量与 Date/Map/RegExp 等类实例。
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** 判断是否为 Date 实例 */
export function isDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

/** 判断是否为 RegExp 实例 */
export function isRegExp(value: unknown): value is RegExp {
  return value instanceof RegExp
}

/** 判断是否为 Map 实例 */
export function isMap(value: unknown): value is Map<unknown, unknown> {
  return value instanceof Map
}

/** 判断是否为 Set 实例 */
export function isSet(value: unknown): value is Set<unknown> {
  return value instanceof Set
}

/** 判断是否为 Promise 实例 */
export function isPromise<T = unknown>(value: unknown): value is Promise<T> {
  return value instanceof Promise
}

/** 判断是否为 Error(或其子类)实例 */
export function isError(value: unknown): value is Error {
  return value instanceof Error
}

/**
 * 判断是否为基础类型值(与对象相对)。
 * 注意:null 也被视为基础类型值。
 */
export function isPrimitive(value: unknown): boolean {
  return value === null || (typeof value !== 'object' && typeof value !== 'function')
}

/** 返回对象标签形如 'array' | 'date' | 'regexp' | 'map' | 'set' | ... */
export function objectTagOf(value: unknown): string {
  const tag = objectToString.call(value)
  // '[object Array]' -> 'array'
  return tag.slice(8, -1).toLowerCase()
}
