/**
 * 对象处理工具
 */
import { isPlainObject } from './is'

/** 选取对象中的部分键,返回新对象 */
export function pick<T extends object, K extends keyof T>(
  object: T,
  keys: readonly K[],
): Pick<T, K> {
  const result = {} as Pick<T, K>
  for (const key of keys) {
    if (key in object) result[key] = object[key]
  }
  return result
}

/** 剔除对象中的指定键,返回新对象(不修改原对象) */
export function omit<T extends object, K extends keyof T>(
  object: T,
  keys: readonly K[],
): Omit<T, K> {
  const keySet = new Set<string>(keys as readonly string[])
  const result = {} as Omit<T, K>
  for (const key of Object.keys(object) as Array<keyof T>) {
    if (!keySet.has(key as string)) {
      ;(result as Record<string, unknown>)[key as string] = object[key]
    }
  }
  return result
}

/**
 * 深合并:仅对两侧均为普通对象的节点做递归合并,其余情况(数组、原始值、类实例)后者直接覆盖前者。
 * 返回新对象,不修改入参。
 */
export function deepMerge<T extends Record<string, unknown>>(base: T, patch: Partial<T>): T
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  ...patches: Array<Partial<T> | undefined>
): T
export function deepMerge(
  base: Record<string, unknown>,
  ...patches: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }
  for (const patch of patches) {
    if (!patch) continue
    for (const key of Object.keys(patch)) {
      const baseValue = result[key]
      const patchValue = patch[key]
      if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
        result[key] = deepMerge(baseValue, patchValue)
      } else {
        result[key] = patchValue
      }
    }
  }
  return result
}

type PathSegment = string | number
type Path = string | readonly PathSegment[]

/** 将字符串路径解析为路径段数组,支持 'a[0].b' 与 'a.b.c' 两种风格 */
function toPathSegments(path: Path): PathSegment[] {
  if (typeof path !== 'string') return [...path]
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((seg) => seg !== '')
}

/** 按路径读取对象属性,读取不到时返回 fallback */
export function getByPath<T>(object: unknown, path: Path, fallback?: T): T | undefined {
  let current: unknown = object
  for (const segment of toPathSegments(path)) {
    if (current === null || current === undefined) return fallback
    current = (current as Record<PathSegment, unknown>)[segment]
  }
  return current === undefined ? fallback : (current as T)
}

/** 按路径写入对象属性(不可变:沿途对象均浅拷贝后写入,返回新对象,不修改入参) */
export function setByPath<T extends Record<string, unknown>>(
  object: T,
  path: Path,
  value: unknown,
): T {
  const segments = toPathSegments(path)
  if (segments.length === 0) return object

  const root: Record<string, unknown> = { ...object }
  let cursor = root
  for (let i = 0; i < segments.length - 1; i++) {
    const key = String(segments[i])
    const existing = cursor[key]
    // 沿途节点一律克隆为普通对象(保持不可变);数字路径段也按对象键处理
    const clone: Record<string, unknown> =
      existing !== null && typeof existing === 'object'
        ? { ...(existing as Record<string, unknown>) }
        : {}
    cursor[key] = clone
    cursor = clone
  }
  cursor[String(segments[segments.length - 1])] = value
  return root as T
}
