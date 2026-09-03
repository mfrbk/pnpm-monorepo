/**
 * @mfr/http 统一入口
 *
 * 设计约定:
 * 1. 所有对外能力一律经本文件聚合导出,禁止跨层互相 import;
 * 2. 包内分两层,各自独立成目录,对应两大能力:
 *    - `http/`(方法一:封装 axios 请求):RESTful 语义化方法 / 业务信封解包 / 防重复 /
 *      并发熔断 / 全局反馈适配器 —— 一个 http 客户端内核;
 *    - `orchestrator/`(方法二:批量处理请求):MultiApiTask / BatchProcessor / DataLoaderService,
 *      提供细粒度进度 / 整体取消 / 单接口重试 / 批量限流;与传输、UI 无关,
 *      子请求由调用方用 http.get 等封装 fetcher 注入。
 * 3. 新增能力 = 在 src 下新建目录,并在本文件按「方法一 / 方法二」分块聚合导出;
 * 4. UI 提示 / token / loading / 401 登出均为「反馈适配器」,不内置任何 UI 库 ——
 *    宿主 app 经 http.setFeedback() 一行接入 antd / ElementPlus 等;
 * 5. 默认导出全局单例 http,多数项目直接使用;需要隔离的多实例场景用 createHttpClient()。
 *
 * 快速开始:
 * ```ts
 * import http from '@mfr/http'
 * http.setFeedback({ message: { error: (t) => message.error(t) }, getToken: () => localStorage.getItem('token') })
 * const users = await http.get<User[]>('/users', { page: 1 })
 * ```
 */

import { createHttpClient } from './http/client'
import { BizError, HTTP_STATUS_TEXT, isAxiosCancel, isBizError } from './http/error'
import { BatchProcessor } from './orchestrator/batch'
import { DataLoaderService } from './orchestrator/loader'
import { MultiApiTask } from './orchestrator/task'
import { SubApiStatus, TaskStatus } from './orchestrator/types'
import type { HttpClient } from './http/types'

// ── 方法一:封装 axios 请求 ──
export { createHttpClient, BizError, HTTP_STATUS_TEXT, isAxiosCancel, isBizError }
export * from './http/types'

// ── 方法二:批量处理请求 ──
export { MultiApiTask, BatchProcessor, DataLoaderService, SubApiStatus, TaskStatus }
export type {
  ApiRequestConfig,
  DataItemViewModel,
  SubApiData,
  SubApiState,
  TaskHandle,
} from './orchestrator/types'

/** 全局默认 http 客户端(方法一的开箱即用实例;复用同一 axios 实例 / 拦截器 / 适配器) */
export const http: HttpClient = createHttpClient()

export default http
