# Server State 分水岭:数据是缓存,不是状态

> [← 返回总纲](./README.md) · 收官篇:为什么请求返回的数据"根本不该进 store",以及 TanStack Query 怎么把它当缓存管

前八章都在回答"**客户端状态**该怎么存、怎么变、怎么传导"。但如果只看 store,你会错过 2020s 状态管理最重要的一次认知升级:**大量被塞进 store 的东西——接口返回、分页列表、用户资料——根本不是"状态",而是"远端真实数据的本地缓存"。** 把它们交给通用 store,等于亲手写一套烂缓存:手搓 loading/error、手搓失效、手搓去重、再一个个踩乱序返回的坑。

本篇讲清这条分水岭:先给 Server State 正名,再用 **TanStack Query** 的缓存模型讲清"数据该被怎么管",最后给出它与你心爱的 store **怎么协作的边界**。

## 一、翻转心智:Server State 的四条"反状态"特征

一份状态存储通常假设"数据由我拥有、我决定何时改"。服务端数据恰好处处相反:

| 客户端状态           | 服务端数据(Server State)                       |
| -------------------- | ---------------------------------------------- |
| 数据真源在**本地**   | 真源在**远端**,本地只是副本                    |
| 谁来改由**我**说了算 | 远端可能**随时被别人改**——我无法单方面"改对"它 |
| 变更即刻生效         | 变更要等**网络往返**,天然异步                  |
| 无需怀疑是否过期     | 我看到的永远是**某一刻的快照**,天然会 stale    |

这四个"反状态"特征决定了它的正确解法不是"放进全局变量再手动同步",而是**缓存管理**:回答"这份数据过期没有、要不要重新拉、被谁共享、什么时候该扔"。

## 二、症状学:把服务端数据塞进 store,你会亲手写出一套烂缓存

用通用 store 管理请求数据,典型的五宗罪(几乎人人踩过):

1. **手搓三态**:每份数据配三个字段 `data / loading / error`,且到处重复;
2. **手搓失效**:一个地方改了,所有读到旧值的地方都不同步——于是发明 `refreshFlag` 或重新 mount;
3. **手搓去重**:两个组件要同一份数据,发两个请求(或者为了省,又引入单例 promise);
4. **没有过期概念**:数据一进 store 就成了"永远新鲜",聚焦切回来、后台数据变了都不会再拉;
5. **乱序灾难**:快速翻页时,慢的旧响应晚到,覆盖了新页的新数据。

**结论不是"再小心一点",而是换工具**:查询缓存把以上五件事内建成默认行为。这也是为什么 TanStack Query / SWR 在 2020s 会成为标配。

## 三、TanStack Query 的缓存心智模型

它的核心是 `query-core`(又一个**框架无关内核** + React/Vue/Solid 各自适配层,架构思路与 Zustand 的 vanilla 内核异曲同工)。

### 3.1 最小单元:Query = 唯一 key + 一段缓存 + 一段状态

```ts
useQuery({ queryKey: ['posts', page], queryFn: () => fetchPosts(page) })
```

- **`queryKey`** 是缓存的地址:序列化后哈希,同一 key 的数据/订阅/请求去重全部以此为锚;key 变 = 换一块新缓存;
- 每次请求产出的**数据**(data)落在 `QueryCache` 里,是**共享的**——多个组件用同一 key,读同一份缓存、只发一次请求;
- 每个使用处是一个 **`QueryObserver`**,它观察该 query 并决定组件是否重渲染。`query-core` 里查询对象同时维护两个互不混淆的维度:

```
status(数据生命周期)      fetchStatus(网络动作生命周期)
  pending  →  success            idle
              error              fetching / 后台重新拉取(fetching)
                                 paused(离线被暂停)
```

**关键差异:status 与 fetchStatus 解耦**。后台刷新时数据已在(不是 pending),只是 `fetchStatus: 'fetching'` 且**旧 data 继续渲染、不闪屏**——这正是"把请求丢进 store"写不出来的体验。

### 3.2 两把"时间锁":staleTime 与 gcTime

query-core 里的两段内存各有归属:

|               | 管什么                                   | 默认                | 含义                              |
| ------------- | ---------------------------------------- | ------------------- | --------------------------------- |
| **staleTime** | 这份缓存算"新鲜"还是"已过期(stale)"      | **0**(一拿到就过期) | 过期 = 需要被后台刷新(不是要清空) |
| **gcTime**    | 这份无人订阅的缓存还能**在内存里留多久** | **约 5 分钟**       | 过时就回收(GC),释放内存           |

`retry` 默认 **3 次**(服务端 0 次,见 query-core `retryer` 源码 `config.retry ?? (isServer() ? 0 : 3)`)。默认 `staleTime: 0` 意味着数据**几乎总是 stale**,于是常见触发点都会做**后台静默刷新**而不打断用户:

- 组件重新挂载(`refetchOnMount`)、窗口重新聚焦(`refetchOnWindowFocus`)、网络重连(`refetchOnReconnect`)默认开启;
- 你可以把 `staleTime` 调大(如 30s)换来"短时间内不重复请求"。

> 直觉:**staleTime 是"我想多信任缓存多久",gcTime 是"没人看了之后缓存还能活多久"**。一个管刷新频率,一个管内存回收,别混。

### 3.3 去重、失效与观察者计数

- **并发去重**:同一 key 同时有多个订阅者发起请求时,共享同一个 in-flight promise;`QueryCache` 里同一 key 只有一份数据;
- **后台刷新不重置 data**:`fetchStatus` 变 fetching、`status` 仍是 success——旧数据顶着,新数据到了再换,不会白屏;
- **引用与失效原语**:`invalidateQueries({ queryKey })` 把匹配的缓存标记为 stale 并触发重拉,`setQueryData` 直接写缓存(乐观更新用),`removeQueries` 驱逐缓存;`QueryCache.remove` 前会做观察者检查(无订阅者且空闲才真的清除)——这就是 gc 的入口。

## 四、写入也要 Query:useMutation + 乐观更新 + invalidate

读用 Query,写用 **Mutation**——它提供独立的 `mutate / isPending / isError` 状态,并与缓存联动:

```ts
const addTodo = useMutation({
  mutationFn: (text) => api.post('/todos', { text }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['todos'] }), // 写成功后让读缓存作废重拉
})
```

更强的是**乐观更新**:先在 `setQueryData` 里把目标 query 改成"即将成功的样子"(UI 立刻反映),`onError` / `onSettled` 里回滚或对账:

```ts
useMutation({
  mutationFn: api.toggleTodo,
  onMutate: async (id) => {
    await queryClient.cancelQueries({ queryKey: ['todos'] }) // 暂停在途读取
    const prev = queryClient.getQueryData(['todos']) // 备份
    queryClient.setQueryData(['todos'], (old) =>
      old?.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    )
    return { prev }
  },
  onError: (_e, _id, ctx) => queryClient.setQueryData(['todos'], ctx.prev), // 回滚
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }), // 对账
})
```

这套"取消在途请求 → 本地改写 → 失败回滚 → 成功后失效"正是手写 store 永远写不干净的样板。

## 五、与 store 的协作边界:什么进 store,什么进 Query

**分界原则一句话**:服务端数据进 Query 缓存;**客户端交互态**进 store。交互态里属于"某个具体组件"的(草稿、开关)连 store 都别进,见下表:

| 数据                                                         | 归属                           | 说明                            |
| ------------------------------------------------------------ | ------------------------------ | ------------------------------- |
| 接口返回 / 列表 / 详情 / 下拉选项                            | **Query 缓存**                 | 远端真源,缓存 + 失效            |
| 已选中项、筛选条件、分页、表单**值**                         | 本地 UI 态(组件内)或 store     | 是"用户的交互意图",不是远端数据 |
| 全局会话 / 主题 / 权限                                       | **store(Zustand / Pinia)**     | 纯客户端全局,Store 派主场       |
| "已提交但待对账"的乐观数据                                   | Query 的 optimistic 更新       | 属缓存一致性,不属 store         |
| 需要被多个组件共享的**服务端派生**(如"当前用户可见按钮集合") | Query 之上做 selector / getter | 从缓存派生,不要复制一份进 store |

**判定练习**(每一份想塞进 store 的数据都问一遍):_它是不是远端的缓存副本?远端是不是真源?会不会失效?_ 三个"是" → 它该住 QueryCache,住进 store 就会长成第二节那套烂缓存。

## 六、什么时候"不用" TanStack Query 也合理

不是所有项目都要上查询库。信号不足时可以只用框架取数 + store:

- 一次性 GET、SSR 直出后不再交互、数据共享面极窄、无缓存复用诉求;
- 需要大量**非 REST**(WebSocket / 实时推送主导)时,Query 的"请求-缓存"模型收益打折。

一旦出现这些信号就值得上:**多组件共享同一数据、写后要刷新、乐观交互、多 tab/聚焦刷新、失败重试**——任何一个出现,查询库带来的都是你原本要手写的一套基础设施。SWR 心智相同、更轻;TanStack Query 全量(缓存 GC / infinite query / 多框架)。

## 七、收束全系列

回到总纲的坐标系:本地态进组件、客户端全局进 Store 派(Zustand / Pinia)、服务端态进查询缓存、URL 态进地址栏——**四类各归其位,状态管理八成的痛苦消失**。再把八篇合一:

```
一个状态库要回答的六个问题(landscape 的解剖问题单)
  ├─ Zustand 的答案:自建订阅 + React 桥 + 中间件(zustand-core / react / middleware)
  ├─ Pinia 的答案:Vue 响应式外包 + 插件(zustand-core / advanced 的镜像)
  ├─ 差异即知识:同范式双引擎对照(contrast)
  └─ 边界即智慧:服务端数据不进 store(本篇)
```

**最后一句**:状态库没有银弹,银弹是**把每种状态放进它该去的机制**——而读透 Zustand × Pinia 这对双引擎,正是为了让你在任何一套 store 面前都能一眼看穿:它存什么、怎么传、边界在哪。

> 版本:`@tanstack/query-core@^5`(默认值如 staleTime 0 / retry 3 摘自发行源码与文档);API 细节以 tanstack.com/query 为准。
