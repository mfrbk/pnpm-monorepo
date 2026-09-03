/**
 * 函数式工具:debounce / throttle / once / memoize
 */

export interface DebounceOptions {
  /** 是否在等待期开始时立即触发一次,默认 false */
  leading?: boolean
  /** 是否在等待期结束后触发最后一次,默认 true */
  trailing?: boolean
}

export interface DebouncedFunction<Args extends unknown[]> {
  (...args: Args): void
  /** 取消尚未执行的延迟调用 */
  cancel: () => void
  /** 立即执行挂起的调用(若有) */
  flush: () => void
}

/**
 * 防抖:高频触发时仅在停止触发 wait 毫秒后执行一次(可配合 leading 首触发)。
 * 返回带 cancel / flush 的防抖函数。
 */
export function debounce<Args extends unknown[], R>(
  fn: (...args: Args) => R,
  wait = 0,
  options: DebounceOptions = {},
): DebouncedFunction<Args> {
  const { leading = false, trailing = true } = options
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastArgs: Args | undefined

  const invoke = (): void => {
    if (lastArgs === undefined) return
    const args = lastArgs
    lastArgs = undefined
    fn(...args)
  }
  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const debounced = ((...args: Args): void => {
    lastArgs = args
    const callNow = leading && timer === undefined
    clearTimer()
    timer = setTimeout(() => {
      timer = undefined
      if (trailing) invoke()
    }, wait)
    if (callNow) invoke()
  }) as DebouncedFunction<Args>

  debounced.cancel = (): void => {
    clearTimer()
    lastArgs = undefined
  }
  debounced.flush = (): void => {
    clearTimer()
    invoke()
  }
  return debounced
}

export interface ThrottleOptions {
  /** 是否在节流周期开始时触发,默认 true */
  leading?: boolean
  /** 是否在节流周期结束时补充触发最后一次,默认 true */
  trailing?: boolean
}

export interface ThrottledFunction<Args extends unknown[]> {
  (...args: Args): void
  /** 取消挂起的 trailing 调用 */
  cancel: () => void
}

/**
 * 节流:wait 毫秒内至多执行一次;开启 trailing 时会补触发周期内的最后一次。
 * 返回带 cancel 的节流函数。
 */
export function throttle<Args extends unknown[], R>(
  fn: (...args: Args) => R,
  wait = 0,
  options: ThrottleOptions = {},
): ThrottledFunction<Args> {
  const { leading = true, trailing = true } = options
  let lastInvokeAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let pendingArgs: Args | undefined

  const invoke = (args: Args): void => {
    pendingArgs = undefined
    lastInvokeAt = Date.now()
    fn(...args)
  }
  const runPending = (): void => {
    timer = undefined
    if (pendingArgs !== undefined) invoke(pendingArgs)
  }

  const throttled = ((...args: Args): void => {
    const now = Date.now()
    const remaining = wait - (now - lastInvokeAt)
    if (remaining <= 0) {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      if (leading) invoke(args)
    } else if (trailing) {
      pendingArgs = args
      if (timer === undefined) timer = setTimeout(runPending, remaining)
    }
  }) as ThrottledFunction<Args>

  throttled.cancel = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    pendingArgs = undefined
  }
  return throttled
}

/** 单次执行:同一函数无论调用多少次,仅首次真正执行并缓存返回值 */
export function once<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R {
  let called = false
  let result!: R
  return (...args: Args): R => {
    if (!called) {
      result = fn(...args)
      called = true
    }
    return result
  }
}

/**
 * 记忆化:以参数为键缓存函数结果。
 * @param resolver 可选的自定义缓存键生成器,默认以参数序列化结果作为键
 */
export function memoize<Args extends unknown[], R>(
  fn: (...args: Args) => R,
  resolver?: (...args: Args) => string,
): (...args: Args) => R {
  const cache = new Map<string, R>()
  return (...args: Args): R => {
    const key = resolver
      ? resolver(...args)
      : args.map((arg) => `${typeof arg}:${String(arg)}`).join('|')
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const value = fn(...args)
    cache.set(key, value)
    return value
  }
}
