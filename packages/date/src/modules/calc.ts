/**
 * 日期计算:时间加减、周期边界、历法信息(闰年 / 季度 / 一年第几天等)
 */
import type { DateInput } from './format'
import { toDate } from './format'

type TimeUnit = 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

/** 拷贝一份 Date,保证所有计算函数都是纯函数 */
function copy(date: Date): Date {
  return new Date(date.getTime())
}

/** 判断指定年份(或日期)是否为闰年 */
export function isLeapYear(yearOrDate: number | DateInput): boolean {
  const year = typeof yearOrDate === 'number' ? yearOrDate : toDate(yearOrDate).getFullYear()
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** 判断是否为周末 */
export function isWeekend(date: DateInput): boolean {
  const day = toDate(date).getDay()
  return day === 0 || day === 6
}

/** 某月的天数。month 为 0-11(与 Date 一致);year 若省略则按当前年份 */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/** 今天是该年第几天(1-366) */
export function dayOfYear(date: DateInput): number {
  const d = toDate(date)
  const start = new Date(d.getFullYear(), 0, 0)
  return Math.floor((d.getTime() - start.getTime()) / 86400000)
}

/** ISO 周序号(周一为一周起点) */
export function weekOfYear(date: DateInput): number {
  const d = copy(toDate(date))
  const dayNum = (d.getDay() + 6) % 7 // 周一=0 ... 周日=6
  d.setDate(d.getDate() - dayNum + 3) // 定位到本周四
  const firstThursday = copy(d)
  firstThursday.setMonth(0, 1)
  if (firstThursday.getDay() !== 4) {
    firstThursday.setMonth(0, 1 + ((4 - firstThursday.getDay() + 7) % 7))
  }
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / 604800000)
}

/** 返回日期所在季度(1-4) */
export function quarter(date: DateInput): number {
  return Math.floor(toDate(date).getMonth() / 3) + 1
}

/** 将日期对齐到指定时间单位的起点(day / week / month / year),返回新 Date */
export function startOf(date: DateInput, unit: 'day' | 'week' | 'month' | 'year'): Date {
  const d = copy(toDate(date))
  switch (unit) {
    case 'year':
      d.setMonth(0, 1)
      d.setHours(0, 0, 0, 0)
      break
    case 'month':
      d.setDate(1)
      d.setHours(0, 0, 0, 0)
      break
    case 'week': {
      const day = (d.getDay() + 6) % 7 // 距周一
      d.setDate(d.getDate() - day)
      d.setHours(0, 0, 0, 0)
      break
    }
    case 'day':
    default:
      d.setHours(0, 0, 0, 0)
  }
  return d
}

/** 将日期对齐到指定时间单位的终点(含毫秒),返回新 Date */
export function endOf(date: DateInput, unit: 'day' | 'week' | 'month' | 'year'): Date {
  const d = copy(toDate(date))
  switch (unit) {
    case 'year':
      d.setMonth(11, 31)
      d.setHours(23, 59, 59, 999)
      break
    case 'month':
      d.setDate(daysInMonth(d.getFullYear(), d.getMonth()))
      d.setHours(23, 59, 59, 999)
      break
    case 'week': {
      // 以周一为一周起点,先回到本周一,再 +6 天到本周日
      const dayIndex = (d.getDay() + 6) % 7
      d.setDate(d.getDate() - dayIndex + 6)
      d.setHours(23, 59, 59, 999)
      break
    }
    case 'day':
    default:
      d.setHours(23, 59, 59, 999)
  }
  return d
}

/** 日期加减(数量为负数即向前推算)。addWeeks/addMonths 分别处理周与月溢出。 */
export function add(date: DateInput, amount: number, unit: TimeUnit): Date {
  const d = copy(toDate(date))
  switch (unit) {
    case 'millisecond':
      d.setMilliseconds(d.getMilliseconds() + amount)
      break
    case 'second':
      d.setSeconds(d.getSeconds() + amount)
      break
    case 'minute':
      d.setMinutes(d.getMinutes() + amount)
      break
    case 'hour':
      d.setHours(d.getHours() + amount)
      break
    case 'day':
      d.setDate(d.getDate() + amount)
      break
    case 'week':
      d.setDate(d.getDate() + amount * 7)
      break
    case 'month': {
      const monthIndex = d.getMonth() + amount
      const year = d.getFullYear() + Math.floor(monthIndex / 12)
      const month = ((monthIndex % 12) + 12) % 12
      const lastDayOfTarget = daysInMonth(year, month)
      d.setFullYear(year, month, Math.min(d.getDate(), lastDayOfTarget))
      break
    }
    case 'year': {
      const nextYear = d.getFullYear() + amount
      const leapDay = d.getMonth() === 1 && d.getDate() === 29
      d.setFullYear(nextYear)
      // 2 月 29 日 → 平年顺延到 2 月 28 日
      if (leapDay && !isLeapYear(nextYear)) d.setDate(28)
      break
    }
  }
  return d
}

/** 便捷 API:按单位加一段时间 */
export function addTime(date: DateInput, amount: number, unit: TimeUnit): Date {
  return add(date, amount, unit)
}

export const addDays = (date: DateInput, amount: number): Date => add(date, amount, 'day')
export const addWeeks = (date: DateInput, amount: number): Date => add(date, amount, 'week')
export const addMonths = (date: DateInput, amount: number): Date => add(date, amount, 'month')
export const addYears = (date: DateInput, amount: number): Date => add(date, amount, 'year')
export const addHours = (date: DateInput, amount: number): Date => add(date, amount, 'hour')
export const addMinutes = (date: DateInput, amount: number): Date => add(date, amount, 'minute')
export const addSeconds = (date: DateInput, amount: number): Date => add(date, amount, 'second')
