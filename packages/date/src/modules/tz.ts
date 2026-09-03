/**
 * 时区处理(基于 Intl.DateTimeFormat,零依赖)
 */
import type { DateInput, DateParts } from './format'
import { formatDateParts, toDate } from './format'

type TimeZone = string

interface WallClock {
  year: number
  month: number // 1-12
  date: number
  hours: number
  minutes: number
  seconds: number
}

/** 取某个时刻在指定时区下的墙钟时间 */
function getWallClock(date: Date, timeZone: TimeZone): WallClock {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const values: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = part.value
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    date: Number(values.day),
    hours: Number(values.hour),
    minutes: Number(values.minute),
    seconds: Number(values.second),
  }
}

/**
 * 某时刻在指定时区的 UTC 偏移量(分钟)。
 * 例:Asia/Shanghai → 480(UTC+8);America/New_York 冬季 → -300。
 * @param date     时刻,默认当前时间
 * @param timeZone IANA 时区名,如 'Asia/Shanghai'
 */
export function getTimezoneOffset(timeZone: TimeZone, date: DateInput = new Date()): number {
  const instant = toDate(date)
  const wall = getWallClock(instant, timeZone)
  const wallAsUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.date,
    wall.hours,
    wall.minutes,
    wall.seconds,
  )
  return Math.round((wallAsUtc - instant.getTime()) / 60000)
}

/** 将墙钟字段适配为 DateParts,复用 format.ts 的词元拼接 */
function wallToParts(wall: WallClock, milliseconds: number): DateParts {
  return {
    year: wall.year,
    month: wall.month,
    date: wall.date,
    hours: wall.hours,
    minutes: wall.minutes,
    seconds: wall.seconds,
    milliseconds,
  }
}

/**
 * 按指定时区格式化日期(与 formatDate 使用同一套词元)。
 * 例:formatInTimeZone('2026-09-03T04:00:00Z', 'Asia/Shanghai', 'YYYY-MM-DD HH:mm')
 *     → '2026-09-03 12:00'(东八区比 UTC 快 8 小时)
 */
export function formatInTimeZone(
  input: DateInput,
  timeZone: TimeZone,
  pattern = 'YYYY-MM-DD HH:mm:ss',
): string {
  const instant = toDate(input)
  const wall = getWallClock(instant, timeZone)
  return formatDateParts(wallToParts(wall, instant.getMilliseconds()), pattern)
}

/** 列出运行时支持的全部 IANA 时区(能力不足的环境回退为仅含本地时区) */
export function listTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  const zones = intl.supportedValuesOf?.('timeZone')
  if (zones && zones.length > 0) return zones
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone
  return local ? [local] : []
}

/** 将某时刻"平移"到目标时区的墙钟表示(返回的 Date 的本地字段等于该时区墙钟字段),供对比/调试使用 */
export function toTimeZoneWallClock(input: DateInput, timeZone: TimeZone): Date {
  const instant = toDate(input)
  const offsetMinutes = getTimezoneOffset(timeZone, instant)
  return new Date(instant.getTime() + offsetMinutes * 60000)
}
