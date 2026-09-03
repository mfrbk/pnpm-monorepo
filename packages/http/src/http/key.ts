import type { HttpRequestConfig } from './types'

/**
 * 结构化值稳定序列化。
 * - 对象键按字典序排序,避免同义对象因键序不同生成不同 key;
 * - FormData / Blob / Date 等特殊对象降级为可复现的类型标记;
 * - 不可序列化兜底返回类型名,保证永不抛错。
 */
function stableSerialize(value: unknown): string {
  if (value === null) return 'null'
  const type = typeof value
  if (type === 'string') return JSON.stringify(value)
  if (type === 'number' || type === 'boolean' || type === 'bigint') return String(value)
  if (type === 'undefined') return 'undefined'
  if (type === 'function') return `[function:${(value as () => unknown).name}]`

  if (typeof FormData !== 'undefined' && value instanceof FormData) return '[FormData]'
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return `[Blob:${value.size}:${value.type}]`
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`

  if (Object.prototype.toString.call(value) === '[object Object]') {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    return `{${entries.join(',')}}`
  }
  return `[${Object.prototype.toString.call(value)}]`
}

/**
 * 生成唯一请求 Key(method + url + params + data)。
 * 同一请求的幂等 key 相同,用于防重复与并发管理。
 */
export function generateRequestKey(config: HttpRequestConfig): string {
  return [
    (config.method ?? 'get').toLowerCase(),
    config.url ?? '',
    stableSerialize(config.params),
    stableSerialize(config.data),
  ].join('&')
}
