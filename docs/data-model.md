# 数据模型

更新时间：2026-09-22
适用范围：当前代码实际持久化的实体与字段（`src/server.js` + `src/domain/**`）。文中字段均以代码构造为准。

## 持久化形态

- 没有 SQL、没有 SQLite。每个 store 一个 JSON 文件，路径固定为仓库内 `data/`，无环境变量可改。
- 除 `platform-sing-box.json` 是对象外，所有文件形状都是 `{ "items": [ ... ] }`。
- 写入流程：临时文件 → `fsync` → 原子 `rename` → 保留上一版 `.bak`；主文件损坏时启动阶段回读备份（`src/infrastructure/json-file-store.js`）。
- 每个文件一条串行写队列，避免并发覆盖（`src/infrastructure/store-persistence.js`）。
- 没有迁移表。“迁移”是启动时幂等修复函数：管理链路字段迁移、厂商地域归一、节点-厂商关联迁移、内置系统模板种子、bootstrap 初始化任务补齐。
- 启动修复会把遗留的 `running` 任务、`running|queued` 诊断、`running|queued` 操作标记为收口态，因此控制面重启不会留下永久运行态。操作的收口会把未结束（`pending`/`running`）的目标一并翻成 `failed`（带"异常中断回收"原因），并按目标实际结果重算 `summary` 与状态：全成 `success`、混合 `partial`、其余 `failed`。
- 一致性局限：跨文件写入没有事务，历史统计口径依赖最近 N 条记录。**这是 SQLite 迁移的主要动因**（见 `docs/stability-roadmap.md` P4）。

## Store 清单

| 文件 | 实体 | 构造位置 | 上限 |
| --- | --- | --- | --- |
| `nodes.json` | Node | `src/domain/nodes/records.js` | 无 |
| `tasks.json` | Task | `src/domain/tasks/store.js` | 200 |
| `probes.json` | ProbeResult | `src/domain/probes/executor.js` | 500 |
| `diagnostics.json` | NodeDiagnostic | `src/domain/diagnostics/node-quality.js` | 200 |
| `operations.json` | OperationRun | `src/domain/operations/executor.js` | `OPERATION_HISTORY_LIMIT`，默认 1000 |
| `bootstrap-tokens.json` | BootstrapToken | `src/domain/bootstrap/tokens.js` | 无 |
| `operator-sessions.json` | OperatorSession | `src/domain/auth/session.js` | 过期即清理 |
| `access-users.json` | AccessUser | `src/server.js` | 无 |
| `proxy-profiles.json` | ProxyProfile | `src/server.js` | 无 |
| `node-groups.json` | NodeGroup | `src/server.js` | 无 |
| `providers.json` | Provider | `src/server.js` | 无 |
| `config-releases.json` | ConfigRelease | `src/server.js` | 无 |
| `system-users.json` / `system-templates.json` | SystemUser / SystemTemplate | `src/server.js` | 无 |
| `system-user-releases.json` / `system-template-releases.json` | 下发记录 | `src/server.js` | 无 |
| `platform-sing-box.json` | sing-box 分发配置（对象，非 `items`） | `src/domain/platform/sing-box-distribution.js` | — |
| `artifacts/sing-box/` | 已镜像的二进制文件 | `src/server.js` | — |

不入库的运行态：Web Shell 会话（仅进程内存）、sing-box 镜像与制品下载中间态。订阅不是实体，它是 `AccessUser.share_token` 加上当前生效发布派生出的输出。

## Node

```
{
  id, fingerprint, status, source,
  registered_at, last_seen_at, last_probe_at, health_score,
  labels{ provider, region, role, ...自定义键 },
  provider_id, bootstrap_token_id,
  facts{...}, commercial{...}, networking{...}, management{...}, endpoints{...}
}
```

- `status`：`new | active | degraded | failed`（`disabled` / `retired` 在代码里没有写入路径）。
- `source`：`bootstrap | manual`。手工录入默认 `active`。
- `fingerprint` 唯一，用于注册去重。

### facts（节点自报或人工覆盖的机器事实）

`hostname, os_name, os_id, os_family, os_version, arch, kernel_version, public_ipv4, public_ipv6, private_ipv4, public_ipv4_source, public_ipv4_location, public_ipv4_owner, public_ipv6_source, public_ipv6_location, public_ipv6_owner, machine_id, primary_mac, cpu_cores, memory_mb, disk_gb, ssh_port`

IP 来源标记区分 `self_reported`、外部查询服务与 `manual_override`，人工覆盖不会被下次上报悄悄冲掉。

### commercial（成本与商务）

`expires_at, auto_renew, bandwidth_mbps, traffic_quota_gb, traffic_used_gb, billing_cycle, billing_amount, billing_currency, amortization_months, overage_price_per_gb, extra_fixed_monthly_cost, billing_started_at, cost_note, note`

`billing_cycle` 归一化为 `月付|季付|年付|周付|日付|小时付|一次性`（接受英文别名）；`billing_currency` 校验为 3–10 位大写代码，默认 `CNY`，厂商可带 `default_currency` 参与继承。

### networking 与 management：两条链路不能混用

`networking.*` 只描述**业务流量**：
`access_mode(direct|relay), relay_node_id, relay_label, relay_region, entry_region, entry_host, entry_port, internal_host, internal_port, topology, route_note, route_direction, nat_mode`

`management.*` 只描述**控制面如何 SSH 接管**：
`access_mode, relay_strategy(auto|tcp_forward|exec_nc), relay_node_id, relay_label, relay_region, proxy_host, proxy_port, proxy_user, proxy_label, ssh_host, ssh_port, ssh_internal_host, ssh_internal_port, topology, allow_ipv6, ssh_user, route_note`

核心不变量：**公网入口端口 ≠ 节点内部监听端口**。NAT/LXC 场景下 `entry_*` / `ssh_*` 是外部可达值，`internal_*` 是容器内监听值；订阅与分享只能输出公网入口。

### endpoints（拆分的三类端点）

`endpoints.management`、`endpoints.business_ingress`、`endpoints.service_listen`，每个形如
`{ kind, protocol, host, port, external_host, external_port, internal_host, internal_port, family, topology, source }`（management 额外带 `ssh_user`）。

`topology` 枚举：`direct | nat | lxc | mapped | relay | unknown | internal`。

### 派生的业务身份

节点身份不止 `labels`。发布与订阅会解析 `AccessUser + ProxyProfile + networking + endpoints` 得到入口/落地/中转三元组，因此节点没有“业务角色”字段也能表达入口机与落地机。这是当前实现的关键设计选择，也是后续 Route 实体化的迁移起点。`labels` 的写入口只有两个：`PATCH /:id/assets` 改 `provider`/`region`/`role` 三个已知键，`PATCH /:id/labels` 按键合并任意自定义键（`null` 或空串删除）；两者都走 `region` 地域字典归一。

## Task

```
{ id, node_id, type, title, status, template, trigger, payload,
  attempt, scheduled_at, created_at, started_at, finished_at,
  operation_id, note, log_excerpt }
```

- `id = task_<uuid>`，初始 `status = "new"`。
- `status`：`new → queued → running → success | failed | partial`。
- `type`：`init_alpine | probe_node | node_diagnostic | publish_proxy_config | apply_system_template | apply_system_users`。`init_alpine` 只是历史名字，实际覆盖 Alpine / Debian-Ubuntu / RHEL 家族。
- `trigger`：`bootstrap_register | bootstrap_refresh | bootstrap_auto_probe | manual_probe | manual_diagnostic | manual_retry | manual_release | scheduled_probe`。
- 认领是原子的：同一任务并发执行只有一个 owner 能推进终态。
- 任务→节点状态映射：`success → active`，`failed → degraded`。
- 历史裁剪会保留活跃任务，不会把正在跑的任务裁掉。

## ProbeResult

```
{ id, node_id, task_id, probe_type, target, target_host, target_port,
  access_mode, transport_kind, transport_label,
  success, control_ready, reason_code, summary,
  latency_ms, latency_source, packet_loss_ratio, health_score,
  error_stage, error_message, stages{...}, observed_at }
```

- `probe_type`：`ssh_auth | business_entry_tcp | relay_upstream_tcp | full_stack`。
- `latency_source`：`management_tcp | management_ssh_e2e | business_entry_tcp | relay_upstream_tcp | ssh_auth | relay_direct_tcp_skipped`。
- `reason_code` 是稳定枚举（如 `probe_target_missing`、`business_route_unpublished`、`relay_udp_not_supported`、`udp_timeout`），中文文案只在 `public/js/shared/probe-formatters.js` 维护一份，前端不再各自硬编码。
- 探测完成只更新健康字段，不用旧节点快照回写资产字段。

## NodeDiagnostic

```
{ id, node_id, task_id, profile(light|deep), provider: "nodequality",
  status, result_quality(failed|partial|null), summary,
  host_group_key, guard{static_blockers, runtime_blockers, warnings},
  preflight, transport, reports{hardware, ip, net},
  created_at, started_at, finished_at, updated_at }
```

深度诊断按 `host_group_key`（同一公网入口宿主）互斥，避免在同一台物理机上并发压测。

## OperationRun

```
{ id, mode, title, status, summary{total, success, failed},
  started_at, finished_at, duration_ms,
  targets[{ node_id, status, transport_kind, transport_label, transport_note,
            exit_code, signal, timed_out, output[], output_text,
            started_at, finished_at, duration_ms }] }
```

目标状态 `pending → running → success | failed`；整体 `success | partial | failed`。

## AccessUser

```
{ id: access_user_<uuid>, name, protocol(vless|vmess|hysteria2),
  credential{ uuid | alter_id | password },
  status(active|disabled|...), expires_at, profile_id, node_group_ids[],
  share_token, share_token_created_at, share_token_updated_at, note,
  created_at, updated_at }
```

凭证按协议分支：`vless/vmess` 用 `uuid`（`vmess` 另有 `alter_id`），`hysteria2` 用 `password`。被发布记录引用的用户不能删除。

## ProxyProfile

```
{ id, name, protocol, listen_port, transport, security(reality|tls|none),
  tls_enabled, reality_enabled, sni/server_name, flow, mux_enabled,
  status(active|draft|...), template{...}, note, created_at, updated_at }
```

默认 `protocol=vless`、`listen_port=443`、`flow=xtls-rprx-vision`，`security` 在 `vless` 下默认 `reality`，`vmess/hysteria2` 回落 `tls`。兼容矩阵（HY2 必须 `tls`+UDP；`vmess` 不支持 `reality`）目前仍分散在校验器与 sing-box 渲染器中，是 `docs/duplication-audit.md` 的待办项。

## NodeGroup

`{ id, name, type: "static", node_ids[], note, created_at, updated_at }`。被用户或发布引用时删除返回 `409`。

## Provider

`{ id: provider_<uuid>, name, account_name, website, api_endpoint, regions[], auto_provision_enabled, default_currency, monthly_budget, budget_alert_threshold, default_overage_price_per_gb, billing_contact, status, cost_note, note, created_at, updated_at }`

节点通过 `node.provider_id` 关联厂商；`instance_type` / `remote_id` / `PanelBinding` / `ProviderBinding` 这类字段在代码中不存在。

## ConfigRelease

```
{ id, type: "publish_proxy_config" | "rollback_proxy_config", version: rel_<ts>, title, status,
  profile_id, access_user_ids[], node_ids[], node_group_ids[],
  deployment_node_ids[], entry_node_ids[],
  routes[序列化后的 TrafficRoute], deployments[逐节点结果],
  operation_id, task_ids[], created_by, note, created_at, updated_at }
```

`summary` 里与回滚相关的键：`action_type`（`publish` / `rollback`）、`based_on_release_id`（上一条生效发布）、`rollback_target_release_id`（回滚目标；普通发布为上一条生效发布）、`config_digest_before` / `config_digest_after`、`rollback_diff`（仅回滚记录，`{ target_release_id, target_version, current_release_id, current_version, target_node_count, current_node_count, lost_users[{id,name}], restored_users[{id,name}] }`）。

回滚记录的用户计数（`active_user_count` / `skipped_user_count`）取目标发布的 summary 而不是本次渲染结果：节点上跑的字节来自目标发布，用户集合也必须按目标发布陈述。

`status` 起始 `running`，由 `src/domain/releases/verification.js` 的复检结果收敛；成功集合与失败集合是显式枚举（`success|passed|ok|ready|healthy|running|applied` / `failed|failure|error|errored|timeout|rolled_back`），逐目标检查记录 `passed|skipped|missing`。业务入口探测在 `src/server.js` 的 `verifyConfigReleaseAfterPublish` 内执行，失败目标最多重探 `RELEASE_VERIFY_PROBE_ATTEMPTS` 次（间隔 `RELEASE_VERIFY_PROBE_RETRY_GAP_MS`），只有最后一轮的结果进入 `businessProbesByNodeId` 并参与判定。

## SystemUser / SystemTemplate 与下发记录

- SystemUser：`{ id, name, username, uid, groups[], sudo_enabled, shell, home_dir, ssh_authorized_keys[], status, node_group_ids[], note, created_at, updated_at }`
- SystemTemplate：`{ id, name, category(baseline|...), script_name, script_body, status, node_group_ids[], tags[], note, created_at, updated_at }`；内置种子 `alpine-base`、`debian-base`、`rhel-base`（+ ACME 证书模板）。
- 两类 release 记录：`{ id, ..._id, target_node_ids, status, operation_id, created_at }`。

## BootstrapToken

`{ id, token, label, status(active|disabled|expired|exhausted), created_at, expires_at, max_uses, uses, last_used_at, last_used_node_id, note }`

令牌目前**明文**存储以支持一键复制；哈希化改造在 `docs/stability-roadmap.md` P2。

## OperatorSession

`{ id: <uuid>, username, created_at, last_seen_at, expires_at_ms }`

## 枚举总表

| 语义 | 取值 | 权威位置 |
| --- | --- | --- |
| 节点状态 | `new active degraded failed` | `src/domain/nodes/records.js`、`src/domain/tasks/lifecycle.js` |
| 任务状态 | `new queued running success failed partial` | `src/domain/tasks/store.js` |
| 任务类型 | `init_alpine probe_node node_diagnostic publish_proxy_config apply_system_template apply_system_users` | `src/server.js` |
| 探测类型 | `ssh_auth business_entry_tcp relay_upstream_tcp full_stack` | `src/domain/probes/executor.js` |
| 耗时口径 | `management_tcp management_ssh_e2e business_entry_tcp relay_upstream_tcp ssh_auth relay_direct_tcp_skipped` | `src/domain/probes/executor.js`、`public/js/shared/probe-formatters.js` |
| 链路方向 | `international_egress return_to_china regional_transit` | `src/domain/routes/traffic.js` |
| 接入模式 | `direct relay` | `src/http/validators.js` |
| 拓扑 | `direct nat lxc mapped relay unknown internal` | `src/domain/nodes/records.js` |
| 管理中转策略 | `auto tcp_forward exec_nc` | `src/domain/routes/management-strategies.js` |
| SSH 传输种类 | `ssh-direct ssh-relay-tcp-forward ssh-relay-exec-nc ssh-proxy local-demo` | `src/domain/platform/ssh.js` |
| 协议 / 安全 / 传输 | `vless vmess hysteria2` / `reality tls none` / `tcp udp ws grpc http httpupgrade` | `src/http/validators.js`、`src/domain/releases/sing-box.js` |
| 计费周期 | `月付 季付 年付 周付 日付 小时付 一次性` | `src/domain/costs/normalize.js`、`public/js/shared/billing-options.js` |
| 币种 | `^[A-Z][A-Z0-9_-]{1,9}$`，默认 `CNY` | `src/domain/costs/normalize.js`、`public/js/shared/currency-options.js` |
| 管理 SSH 默认端口 | `22`（`19822` 仅作为 legacy 常量保留） | `src/domain/nodes/management-defaults.js`、`public/js/shared/management-defaults.js` |
