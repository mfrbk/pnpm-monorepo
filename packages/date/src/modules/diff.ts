/**
 * 时间差值计算与比较
 */
import type { DateInput } from './format'
import { toDate, toDateParts } from './format'

const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60 * MS_PER_SECOND
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

const floorDiv = (numerator: number, denominator: number): number =>
  Math.trunc(numerator / denominator)

/** 相差毫秒数 = left - right */
export function diffInMilliseconds(dateLeft: DateInput, dateRight: DateInput): number {
  return toDate(dateLeft).getTime() - toDate(dateRight).getTime()
}

/** 相差秒数(向下取整) */
export function diffInSeconds(dateLeft: DateInput, dateRight: DateInput): number {
  return floorDiv(diffInMilliseconds(dateLeft, dateRight), MS_PER_SECOND)
}

/** 相差分钟数(向下取整) */
export function diffInMinutes(dateLeft: DateInput, dateRight: DateInput): number {
  return floorDiv(diffInMilliseconds(dateLeft, dateRight), MS_PER_MINUTE)
}

/** 相差小时数(向下取整) */
export function diffInHours(dateLeft: DateInput, dateRight: DateInput): number {
  return floorDiv(diffInMilliseconds(dateLeft, dateRight), MS_PER_HOUR)
}

/**
 * 相差天数(按毫秒差换算,向下取整)。
 * 注意:跨越夏令时切换的日期可能因 ±1h 产生 ±1 天的换算偏差;日历天对比请用 isSameDay。
 */
export function diffInDays(dateLeft: DateInput, dateRight: DateInput): number {
  return floorDiv(diffInMilliseconds(dateLeft, dateRight), MS_PER_DAY)
}

/** 两个时刻是否相等 */
export function isEqual(dateLeft: DateInput, dateRight: DateInput): boolean {
  return diffInMilliseconds(dateLeft, dateRight) === 0
}

/** dateLeft 是否早于 dateRight */
export function isBefore(dateLeft: DateInput, dateRight: DateInput): boolean {
  return diffInMilliseconds(dateLeft, dateRight) < 0
}

/** dateLeft 是否晚于 dateRight */
export function isAfter(dateLeft: DateInput, dateRight: DateInput): boolean {
  return diffInMilliseconds(dateLeft, dateRight) > 0
}

/** 是否为同一天(仅比较年月日,忽略时刻与夏令时) */
export function isSameDay(dateLeft: DateInput, dateRight: DateInput): boolean {
  const a = toDateParts(dateLeft)
  const b = toDateParts(dateRight)
  return a.year === b.year && a.month === b.month && a.date === b.date
}

/** 是否为同一月 */
export function isSameMonth(dateLeft: DateInput, dateRight: DateInput): boolean {
  const a = toDateParts(dateLeft)
  const b = toDateParts(dateRight)
  return a.year === b.year && a.month === b.month
}

/** 是否为同一年 */
export function isSameYear(dateLeft: DateInput, dateRight: DateInput): boolean {
  return toDate(dateLeft).getFullYear() === toDate(dateRight).getFullYear()
}
