/**
 * 日期解析与格式化(核心为"字段 → 模板"两段式,tz.ts 可复用同一套词元)
 */

/** 可被库接受的日期输入:Date 实例、时间戳(ms)或可被 Date 解析的字符串 */
export type DateInput = Date | number | string

/** 解析出的日历字段(month 为 1-12) */
export interface DateParts {
  year: number
  month: number
  date: number
  hours: number
  minutes: number
  seconds: number
  milliseconds: number
}

const pad = (value: number, length = 2): string => String(value).padStart(length, '0')

/** 将任意受支持的输入解析为 Date 实例;解析失败抛出 TypeError */
export function toDate(input: DateInput): Date {
  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`无效的日期输入:${String(input)}`)
  }
  return date
}

/** 校验输入是否可被解析为合法日期(不抛错) */
export function isValidDate(input: unknown): input is DateInput {
  if (input instanceof Date) return !Number.isNaN(input.getTime())
  if (typeof input === 'number' || typeof input === 'string') {
    return !Number.isNaN(new Date(input).getTime())
  }
  return false
}

/** 按本地时区取出日历字段 */
export function toDateParts(input: DateInput): DateParts {
  const d = toDate(input)
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    date: d.getDate(),
    hours: d.getHours(),
    minutes: d.getMinutes(),
    seconds: d.getSeconds(),
    milliseconds: d.getMilliseconds(),
  }
}

/** 将字段拼装为日期字段映射(供词元替换),独立函数便于按目标时区字段直接复用 */
function buildTokens(parts: DateParts): Record<string, string> {
  const hour12 = parts.hours % 12 === 0 ? 12 : parts.hours % 12
  return {
    YYYY: String(parts.year).padStart(4, '0'),
    YY: pad(parts.year % 100),
    MM: pad(parts.month),
    M: String(parts.month),
    DD: pad(parts.date),
    D: String(parts.date),
    HH: pad(parts.hours),
    H: String(parts.hours),
    hh: pad(hour12),
    h: String(hour12),
    mm: pad(parts.minutes),
    m: String(parts.minutes),
    ss: pad(parts.seconds),
    s: String(parts.seconds),
    SSS: pad(parts.milliseconds, 3),
    A: parts.hours < 12 ? 'AM' : 'PM',
    a: parts.hours < 12 ? 'am' : 'pm',
  }
}

/** 按模板格式化日期字段,返回字符串 */
export function formatDateParts(parts: DateParts, pattern = 'YYYY-MM-DD HH:mm:ss'): string {
  const tokens = buildTokens(parts)
  // 长的词元需排在前面,避免 YY 吞掉 YYYY 等误匹配
  return pattern.replace(
    /YYYY|YY|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s|SSS|A|a/g,
    (token) => tokens[token] ?? token,
  )
}

/**
 * 按模板格式化日期(本地时区)。
 * 支持词元:YYYY YY MM M DD D HH H hh h mm m ss s SSS A a
 * 例:formatDate(new Date(), 'YYYY-MM-DD HH:mm:ss') → '2026-09-03 12:30:45'
 */
export function formatDate(input: DateInput, pattern = 'YYYY-MM-DD HH:mm:ss'): string {
  return formatDateParts(toDateParts(input), pattern)
}
