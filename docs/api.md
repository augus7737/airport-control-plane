# API

更新时间：2026-09-26
适用范围：当前已实现的全部 HTTP 接口（`src/server.js` 内联路由块 + `src/http/routes/` 17 个模块）；业务路由在 `src/http/routes/<namespace>.js`，鉴权、`/healthz`、bootstrap 脚本、订阅、sing-box 制品与静态资源等管线接口在 `src/server.js`。本文只描述已经存在的行为；路线图中的能力见 `docs/project-assessment-and-roadmap.md`。

## Conventions

- 数据格式统一 JSON，字段命名 `snake_case`。
- 集合响应统一 `{ "items": [...] }`。
- 创建成功返回 `201`，多数更新返回 `200`，异步任务受理返回 `202`。
- 错误响应统一带 `error` 机器码：
  - `400 { error: "validation_failed", details: ["..."] }` 字段校验失败
  - `400 { error: "bad_request", message }` JSON 解析失败或业务前置校验失败
  - `400 { error: "not_found", message }` 目标记录不存在（部分分支返回 `404`）
  - `403 { error: "bootstrap_token_missing|bootstrap_token_inactive|bootstrap_token_expired|bootstrap_token_exhausted" }`
  - `404 { error: "not_found" }`
  - `409 { error: "conflict" }` 引用占用、重复名称、密钥已存在、诊断并发冲突
  - `413 { error: "payload_too_large" }`
  - `500 { error: "internal_server_error", message: "internal server error" }` 全局异常边界
- 请求体上限 1 MiB，超限连接立即销毁（`src/utils/http.js`）。
- 无法解析的 `Host` 头会回退到 `localhost`，不反射任意主机名（`src/utils/request-handler.js`）。
- 当前**没有** `/readyz`，也**没有**服务端登录限流；两者记录在 `docs/stability-roadmap.md`。

## Route file map

业务路由按命名空间一文件放在 `src/http/routes/`，由 `src/http/routes/index.js` 按下列顺序注册；命中判定是 `reply.headersSent || reply.writableEnded`，因此**URL 前缀不相交的模块之间顺序无关**，同一前缀内的顺序仍然有意义（`/nodes/:id` 系在 `/nodes/manual`、`/nodes/register` 之前）。

| 文件 | URL 前缀 |
| --- | --- |
| `platform.js` | `/api/v1/platform-context`、`/api/v1/platform/*` |
| `nodes.js` | `/api/v1/nodes*` |
| `tasks.js` | `/api/v1/tasks*` |
| `probes.js` | `/api/v1/probes` |
| `metrics.js` | `/api/v1/metrics*` |
| `diagnostics.js` | `/api/v1/diagnostics` |
| `bootstrap-tokens.js` | `/api/v1/bootstrap-tokens*` |
| `access-users.js` | `/api/v1/access-users*` |
| `system-templates.js` | `/api/v1/system-templates*`、`/api/v1/system-template-releases` |
| `system-users.js` | `/api/v1/system-users*`、`/api/v1/system-user-releases` |
| `proxy-profiles.js` | `/api/v1/proxy-profiles*` |
| `node-groups.js` | `/api/v1/node-groups*` |
| `providers.js` | `/api/v1/providers*` |
| `costs.js` | `/api/v1/costs/*` |
| `config-releases.js` | `/api/v1/config-releases` |
| `operations.js` | `/api/v1/operations*` |
| `shell.js` | `/api/v1/shell/sessions*` |

留在 `src/server.js` 的是请求管线本身：`/api/v1/auth/*`、鉴权门禁、`/healthz`、`/bootstrap.sh`、`/bootstrap/enroll.sh`、订阅 `/sub/:token`、`/api/v1/artifacts/sing-box/*`、静态资源与 `404`。并行开发约束见 `docs/parallel-development.md`。

路径段一律经 `safeDecodePathSegment` 解码：百分号编码非法（`/%`、`%zz`）时返回 `400 { error: "bad_request" }`，不再抛 `URIError` 变成裸 500。

## Authentication

控制面页面与 operator API 使用同源 session cookie；匿名只保留给 bootstrap 注册、bootstrap 完成回报、`/healthz`、`/bootstrap.sh`、`/bootstrap/enroll.sh`、订阅 `/sub/:token` 和 sing-box 制品下载。

- cookie 名默认 `airport_operator_session`（可用 `CONTROL_PLANE_SESSION_COOKIE_NAME` 覆盖），`Path=/; HttpOnly; SameSite=Lax; Max-Age=TTL`。
- 会话滑动续期：每次已鉴权请求都会重新 `Set-Cookie`，因此活跃浏览器不会因为 TTL 到期被踢出。
- `CONTROL_PLANE_SESSION_SECURE=true` 或请求带 `x-forwarded-proto: https` 时追加 `Secure`。
- 未鉴权访问 `/api/v1/*` 返回 `401 { error: "unauthorized", login_url }`；访问 HTML 页面返回 `302` 到 `/login.html?next=...`。
- 会话持久化在 `data/operator-sessions.json`，普通重启不需要重新登录；过期会话在启动时清理。
- 服务端未配置密码时会生成随机密码并输出 WARN 日志，不会使用固定默认口令。

Operator auth env vars:

- `CONTROL_PLANE_AUTH_USERNAME`（别名 `OPERATOR_USERNAME`、`CONTROL_PLANE_USERNAME`，默认 `admin`）
- `CONTROL_PLANE_AUTH_PASSWORD`（别名 `OPERATOR_PASSWORD`、`CONTROL_PLANE_PASSWORD`）
- `CONTROL_PLANE_SESSION_COOKIE_NAME`
- `CONTROL_PLANE_SESSION_TTL_MS`（默认 12 小时，下限 60 秒）
- `CONTROL_PLANE_SESSION_SECURE`
- `CONTROL_PLANE_SESSION_REFRESH_PERSIST_INTERVAL_MS`（默认 30000）
- `CONTROL_PLANE_LOGIN_GUARD`（默认 `true`；`false` / `0` / `off` 可整体关闭失败计数）
- `CONTROL_PLANE_LOGIN_WINDOW_MS`（失败计数窗口，默认 300000 = 5 分钟）
- `CONTROL_PLANE_LOGIN_MAX_FAILURES`（窗口内触发锁定的失败次数，默认 10）
- `CONTROL_PLANE_LOGIN_LOCKOUT_MS`（锁定时长，默认 300000 = 5 分钟）

## Auth

### `GET /api/v1/auth/session`

```json
{
  "authenticated": true,
  "session": {
    "id": "48ce7e6d-3cb7-4b4d-b4cb-0cfa23f6cdd6",
    "username": "admin",
    "created_at": "2026-09-22T11:20:00.487Z",
    "last_seen_at": "2026-09-22T11:20:00.578Z",
    "expires_at": "2026-09-22T23:20:00.578Z"
  },
  "operator": { "username": "admin", "display_name": "admin", "uses_fallback_credentials": false },
  "auth": { "mode": "session_cookie", "login_url": "/login.html" }
}
```

### `POST /api/v1/auth/login`

公开。请求 `{ "username": "admin", "password": "...", "next": "/nodes.html" }`，成功写入 cookie 并返回 `{ authenticated, session, next_url }`；凭据错误返回 `401 { error: "invalid_credentials" }`。

失败计数与锁定（`src/domain/auth/login-guard.js`）：按 **用户名桶 `u:<username>`** 与 **客户端 IP 桶 `ip:<remote>`**（`socket.remoteAddress`，去掉 `::ffff:` 前缀；不读 `x-forwarded-for`）两组独立计数，任一桶命中即拒。窗口内累计 `CONTROL_PLANE_LOGIN_MAX_FAILURES` 次失败后锁定该桶 `CONTROL_PLANE_LOGIN_LOCKOUT_MS`，锁定与窗口内失败都会拒：

```json
{ "error": "too_many_attempts", "message": "失败次数过多，请在 293 秒后重试。", "retry_after_seconds": 293 }
```

实际响应是 `429` + 同名 `Retry-After` 头（`src/server.js:3469-3477`；`invalid_credentials` 走 `401`，`retry_after_seconds` 为 `null`）；桶表另有 `maxTrackedKeys` 上限（默认 2000）防内存膨胀。成功登录清空该次用到的两个桶。

### `POST /api/v1/auth/logout`

清除当前会话 cookie，返回 `{ "authenticated": false, "message": "已退出登录。" }`。

## Health and enrollment assets

### `GET /healthz`

公开。`{ "ok": true, "service": "airport-control-plane", "time": "2026-09-22T..." }`。仅表示进程存活。

### `GET /bootstrap.sh`

公开。返回当前控制面的接入脚本。

### `GET /bootstrap/enroll.sh?token=...`

公开。返回一次性接入脚本（令牌已内联）；令牌缺失或不合法返回 `403` 文本说明。

### `GET /api/v1/artifacts/sing-box/:version/:target`

公开。下载控制面镜像仓中的 sing-box 二进制（gzip）。目标平台不存在返回 `404`。
路径段百分号编码非法，或解码后的 `version` 让产物路径解析到 `data/artifacts/sing-box` 之外（`..%2f` 一类）返回 `400 bad_request`——该路由匿名可访问，version 参与拼路径，必须锁在目录内。

## Nodes

### `GET /api/v1/nodes`

返回全量节点。前端一次拉取后在本地派生筛选与拓扑。

### `GET /api/v1/nodes/:id`

返回 `200 { node }`（nodeStore 原始记录，与列表同一口径、无 serializer）。非法百分号编码 → `400 bad_request`；未建档 → `404 not_found`。
注意 `manual`、`register` 不是保留 id 之外的字面量：`GET /api/v1/nodes/manual` 走本接口并返回 `404`，真实的 `POST /api/v1/nodes/manual` 由后面的精确 pathname 分支处理。

### `POST /api/v1/nodes/register`

公开，bootstrap token 校验。创建或更新节点，返回 `{ node, bootstrap, actions[] }`。

匹配既有节点（`findExistingBootstrapNode`）按以下顺序，命中即复用同一行：

1. `fingerprint` 精确命中索引；
2. `facts.machine_id` 在 `source: bootstrap` 行中唯一命中；
3. `facts.primary_mac` 在 `source: bootstrap` 行中唯一命中；
4. `hostname` **且**任一地址（`public_ipv4` / `public_ipv6` / `private_ipv4`）在 `source: bootstrap` 行中唯一命中；
5. 同上条件在 `source: manual` 行中唯一命中 → **收养该手工壳**：`source` 翻成 `bootstrap`、`fingerprint` 与 facts 填实，`commercial`（价格/备注）与 `management` 映射原样保留；
6. 兜底按 legacy 签名（`hostname|arch|kernel|cpu|memory|disk`）匹配 bootstrap 行，再用地址收窄，仍多义则取最近活动的一行。

```json
{
  "bootstrap_token": "token",
  "fingerprint": "sha256:fingerprint",
  "facts": {
    "hostname": "debian-hkg-01",
    "os_name": "Debian GNU/Linux",
    "os_id": "debian",
    "os_family": "debian",
    "os_version": "12",
    "arch": "x86_64",
    "kernel_version": "6.1.0",
    "public_ipv4": "203.0.113.10",
    "public_ipv6": "2408:xxxx::10",
    "public_ipv4_source": "cip.cc",
    "public_ipv4_location": "中国香港",
    "public_ipv4_owner": "Example Transit",
    "private_ipv4": "10.0.0.10",
    "cpu_cores": 1,
    "memory_mb": 512,
    "disk_gb": 10,
    "ssh_port": 22
  },
  "labels": { "provider": "example-cloud", "region": "hkg" }
}
```

Notes:

- `facts.public_ipv4` / `public_ipv6` 描述控制面应当连入的 **SSH 入口地址**，不是节点出站 IP。
- NAT / LXC / 端口映射场景必须显式上报外部入口：`ssh_port` 是控制面可达的映射端口，容器内部 `sshd` 端口写入 `management.ssh_internal_port`。
- 节点没有显式 `ssh_port` 时控制面使用默认端口 `22`；`bootstrap.sh` 除非传 `--ssh-port`，否则保留机器现有 `sshd` 端口。
- `cpu_cores` / `memory_mb` / `disk_gb` / `ssh_port` 缺失或为 `null` 都算"未上报"，只有给了非数值/负数才 `400 validation_failed`；因此精简环境（缺 `awk`、读不到 `/proc/meminfo`）也能只报 hostname + 地址完成注册。
- 初始化模板按 `os_name` / `os_id` / `os_family` / `os_version` 自动选择 `alpine-base`、`debian-base`、`rhel-base`；文本都识别不出时兜底 `alpine-base`，所以 OS 事实必须由节点自报而不是靠人工壳猜。
- 已 `active` 的 bootstrap 节点再次注册只刷新 facts，不会重排初始化任务；**收养的手工壳例外**——它的高状态来自人工录入，首次注册一定会建初始化任务（trigger `bootstrap_register`）。
- `actions[].install_ssh_key` 只在平台已有可用公钥时出现。

### `POST /api/v1/nodes/manual`

手工录入资产台账，`status` 默认 `active`。请求字段与 `PATCH /nodes/:id/assets` 同一套（见下）。

### `PATCH /api/v1/nodes/:id/assets`

更新自动注册或手工录入节点的资产与链路字段。

```json
{
  "hostname": "alpine-hkg-04",
  "public_ipv4": "203.0.113.88",
  "public_ipv6": "2408:xxxx::88",
  "private_ipv4": "10.0.0.88",
  "ssh_port": 2222,
  "provider": "Vultr",
  "region": "HKG",
  "role": "edge",
  "provider_id": "provider_xxx",
  "expires_at": "2026-05-20",
  "auto_renew": true,
  "billing_cycle": "月付",
  "billing_amount": 6.5,
  "billing_currency": "USD",
  "bandwidth_mbps": 300,
  "traffic_quota_gb": 2000,
  "traffic_used_gb": 320,
  "access_mode": "relay",
  "route_direction": "international_egress",
  "entry_region": "中国大陆",
  "entry_host": "203.0.113.88",
  "entry_port": 8443,
  "internal_host": "10.0.0.41",
  "internal_port": 443,
  "relay_node_id": "node_hkg_01",
  "relay_label": "alpine-hkg-01",
  "relay_region": "HKG",
  "route_note": "中国大陆 -> 香港中转 -> 日本落地",
  "note": "自动注册后补充的资产信息"
}
```

字段语义：

- `public_ipv4` / `public_ipv6` / `private_ipv4` / `ssh_port`：管理链路的真实入口，改写后 IP 来源记为 `manual_override`。
- `access_mode`：`direct` 或 `relay`（业务链路语义）。
- `route_direction`：`international_egress` / `return_to_china` / `regional_transit`，缺省时按入口与落地地域推断，并在解析结果里标注 `route_direction_source`。
- `entry_host` / `entry_port`：用户流量真实公网入口；`internal_host` / `internal_port`：节点内部监听。**两者必须分开**，订阅只使用前者。
- `relay_node_id` / `relay_label` / `relay_region`：单级中转描述。
- `billing_cycle` 接受 `月付/季付/年付/周付/日付/小时付/一次性` 及英文别名；`billing_currency` 为 3–10 位大写代码，默认 `CNY`。

### `PATCH /api/v1/nodes/:id/labels`

自定义标签的唯一写入口，节点其余字段不受影响：

```json
{ "labels": { "batch": "round-2", "role": null } }
```

- 语义是**按键合并**：出现的键写入或覆盖，值为 `null` 或空白字符串即删除该键；不能整份替换标签集。
- `PATCH /:id/assets` 只能改 `provider` / `region` / `role` 这三个已知键，自定义键只能通过本接口读写。
- `region` 走共享地域字典（`东京` → `日本`），与注册和列表口径一致。
- 校验失败返回 `400 validation_failed`：`labels` 必须是对象（不接受数组）、单次最多 20 个键、键名去掉首尾空白后非空且 ≤ 40 字符不含换行、值只能是字符串或 `null` 且 ≤ 100 字符。
- 未建档 `404 not_found`，非法百分号编码 `400 bad_request`；成功返回 `200 { node }`。

### `POST /api/v1/nodes/:id/init`

手动重跑初始化模板，返回 `201`。请求 `{ "template": "debian-base" }`，或 `{ "system_template_id": "...", "template_snapshot": { "script_name": "...", "script_body": "..." } }`；省略时按节点 OS 事实选择内置基线。

> 该动作会重写节点上的 `/etc/airport/node.env` 并可能重启 `sshd`，前端已加二次确认。

### `POST /api/v1/nodes/:id/probe`

手动触发一次真实探测，返回 `201`。请求 `{ "probe_type": "full_stack" }`。

支持的 `probe_type`：

- `ssh_auth`：TCP 连通 + 非交互 SSH 公钥接管
- `business_entry_tcp`：业务公网入口 TCP 可达
- `relay_upstream_tcp`：从中转机验证到落地的上游连通
- `full_stack`：默认，按节点角色依次执行上述适用阶段

响应包含 `task`、`node`、`probe`、`summary`、`transport`、`capability`。旧的 `tcp_ssh` 类型已不存在，仅在历史探测记录里作为标签保留。

### `POST /api/v1/nodes/:id/diagnostics`

请求 `{ "profile": "light" }`（或 `deep`），返回 `202 { task, diagnostic }`。同一节点已有诊断、或同一公网入口宿主已有深度诊断时返回 `409`。

### `GET /api/v1/diagnostics?node_id=`

返回节点质量诊断记录（`data/diagnostics.json`，上限 200 条）。

### `DELETE /api/v1/nodes/:id`

删除节点并级联清理其任务、探测、诊断、操作与节点组引用，返回 `{ summary }`。

## Tasks and probes

### `GET /api/v1/tasks`

返回真实任务流。任务状态 `new|queued|running|success|failed|partial`；类型 `init_alpine|probe_node|node_diagnostic|publish_proxy_config|apply_system_template|apply_system_users`；触发方式含 `bootstrap_register|bootstrap_refresh|bootstrap_auto_probe|manual_probe|manual_diagnostic|manual_retry|manual_release|scheduled_probe`。

> `init_alpine` 是历史任务类型名，实际覆盖 Alpine / Debian / Ubuntu / RHEL 家族。

### `POST /api/v1/tasks/:id/bootstrap-complete`

公开（需 `bootstrap_token`）。`bootstrap.sh` 写入公钥后回报，触发初始化；只有初始化真正成功后才自动衔接自动首探。重复回调同一任务不会重复创建首探任务（原子认领 + owner 终态保护）。

### `GET /api/v1/probes?node_id=`

返回最近探测结果（上限 500 条）。顶层 `latency_ms` 是该探测类型的主耗时，必须结合 `latency_source`（`management_tcp` / `management_ssh_e2e` / `business_entry_tcp` / `relay_upstream_tcp` / `ssh_auth`）判断口径；SSH 接管耗时不代表业务网络 RTT。`reason_code` 与失败阶段的中文口径统一在 `public/js/shared/probe-formatters.js`。

## Metrics

### `POST /api/v1/metrics/collect`

请求体 `{ "node_ids": [] }`。空数组表示"全部 `active|degraded|failed` 节点"；含未知 id 时整次请求 `400 { error: "validation_failed" }`，不做部分执行。响应 `{ collected_at, total, success, failed, samples[] }`，**采集失败也返回 `200`**，失败以 `samples[].status != "success"` 表达（不混成 HTTP 层错误，否则页面分不清"没数据"和"节点离线"）。每台节点是一次 SSH `sh -s` 管道执行 `scripts/node/metrics-collect.sh`，只读、不装常驻 agent；口径全部走 cgroup v2（容器内 `/proc/meminfo` 与 `nproc` 是宿主值）。

### `GET /api/v1/metrics?node_id=&limit=`

返回 `{ buckets, samples, failures, scheduler }`。`buckets` 是按节点、按小时聚合的结果（`sample_count`、`*_avg`/`*_max`、`oom_kill_seen`、`net_rx_bytes`/`net_tx_bytes`）；计数型指标的增量需要同一小时内至少两个点，**只有一个样本时增量是 `null` 而不是 `0`**。`limit` 默认 40、上限 200，只作用于 `samples`。`failures` 是最近 10 条非成功采样记录（含 `error` 与 `raw_excerpt`）。`scheduler` 反映定时采集状态（`enabled`、`interval_ms`、`next_run_at`、`last_run_summary`），`AIRPORT_METRICS_ENABLED=false` 时为关闭态而非缺失。

## Operations and Web Shell

### `GET /api/v1/operations`

批量执行历史（上限 `OPERATION_HISTORY_LIMIT`，默认 1000）。支持 `?node_id=` 只读过滤：返回 `targets[]` 含该节点的**整条记录**（不裁剪 targets），顶层加 `filtered_by_node_id` 回显；未知或非法 `node_id` 返回空列表 `200`，不返 `404`。无该参数时响应体与从前逐字一致。

### `GET /api/v1/operations/:id`

`200 { operation }`，返回台账原对象（与列表 `items[]` 同构，无独立序列化器）。id 百分号编码非法 → `400 bad_request`；不存在 → `404 not_found`。`GET /api/v1/operations/execute` 也落到本分支，返回 `404`。

### `POST /api/v1/operations/execute`

`201`。请求 `mode: "command"` + `command`，或 `mode: "script"` + `script_name` + `script_body`，附 `node_ids[]`。响应含 `summary` 与逐目标 `targets[]`（`status`、`exit_code`、`signal`、`timed_out`、`transport_kind/label/note`、`output`、`output_text`、`duration_ms`）。

并发与输出保护：目标级并发 `OPERATION_TARGET_CONCURRENCY`（默认 3）、单目标输出 `OPERATION_OUTPUT_LIMIT_BYTES`（默认 128000）、整体超时 `OPERATION_EXECUTION_TIMEOUT_MS`（默认 300000）。

> SSH 不可用时**不会**回退到控制面本机执行；`local-demo` 传输只在显式设置 `AIRPORT_ENABLE_LOCAL_DEMO_TRANSPORT=true` 的开发环境可用，生产禁用。

### `POST /api/v1/shell/sessions` · `GET /api/v1/shell/sessions/:id` · `POST .../input` · `DELETE .../:id`

轮询式交互式 SSH 会话（vendored xterm 前端）。`status` 为 `open` / `closed`，空闲超时关闭原因 `idle_timeout`，输出缓冲有上限；向已关闭会话写入返回 `409 { error: "session_not_writable" }`。会话仅存于进程内存，重启即丢失。当前没有单用户/单节点会话数上限。

## Bootstrap tokens

- `GET /api/v1/bootstrap-tokens`
- `POST /api/v1/bootstrap-tokens`：`{ label, expires_at, max_uses, note }`，`201 { token }`；`token` 可显式指定（与既有值冲突时 `validation_failed`），`id` / `created_at` / `uses` / `last_used_*` 一律由服务端生成，请求里带了也会被忽略
- `PATCH /api/v1/bootstrap-tokens/:id`：仅 `status`（`active|disabled`）、`expires_at`、`max_uses`、`label`、`note`；`token`、`id` 与用量审计字段不可写（沿用存量记录值）
- 没有 `DELETE`；令牌明文当前仍存于 JSON（哈希化在 `docs/stability-roadmap.md` P2）

## Access users, profiles, groups

- `GET|POST /api/v1/access-users`，`GET|PATCH|DELETE /api/v1/access-users/:id`
- `GET /api/v1/access-users/:id`：`200 { access_user }`，序列化口径与列表一致（不含 `share_token` 明文）；id 百分号编码非法 → `400 invalid_request`，记录不存在 → `404 not_found`
- `PATCH|DELETE /api/v1/access-users/:id`：id 编码非法 → `400 bad_request`（与其他命名空间一致）
- 凭证：`credential.uuid` / `credential.password` **可以缺省**，缺省时由服务端生成（vless/vmess 生成 UUID，hysteria2 生成随机密码）。给了就按协议校验格式：`uuid` 必须是 UUID（大小写与无连字符形式均可），`hysteria2` 的 `password` 去空格后至少 8 位；`PATCH` 只对本次真正改动 `protocol`/`credential` 的请求按合并后的生效凭证校验，存量不合规不阻塞无关字段更新。
- `GET /api/v1/access-users/:id/share`：按当前生效发布返回订阅条目、二维码与告警
- `POST /api/v1/access-users/:id/share-token/regenerate`
- `GET|POST /api/v1/proxy-profiles`，`GET|PATCH|DELETE /api/v1/proxy-profiles/:id`（`200 { profile }`）
  - 写入口（`POST`/`PATCH`/克隆）依次过：字段校验 → 重名 `409 profile_name_conflict`（trim + 大小写不敏感，`PATCH` 排除自身）→ `validateSingBoxProfileTemplate` 模板语义 `400 validation_failed`。模板语义校验前移后，缺 `template.tls.certificate_path`/`key_path`、Reality 缺 `private_key_path`/`short_id` 这类问题在保存时即报，不再等到发布才炸。
- `POST /api/v1/proxy-profiles/:id/clone`：`201 { profile }`。深拷贝模板与其余字段，新 id、`status="draft"`、名字按「X 副本」「X 副本 2」避重；源模板通不过写入口校验时返回 `400`（副本仍会被挡）。
- `GET|POST /api/v1/node-groups`，`GET|PATCH|DELETE /api/v1/node-groups/:id`（`200 { group }`）
  - `PATCH` 成功响应额外带 `warnings: string[]`（不拒绝写入）：本次实际移除了成员、且该组仍被某个模板的当前生效发布引用时，逐 profile 给一条“生效拓扑已与节点组不一致，建议重新发布”的提示；发布页保存后同口径展示。
- `GET|HEAD /sub/:shareToken`：公开订阅输出，可选 `?node_id=` 只取单节点

协议兼容：`hysteria2` 必须 `tls` + UDP/QUIC，凭证取 `credential.password`；`vmess` 支持 `tls` 或 `none`，不支持 `reality`；`reality` 要求节点本地 `template.reality.private_key_path`（私钥内容不接受 inline 提交）；`tls` 需要 `template.tls.certificate_path` 与 `key_path`。被发布记录引用的用户、模板、节点组删除时返回 `409`。

## Config releases

### `GET /api/v1/config-releases`

`200 { items }`，按 `updated_at` 倒序，无分页（整表返回）。列表项与 `GET /api/v1/config-releases/:id` 的 `release` **同构且同样有界**：`deployments[].artifacts.*` 只含摘要，不含 `rendered_config` 全文与内联 `manifest`（见下）。

### `POST /api/v1/config-releases`

`201 { release, task, operation }`。请求 `{ title, profile_id, access_user_ids[], node_group_ids[], node_ids[], operator, note }`。

- 无法解析目标节点，或过滤掉失效用户后没有可发布用户时拒绝请求。
- 节点侧流程：写 manifest → 渲染 sing-box 配置 → `sing-box check` → 替换配置 → 重启服务 → 失败回滚。
- 发布成功状态按**生效层**判定（`rendered`/`config_validation`/`activation`/`subscription_entry`），`rendered_only` 不计为成功；Hysteria2 发布要求 UDP/QUIC 复检通过。**业务入口可达性不参与成败**：端口不通多是厂商安全组/防火墙问题，配置其实已生效，判失败会让中转线路整条从订阅消失。可达性单独落 `verification.reachability_status` 与 `release.summary.reachability_failures[]`，并写进逐节点 `note`（详见 `docs/data-model.md`「发布复检分层」）。
- 业务入口复检由控制面本地发起，失败的目标会重试：默认最多 3 次探测、每次间隔 2000 ms（`RELEASE_VERIFY_PROBE_ATTEMPTS`、`RELEASE_VERIFY_PROBE_RETRY_GAP_MS`）。宽限只延后重探失败目标，已通的节点不再等待；用尽预算仍不通即判为真实失败，不引入“降级”状态。

### `GET /api/v1/config-releases/:id`

`200 { release, detail }`，未命中 `404 not_found`，非法编码 `400 bad_request`。

- `release` 的顶层字段与列表项同构（前端可复用列表渲染），但 `deployments[].artifacts.*` 是**有界投影**：去掉 `rendered_config` 全文与内联 `manifest`，只留 `engine`/`config_digest`/`config_path` + `rendered_config_bytes`、≤600B 的 `rendered_config_preview` 与 `rendered_config_truncated`/`manifest_omitted` 标记。
- `detail` 给逐节点摘要（状态、note、长度）与整条发布的字节规模，全文出口指向已有通道：`detail.full_artifact_reference.operations_endpoint`（`/api/v1/operations/:id`）与 `subscription_endpoint`（`/sub/:token`）。本接口不搬运完整配置字节。
- 收紧口径同样适用于列表：`GET /api/v1/config-releases` 早期整表原样返回（每条发布 × 每台节点的完整渲染配置文本），是当时最大的响应体与敏感信息面，现已改为共用同一份有界投影（`projectConfigReleaseForList`）。发布记录的全文仍只走 operations / 订阅通道。

### `POST /api/v1/config-releases/:id/rollback`

`201 { release, operation }`。请求体可选 `{ title, operator, note }`，缺省自动生成“回滚到 <版本>”标题与备注。

语义是**重新发布上一条**：把目标发布存储的逐节点产物（`deployments[].artifacts.*.rendered_config`）逐字节回放到当前线路上，走同一条渲染→下发→复检链路，并生成一条新的发布记录；节点侧不需要备份目录，也没有就地交换。

- 只有 `status=success` 的发布可以作为回滚目标；目标已经是该模板当前生效版本时返回 `400`。
- 拓扑必须完全一致：当前线路解析出的节点集合与目标发布的 `deployment_node_ids` 有任何一侧多出节点都整体拒绝（`400`），不做部分回滚。
- 目标发布缺少某个组件产物、产物没有 `config_digest`/`config_path`，或产物里有 Reality 占位符但当前模板不再提供私钥路径时返回 `400`。
- 用户集合按目标发布的产物回放，差异如实记录在 `summary.rollback_diff`（`lost_users` / `restored_users`），前端在确认框和列表里提示“回滚后暂不可用”的用户。
- 目标发布的节点已被删除时，走与新建发布相同的 `no valid nodes resolved` 拒绝路径。
- 生成的记录：`type=rollback_proxy_config`、`summary.action_type="rollback"`、`summary.rollback_target_release_id` 指向目标发布、`summary.config_digest_after` 由回放后的产物重新计算。

## System users and templates

- `GET|POST /api/v1/system-users`，`GET|PATCH|DELETE /api/v1/system-users/:id`（`GET /:id` 返回 `200 { user }`，与列表同构）
- `POST /api/v1/system-users/apply`：`{ system_user_ids[], node_group_ids[], node_ids[], title, operator, note, dry_run }` → `201 { release, operation }`
- `GET /api/v1/system-user-releases`
- `GET|POST /api/v1/system-templates`，`GET|PATCH|DELETE /api/v1/system-templates/:id`（`category` 默认 `baseline`；`GET /:id` 返回 `200 { template }`）
- `POST /api/v1/system-templates/apply`：`{ template_id, node_group_ids[], node_ids[], title, operator, note, dry_run }` → `201 { release, operation }`
- `GET /api/v1/system-template-releases`

以上四个 `:id` 分支的百分号编码非法时统一 `400 bad_request`（此前 `DELETE` 会 500）。

## Providers and costs

- `GET|POST /api/v1/providers`，`GET|PATCH|DELETE /api/v1/providers/:id`（重名返回 `409`；`GET /:id` 返回 `200 { provider }`）
  - `DELETE` 引用保护：节点台账中仍有 `provider_id` 指向该厂商时返回 `409 provider_in_use`，`message` 带绑定台数，`details.node_ids` 最多 10 个、超出置 `truncated`；需先在节点侧解绑或删机
  - 字段：`name`、`account_name`、`website`、`api_endpoint`、`regions[]`、`auto_provision_enabled`、`default_currency`、`monthly_budget`、`budget_alert_threshold`、`default_overage_price_per_gb`、`billing_contact`、`status`、`cost_note`、`note`
- 成本视图全部只读，按当前台账实时派生：`GET /api/v1/costs/summary`、`/nodes`、`/providers`、`/releases`、`/access-users`
- 厂商“同步云资源”在前端是显式占位，没有对应的自动建机接口

## Platform settings

- `GET /api/v1/platform-context`：bootstrap 基址、请求来源、局域网探测地址、平台 SSH 密钥状态、sing-box 分发配置、`probe_scheduler` 状态
- `GET|PATCH /api/v1/platform/sing-box-distribution`：`{ enabled, version, default_version, install_path, variants }`，`variants.<target>` 支持 `enabled` / `upstream_url` / `upstream_sha256`
- `POST /api/v1/platform/sing-box-distribution/mirror` 与 `.../sync`：同一处理逻辑，请求 `{ target }`，`201`。
  缺/空 `target` → `400 validation_failed`；未知 `target` 由领域层在下载前拒绝 → `400 bad_request`（不产生外网请求）。
  镜像前会检查**配置里的** `version` 是否为单个安全路径段（`[A-Za-z0-9][A-Za-z0-9._+-]*` 且不含 `..`），
  否则 `400 validation_failed`——`version` 参与落盘路径拼接，必须锁在 `data/artifacts/sing-box` 内
- `POST /api/v1/platform/ssh-key/generate`：生成受管密钥；已存在返回 `409 { error: "conflict" }`，
  外部 `PLATFORM_SSH_PRIVATE_KEY_PATH` 优先（该情况下 `400 bad_request`）
- `GET /api/v1/platform/ssh-key`：只读复查已生成密钥，恒 `200 { platform_ssh_key }`。
  只输出状态类信息：`status`（`ready|partial|invalid|missing`，与 `platform-context` 同口径）、`usable`、
  `managed`（是否控制面自管）、`source`、`bootstrap_ready`、`can_generate`、`algorithm`、`key_type`、
  `fingerprint`（`SHA256:` 口径，同 `ssh-keygen -lf`）、`public_key_available`、
  `private_key_file_name` / `private_key_dir_name`（只文件名与目录名）、`created_at` / `updated_at`
  （取自配套 `.pub` 文件的 birthtime/mtime，公钥文件不在则为 `null`）、`reason_code`、`note`。
  **不返回**私钥内容与任何绝对路径，也不返回公钥本体——公钥的唯一出口仍是 `platform-context`

`probe_scheduler` 只读：开关、间隔、批量与最小间隔来自环境变量和启动装配，没有对外切换接口。

## Env variables

`PORT`(8080)、`PLATFORM_PUBLIC_KEY`、`PLATFORM_SSH_PRIVATE_KEY_PATH`、`PLATFORM_PUBLIC_BASE_URL`、`CLIENT_PUBLIC_BASE_URL`、`NODE_SSH_USER`(root)、`DEMO_SHELL_BINARY`、`OPERATION_HISTORY_LIMIT`(1000)、`OPERATION_EXECUTION_TIMEOUT_MS`(300000)、`OPERATION_OUTPUT_LIMIT_BYTES`(128000)、`OPERATION_TARGET_CONCURRENCY`(3)、`SSH_CONNECT_TIMEOUT_SECONDS`(15)、`PROBE_TCP_TIMEOUT_MS`(4000)、`PROBE_SSH_TIMEOUT_MS`(12000)、`RELEASE_VERIFY_PROBE_ATTEMPTS`(3)、`RELEASE_VERIFY_PROBE_RETRY_GAP_MS`(2000)、`AUTO_PROBE_ENABLED`(true)、`AUTO_PROBE_INTERVAL_MS`(3600000)、`AUTO_PROBE_MIN_GAP_MS`(3600000)、`AUTO_PROBE_BATCH_SIZE`(0)、`AUTO_PROBE_JITTER_MS`(10000)、`AIRPORT_METRICS_ENABLED`(true)、`AIRPORT_METRICS_INTERVAL_MS`(300000)、`AIRPORT_METRICS_JITTER_MS`(15000)、`AIRPORT_METRICS_TIMEOUT_MS`(30000)、`AIRPORT_ENABLE_LOCAL_DEMO_TRANSPORT`(未设置)、`AIRPORT_DATA_DIR`(仓库内 `data/`)、以及上一节列出的鉴权变量。

## Not implemented

以下能力没有接口，只有前端或文档占位：`POST /api/v1/nodes/:id/actions`、`POST /api/v1/probes/report`、`/api/v1/routes*`（中转拓扑页面由 `GET /api/v1/nodes` 客户端派生）、云厂商建机/销毁、NMS/面板适配、外部探测结果上报、登录限流、`/readyz`。
