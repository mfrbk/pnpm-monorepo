import type { EnvelopeConfig, HttpRequestConfig, ResolvedEnvelope } from './types'

/** 默认业务信封约定:{ code, message, data },code === 200 成功,401 未授权 */
export const DEFAULT_ENVELOPE: ResolvedEnvelope = {
  enabled: true,
  codeKey: 'code',
  messageKey: 'message',
  dataKey: 'data',
  successCodes: [200],
  unauthorizedCodes: [401],
}

/** 把用户配置归一化为运行时必填项齐全的配置 */
export function resolveEnvelopeConfig(config?: EnvelopeConfig | false): ResolvedEnvelope {
  if (config === false) return { ...DEFAULT_ENVELOPE, enabled: false }
  if (!config) return DEFAULT_ENVELOPE
  return {
    ...DEFAULT_ENVELOPE,
    ...config,
    successCodes: config.successCodes ?? DEFAULT_ENVELOPE.successCodes,
    unauthorizedCodes: config.unauthorizedCodes ?? DEFAULT_ENVELOPE.unauthorizedCodes,
  }
}

export type UnwrapResult<T> =
  { ok: true; data: T } | { ok: false; code: number; message: string; unauthorized: boolean }

/**
 * 业务信封解包:
 * - 未启用信封 / 响应无业务码字段:视为普通响应,原样透传(兼容裸对象 / JSON 数组);
 * - 命中 successCodes:解出 data 字段;
 * - 其余业务码:返回失败原因(错误文案 + 是否未授权)。
 */
export function unwrapEnvelope<T>(body: unknown, env: ResolvedEnvelope): UnwrapResult<T> {
  if (!env.enabled) return { ok: true, data: body as T }

  const record = (body ?? {}) as Record<string, unknown>
  const code = record[env.codeKey]
  if (code === undefined) return { ok: true, data: body as T }

  const numeric = Number(code)
  if (env.successCodes.includes(numeric)) {
    return { ok: true, data: record[env.dataKey] as T }
  }

  const rawMessage = record[env.messageKey]
  return {
    ok: false,
    code: numeric,
    message: typeof rawMessage === 'string' && rawMessage ? rawMessage : '系统错误',
    unauthorized: env.unauthorizedCodes.includes(numeric),
  }
}

/** 响应是否应跳过信封解包(blob / arraybuffer / stream / document 等原始体) */
export function isRawResponse(config: HttpRequestConfig): boolean {
  const responseType = config.responseType ?? 'json'
  return responseType !== 'json'
}
