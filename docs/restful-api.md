# RESTful API 对接规范

> [← 返回主 README](../README.md) · 本仓库 `@mzy1120/http` 即按此语义封装,见 [http-request.md](./http-request.md)

RESTful API 以**资源**为中心:URL 唯一标识资源,用标准 HTTP 方法做无状态通信。前后端按统一约定交互,便于设计、联调与维护。

## 核心原则

- **资源导向**:一切数据视为资源,名词复数表示(`/users`、`/orders`)
- **无状态**:每次请求独立,携带全部必要信息(如 Token),服务器不存会话
- **统一接口**:标准 HTTP 方法操作资源
- **前后端分离**:前端负责展示、后端负责业务
- **可缓存**:支持 HTTP 缓存提升性能

## HTTP 方法与语义

| 方法   | 用途         | 幂等性     | 示例                |
| ------ | ------------ | ---------- | ------------------- |
| GET    | 获取资源     | 幂等       | `GET /users/123`    |
| POST   | 创建资源     | 非幂等     | `POST /users`       |
| PUT    | 全量更新资源 | 幂等       | `PUT /users/123`    |
| PATCH  | 部分更新资源 | 通常非幂等 | `PATCH /users/123`  |
| DELETE | 删除资源     | 幂等       | `DELETE /users/123` |

> **幂等性**:同一请求执行多次与执行一次结果相同。GET / PUT / DELETE 幂等,POST 不幂等。

## URL 设计

- **资源命名**:名词复数、全小写、多词用连字符:
  ```text
  /users              # 用户集合
  /users/123          # 特定用户
  /users/123/orders   # 用户订单(子资源)
  ```
- **查询参数**:用于过滤 / 分页 / 排序,不改资源地址:
  ```text
  /users?page=2&per_page=20
  /users?status=active&sort=created_at&order=desc
  /users?q=john
  ```
- **版本控制**:优先路径版本 `/api/v1/users`、`/api/v2/users`
- **禁止在 URL 中放动词**(如 `/getUser`、`/deleteUser`):动作交给 HTTP 方法表达

## HTTP 状态码

| 状态码 | 含义                  | 典型场景                |
| ------ | --------------------- | ----------------------- |
| 200    | OK                    | GET 成功                |
| 201    | Created               | POST 创建成功           |
| 204    | No Content            | DELETE 成功,无返回体    |
| 400    | Bad Request           | 请求参数格式错误        |
| 401    | Unauthorized          | 未认证(缺 / 无效 Token) |
| 403    | Forbidden             | 已认证但无权限          |
| 404    | Not Found             | 资源不存在              |
| 409    | Conflict              | 资源冲突(如重复创建)    |
| 422    | Unprocessable Entity  | 参数校验失败            |
| 429    | Too Many Requests     | 请求频率超限            |
| 500    | Internal Server Error | 服务器内部错误          |

## 统一响应格式

前后端约定统一信封(与 `@mzy1120/http` 默认解包规则一致:`{ code, message, data }`):

**成功**

```json
{ "code": 200, "message": "success", "data": { "id": 123, "name": "John Doe" } }
```

**错误**(字段级错误放 `errors`)

```json
{
  "code": 422,
  "message": "参数校验失败",
  "errors": [{ "field": "email", "message": "邮箱格式不正确" }]
}
```

**分页**(分页信息放 `meta`)

```json
{ "code": 200, "data": [...], "meta": { "page": 2, "per_page": 20, "total": 1230 } }
```

## 安全规范

- 强制 HTTPS;鉴权用 JWT / OAuth2,经 `Authorization` 请求头传 Token
- 后端校验入参类型 / 长度 / 格式;敏感字段(手机号、身份证等)脱敏
- 限流防恶意请求,可用 `X-RateLimit-*` 响应头告知客户端

## 前端调用示例(axios)

```ts
// GET:携带 Token,query 走 params
const res = await axios.get('/api/v1/users', {
  headers: { Authorization: `Bearer ${token}` },
  params: { page: 1, per_page: 20 },
})

// POST / PUT / DELETE:载荷走 body / 路径传 id
await axios.post('/api/v1/users', { name: 'John', email: 'john@example.com' })
await axios.put('/api/v1/users/123', { name: 'Jane' })
await axios.delete('/api/v1/users/123')
```

> 用本仓库 [@mzy1120/http](./http-request.md) 更省事:语义化方法 + 自动解信封,泛型直达业务数据,无需手写 `res.data` 与鉴权逻辑。

## 速查

| 维度   | 要点                                                     |
| ------ | -------------------------------------------------------- |
| 理念   | 资源导向 + 无状态 + 统一接口                             |
| URL    | 名词复数、小写连字符、禁止动词                           |
| 方法   | GET 查 / POST 增 / PUT 全量改 / PATCH 局部改 / DELETE 删 |
| 状态码 | 2xx 成功 / 4xx 客户端错 / 5xx 服务端错                   |
| 格式   | JSON + 统一响应结构                                      |
| 安全   | HTTPS + JWT / OAuth2 + 限流                              |
| 版本   | 路径版本 `/api/v1/`                                      |
