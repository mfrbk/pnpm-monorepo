# @mzy1120/http · 多接口编排

> [← 返回主 README](../README.md) · 所属功能库 `@mzy1120/http`,传输基础见 [请求封装(HTTP 内核)](./http-request.md)

编排层(MultiApiTask / BatchProcessor / DataLoaderService)与传输、UI 完全无关:当一条数据需要拼装多个子接口时,把每个子接口封装成一个 `{ key, fetcher }` 配置;`fetcher(info, signal)` 返回 `Promise`,内部可用[请求封装](./http-request.md)的 `http.get` 等实现(`http.get<T>` 已解包信封、直接 resolve 业务载荷)。`DataLoaderService` 负责按 id 去重、取消后替换、限流并发;每个子接口结算都会触发一次 `onUpdate`,UI 可据此做细粒度进度展示与失败重试。

## 核心概念

- `ApiRequestConfig<TResult, TInfo>` — 单个子接口的配置 `{ key, fetcher }`;`fetcher(info, signal)` 需响应第二个参数 `signal`,以支持任务整体取消
- `SubApiState` — 单个子接口的运行快照:`status` / `data` / `error` / `retryCount` / `lastUpdated`
- `DataItemViewModel<TData, TInfo>` — 暴露给 UI 的完整视图:`status` / `progress(0-100)` / `subStates`(逐子接口)/ `data`(仅成功的子接口数据,按 key 读取)
- 状态枚举:
  - `TaskStatus`:`PENDING` / `RUNNING` / `PARTIAL_SUCCESS` / `SUCCESS` / `ERROR` / `CANCELLED`
  - `SubApiStatus`:`pending` / `success` / `error`

## 示例:DataLoaderService

```ts
import http from '@mzy1120/http'
import { DataLoaderService, TaskStatus, SubApiStatus } from '@mzy1120/http'
import type { DataItemViewModel } from '@mzy1120/http'

// 一行订单需要拼装多个接口:库存、价格、备注
interface OrderInfo {
  id: string
}
interface OrderVm {
  stock: number
  price: { amount: number; currency: string }
  remark: { note: string; updatedAt: number }
}

const loader = new DataLoaderService<OrderVm, OrderInfo>(5) // 并发上限 5 条数据

const loadOrders = (
  orders: OrderInfo[],
  render: (vm: DataItemViewModel<OrderVm, OrderInfo>) => void,
) =>
  loader.load(
    orders.map((info) => ({ id: info.id, info })), // load 按 id 去重,重复 load 会先取消旧任务
    (info) => [
      // 信封解包已就位:http.get<T> 直接 resolve 业务载荷;signal 支持随任务整体取消而 abort
      {
        key: 'stock',
        fetcher: (info, signal) => http.get<number>(`/orders/${info.id}/stock`, {}, { signal }),
      },
      {
        key: 'price',
        fetcher: (info, signal) =>
          http.get<{ amount: number; currency: string }>(
            `/orders/${info.id}/price`,
            {},
            { signal },
          ),
      },
      {
        key: 'remark',
        fetcher: (info, signal) =>
          http.get<{ note: string; updatedAt: number }>(
            `/orders/${info.id}/remark`,
            {},
            { signal },
          ),
      },
    ],
    (vm) => {
      // 每个子接口结算即回调一次:vm.status / vm.progress / vm.subStates / vm.data
      render(vm)
      if (vm.status === TaskStatus.PARTIAL_SUCCESS) {
        // 只重试失败的那个子接口(fire-and-forget),已成功的接口不重复请求
        Object.values(vm.subStates)
          .filter((s) => s.status === SubApiStatus.ERROR)
          .forEach((s) => loader.retrySubApi(vm.id, s.key))
      }
    },
  )

loadOrders([{ id: 'o1' }, { id: 'o2' }], updateRowView) // 逐条数据、逐子接口推进 UI
// 组件卸载时: loader.destroy() —— 取消全部在途请求并清空注册表
```

## API 一览

- `new DataLoaderService<TData, TInfo>(concurrency = 5)` — 顶层门面,限流并发处理多条数据
  - `load(list, configFactory, onUpdate)`:`list` 为 `{ id, info }[]`,同一批按 id 去重(后者覆盖),若该 id 已有在途任务会先取消再替换;`configFactory(info)` 返回该条数据的子接口配置数组;`onUpdate(vm)` 在每个子接口结算时触发
  - `retrySubApi(itemId, apiKey)` — 手动重试某条数据的某个子接口(fire-and-forget)
  - `destroy()` — 取消全部在途请求并清空任务注册表(组件卸载时调用)
- `MultiApiTask` — 单条数据多接口的执行任务(状态机 + 整体取消)
- `BatchProcessor` — 并发调度器(限流执行队列)
