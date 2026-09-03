/**
 * 相对时间:把日期转换成 "刚刚 / 5 分钟前 / 3 天后" 这类可读文案(中文)
 */
import type { DateInput } from './format'
import { toDate } from './format'

export interface RelativeTimeOptions {
  /** 参照时刻,默认当前时间 */
  base?: DateInput
}

const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60 * MS_PER_SECOND
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

/** 取整档位:1 分钟内已由调用方以 "刚刚" 处理,此处从分钟档开始 */
function pickUnit(abs: number): { value: number; unit: '分钟' | '小时' | '天' | '个月' | '年' } {
  if (abs < MS_PER_HOUR) return { value: Math.round(abs / MS_PER_MINUTE), unit: '分钟' }
  if (abs < MS_PER_DAY) return { value: Math.round(abs / MS_PER_HOUR), unit: '小时' }
  if (abs < MS_PER_DAY * 30) return { value: Math.round(abs / MS_PER_DAY), unit: '天' }
  if (abs < MS_PER_DAY * 365) return { value: Math.round(abs / (MS_PER_DAY * 30)), unit: '个月' }
  return { value: Math.round(abs / (MS_PER_DAY * 365)), unit: '年' }
}

/**
 * 计算相对时间文案。
 * @param input 目标时间
 * @param options.base 参照时间,默认 now
 * 例:目标在 3 天前 → '3 天前';目标在 5 分钟后 → '5 分钟后'
 */
export function fromNow(input: DateInput, options: RelativeTimeOptions = {}): string {
  const target = toDate(input).getTime()
  const base = (options.base === undefined ? new Date() : toDate(options.base)).getTime()
  const diff = base - target

  // 一分钟内统一显示 "刚刚"
  if (Math.abs(diff) < MS_PER_MINUTE) return '刚刚'

  const { value, unit } = pickUnit(Math.abs(diff))
  const future = diff < 0
  return `${value}${unit}${future ? '后' : '前'}`
}

/** fromNow 的别名,语义更直观 */
export const formatRelative = fromNow
