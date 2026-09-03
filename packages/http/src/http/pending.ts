/**
 * 在途请求管理(防重复 + 统一取消)。
 *
 * 每个请求 key 对应一个 AbortController:
 * - 防重复(dedupe):同 key 在途时,新请求先 abort 旧请求再接管;
 * - 未开 dedupe 的重复请求:不接管、不取消,原样放行;
 * - 取消以「控制器身份」校验,旧请求完成回调不会误删已接替的新控制器。
 */
export interface PendingAcquireOptions {
  dedupe: boolean
}

export class PendingManager {
  private readonly map = new Map<string, AbortController>()

  /**
   * 登记一个请求,返回其取消控制器。
   * 返回 null 表示:同 key 在途且未开 dedupe,本次重复请求不参与管理。
   */
  acquire(key: string, options: PendingAcquireOptions): AbortController | null {
    const existing = this.map.get(key)
    if (existing) {
      // 同 key 在途:开 dedupe 则取消旧的并让位;否则放行重复请求
      if (!options.dedupe) return null
      existing.abort()
      this.map.delete(key)
    }
    const controller = new AbortController()
    this.map.set(key, controller)
    return controller
  }

  /**
   * 请求结束时释放登记。
   * 仅当 map 中仍是「本次请求的控制器」时才删除 —— 避免被 dedupe 接替的旧请求误删新请求。
   */
  release(key: string, controller: AbortController): void {
    if (this.map.get(key) === controller) this.map.delete(key)
  }

  /** 取消当前全部在途请求并清空登记 */
  abortAll(reason?: string): void {
    for (const controller of this.map.values()) controller.abort(reason)
    this.map.clear()
  }

  /** 当前在途请求数 */
  get size(): number {
    return this.map.size
  }
}
