/**
 * 数组处理工具
 */

type DeepArray<T> = T | DeepArray<T>[]

/** 将数组按指定大小分块,返回二维数组 */
export function chunk<T>(array: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) return [array.slice() as T[]]
  const result: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size))
  }
  return result
}

/** 数组去重(基于同值比较) */
export function unique<T>(array: readonly T[]): T[] {
  return [...new Set(array)]
}

/** 数组去重(基于 iteratee 返回的键) */
export function uniqueBy<T>(array: readonly T[], iteratee: (item: T) => unknown): T[] {
  const seen = new Set<unknown>()
  const result: T[] = []
  for (const item of array) {
    const key = iteratee(item)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }
  return result
}

/** 去除数组中所有假值(false、null、undefined、0、''、NaN) */
export function compact<T>(array: readonly (T | false | null | undefined | 0 | '')[]): T[] {
  return array.filter(Boolean) as T[]
}

/** 扁平化一层 */
export function flatten<T>(array: readonly (T | T[])[]): T[] {
  return array.reduce<T[]>((acc, item) => acc.concat(item), [])
}

/** 递归扁平化任意深度 */
export function flattenDeep<T>(array: readonly DeepArray<T>[]): T[] {
  const result: T[] = []
  const walk = (value: DeepArray<T>): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
    } else {
      result.push(value)
    }
  }
  for (const item of array) walk(item)
  return result
}

/** 求多个数组的交集(基于同值比较,元素以第一个数组中的顺序为准) */
export function intersection<T>(...arrays: readonly T[][]): T[] {
  if (arrays.length === 0) return []
  const [first, ...rest] = arrays
  const restSets = rest.map((arr) => new Set(arr))
  return first.filter((item) => restSets.every((set) => set.has(item)))
}

/** 求差集:a 中不在 b 中出现的元素 */
export function difference<T>(array: readonly T[], ...others: readonly T[][]): T[] {
  const exclude = new Set(others.flat())
  return array.filter((item) => !exclude.has(item))
}

/** 求并集(去重) */
export function union<T>(...arrays: readonly T[][]): T[] {
  return unique(arrays.flat())
}

/** 打乱数组(Fisher–Yates),返回新数组,不修改原数组 */
export function shuffle<T>(array: readonly T[]): T[] {
  const result = array.slice()
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** 生成数字序列:[start, end),若只传一个参数则从 0 开始 */
export function range(end: number): number[]
export function range(start: number, end: number, step?: number): number[]
export function range(startOrEnd: number, end?: number, step = 1): number[] {
  const [start, stop] = end === undefined ? [0, startOrEnd] : [startOrEnd, end]
  if (step === 0) throw new Error('range 的 step 不能为 0')
  const result: number[] = []
  if (step > 0) {
    for (let i = start; i < stop; i += step) result.push(i)
  } else {
    for (let i = start; i > stop; i += step) result.push(i)
  }
  return result
}
