/**
 * 数字处理工具
 */

/** 将数字钳制在 [min, max] 区间内 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 生成 [min, max] 闭区间内的随机整数 */
export function randomInt(min: number, max: number): number {
  const [lo, hi] = min <= max ? [min, max] : [max, min]
  return Math.floor(Math.random() * (hi - lo + 1)) + lo
}

/**
 * 保留指定位小数。
 * @param precision 小数位,默认 0;支持负数为按 10^n 取整
 */
export function round(value: number, precision = 0): number {
  const factor = 10 ** precision
  return Math.round((value + Number.EPSILON) * factor) / factor
}

/** 判断数字是否位于 [start, end) 左闭右开区间内 */
export function inRange(value: number, start: number, end?: number): boolean {
  const [lo, hi] = end === undefined ? [0, start] : [start, end]
  return value >= Math.min(lo, hi) && value < Math.max(lo, hi)
}

/** 求一组数字的平均值,空数组返回 NaN */
export function average(...values: number[]): number {
  if (values.length === 0) return Number.NaN
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
