# API

## Authentication approach

Current status:

- control-plane pages and operator APIs now use same-origin session cookies
- anonymous access is only kept for `bootstrap.sh`、节点注册、bootstrap 完成回报、健康检查和公开制品下载
- internal workers still reserve service-credential expansion for later

Operator auth env vars:

- `CONTROL_PLANE_AUTH_USERNAME`
- `CONTROL_PLANE_AUTH_PASSWORD`
- optional: `CONTROL_PLANE_SESSION_TTL_MS`
- optional: `CONTROL_PLANE_SESSION_SECURE`

## `GET /api/v1/auth/session`

Returns the current operator session state.

Example response:

```json
{
  "authenticated": true,
  "session": {
    "id": "48ce7e6d-3cb7-4b4d-b4cb-0cfa23f6cdd6",
    "username": "admin",
    "created_at": "2026-04-15T11:20:00.487Z",
    "last_seen_at": "2026-04-15T11:20:00.578Z",
    "expires_at": "2026-04-15T23:20:00.578Z"
  },
  "operator": {
    "username": "admin",
    "display_name": "admin",
    "uses_fallback_credentials": false
  },
  "auth": {
    "mode": "session_cookie",
    "login_url": "/login.html"
  }
}
```

## `POST /api/v1/auth/login`

Creates one operator session and writes an `HttpOnly` cookie.

Request body:

```json
{
  "username": "admin",
  "password": "AirportTest123!",
  "next": "/nodes.html"
}
```

Example response:

```json
{
  "authenticated": true,
  "session": {
    "id": "48ce7e6d-3cb7-4b4d-b4cb-0cfa23f6cdd6",
    "username": "admin",
    "created_at": "2026-04-15T11:20:00.487Z",
    "last_seen_at": "2026-04-15T11:20:00.487Z",
    "expires_at": "2026-04-15T23:20:00.487Z"
  },
  "next_url": "/nodes.html"
}
```

## `POST /api/v1/auth/logout`

Clears the current operator session cookie.

Example response:

```json
{
  "authenticated": false,
  "message": "已退出登录。"
}
```

## `GET /healthz`

Returns basic service health.

Example response:

```json
{
  "ok": true,
  "service": "airport-control-plane"
}
```

## `GET /api/v1/nodes`

Returns the current node inventory.

Example response:

```json
{
  "items": []
}
```

## `POST /api/v1/nodes/register`

Registers or refreshes a node.

Notes:

- `facts.public_ipv4` / `facts.public_ipv6` should describe the actual SSH ingress
  endpoint that the control plane should probe, not only the node's outbound egress IP
- when bootstrap runs behind NAT, containers, or provider port mapping, prefer passing
  explicit overrides such as `--public-ipv4` and `--ssh-port`
- the control plane defaults to SSH port `19822` when a node record has no explicit
  `ssh_port`; `bootstrap.sh` itself keeps the machine's current `sshd` port unless
  `--ssh-port` is passed explicitly

Request body:

```json
{
  "bootstrap_token": "token",
  "fingerprint": "sha256:fingerprint",
  "facts": {
    "hostname": "alpine-hkg-01",
    "os_name": "Alpine Linux",
    "os_version": "3.21",
    "arch": "x86_64",
    "kernel_version": "6.12.0",
    "public_ipv4": "203.0.113.10",
    "public_ipv6": "2408:xxxx::10",
    "public_ipv4_source": "cip.cc",
    "public_ipv4_location": "中国香港",
    "public_ipv4_owner": "Example Transit",
    "private_ipv4": "10.0.0.10",
    "cpu_cores": 1,
    "memory_mb": 512,
    "disk_gb": 10,
    "ssh_port": 19822
  },
  "labels": {
    "provider": "example-cloud",
    "region": "hkg"
  }
}
```

Success response:

```json
{
  "node": {
    "id": "node_123",
    "status": "new",
    "bootstrap_token_id": "token_demo"
  },
  "bootstrap": {
    "init_task_id": "task_123",
    "init_template": "alpine-base"
  },
  "actions": [
    {
      "type": "install_ssh_key",
      "public_key": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA..."
    },
    {
      "type": "schedule_init",
      "id": "task_123",
      "template": "alpine-base"
    }
  ]
}
```

Notes:

- `actions[].install_ssh_key` only appears when the platform already has a usable public key
- when the platform key is missing, registration still succeeds, but the node will not receive automatic `authorized_keys` injection in this step

Validation rules:

- `bootstrap_token` is required
- `fingerprint` is required
- `facts.hostname` is required
- at least one of `facts.public_ipv4` / `facts.public_ipv6` / `facts.private_ipv4` should exist
- numeric facts must be non-negative
- `bootstrap_token` must exist and be active
- expired / exhausted / disabled tokens are rejected

## `GET /api/v1/bootstrap-tokens`

Returns the current bootstrap token inventory.

Example response:

```json
{
  "items": [
    {
      "id": "token_demo",
      "token": "demo-token",
      "label": "演示令牌",
      "status": "active",
      "created_at": "2025-01-01T00:00:00.000Z",
      "expires_at": "2035-01-01T00:00:00.000Z",
      "max_uses": 200,
      "uses": 1,
      "last_used_at": "2026-04-13T03:35:03.214Z",
      "last_used_node_id": "node_xxx",
      "note": "用于 bootstrap.sh 快速启动控制面演示节点"
    }
  ]
}
```

## `GET /api/v1/platform-context`

Returns the base URL used by bootstrap, the current platform SSH key readiness, and the automatic probe scheduler state.

Example response:

```json
{
  "request_origin": "http://control-plane.example:8080",
  "bootstrap_base_url": "http://192.0.2.10:8080",
  "detected_lan_ipv4": "192.0.2.10",
  "detected_lan_base_url": "http://192.0.2.10:8080",
  "source": "detected_lan",
  "ssh_key": {
    "status": "ready",
    "available": true,
    "bootstrap_ready": true,
    "source": "managed",
    "private_key_path": "/path/to/data/platform-ssh/id_ed25519",
    "public_key": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA...",
    "note": null,
    "can_generate": true
  },
  "probe_scheduler": {
    "enabled": true,
    "running": false,
    "interval_ms": 900000,
    "batch_size": 4,
    "min_probe_gap_ms": 600000,
    "jitter_ms": 10000,
    "next_run_at": "2026-04-15T05:31:14.317Z",
    "last_run_at": "2026-04-15T05:16:03.678Z",
    "last_finished_at": "2026-04-15T05:16:04.317Z",
    "last_run_summary": {
      "total": 3,
      "success": 3,
      "failed": 0,
      "skipped": 0,
      "node_ids": ["node_a", "node_b", "node_c"]
    },
    "last_error": null
  }
}
```

Notes:

- `probe_scheduler.enabled` indicates whether the current process will create background `scheduled_probe` tasks
- `last_run_summary` reflects only the most recent scheduler cycle
- `next_run_at` is a UI-facing hint and may shift slightly because of scheduler jitter

## `POST /api/v1/platform/ssh-key/generate`

Generate one managed platform SSH key pair for bootstrap injection and control-plane SSH takeover.

Success response:

```json
{
  "message": "平台 SSH 密钥已生成，新的 bootstrap 将自动注入这把公钥。",
  "platform_context": {
    "ssh_key": {
      "status": "ready",
      "source": "managed"
    }
  }
}
```

Notes:

- when `PLATFORM_SSH_PRIVATE_KEY_PATH` is already provided via environment variable, this endpoint rejects generation and keeps the external key as the single source of truth
- generation is idempotent at the workflow level; if a managed key already exists, the endpoint returns an error instead of silently replacing it

## `POST /api/v1/bootstrap-tokens`

Creates one bootstrap token for node enrollment.

Request body:

```json
{
  "label": "迁移批次 A",
  "expires_at": "2026-05-20",
  "max_uses": 3,
  "note": "用于 4 月新增节点"
}
```

Success response:

```json
{
  "token": {
    "id": "token_xxx",
    "token": "generated-secret",
    "label": "迁移批次 A",
    "status": "active"
  }
}
```

## `GET /api/v1/access-users`

Returns the current internal access-user inventory.

Example response:

```json
{
  "items": [
    {
      "id": "access_user_xxx",
      "name": "香港入口用户",
      "protocol": "vmess",
      "credential": {
        "uuid": "11111111-2222-3333-4444-555555555555",
        "alter_id": 0
      },
      "status": "active",
      "expires_at": "2026-06-01T00:00:00.000Z",
      "profile_id": "profile_xxx",
      "node_group_ids": ["group_hkg"],
      "note": "首批入口用户"
    }
  ]
}
```

## `POST /api/v1/access-users`

Creates one managed access user.

Request body:

```json
{
  "name": "日本落地用户",
  "protocol": "vmess",
  "profile_id": "profile_xxx",
  "node_group_ids": ["group_jp"],
  "status": "active",
  "expires_at": "2026-07-01",
  "note": "内部统一发布使用",
  "credential": {
    "uuid": "11111111-2222-3333-4444-555555555555",
    "alter_id": 0
  }
}
```

## `PATCH /api/v1/access-users/:id`

Updates one access user.

Supported fields:

- `name`
- `credential.uuid`
- `credential.alter_id`
- `status`
- `expires_at`
- `profile_id`
- `node_group_ids`
- `note`

## `DELETE /api/v1/access-users/:id`

Deletes one access user when it is not referenced by historical release records.

## `GET /api/v1/proxy-profiles`

Returns managed protocol templates.

## `POST /api/v1/proxy-profiles`

Creates one protocol template.

Request body:

```json
{
  "name": "JP VMess TLS",
  "protocol": "vmess",
  "listen_port": 443,
  "transport": "ws",
  "security": "tls",
  "tls_enabled": true,
  "reality_enabled": false,
  "server_name": "edge.example.com",
  "mux_enabled": false,
  "status": "active",
  "template": {
    "transport": {
      "type": "ws",
      "path": "/ws"
    },
    "tls": {
      "certificate_path": "/etc/ssl/airport/jp-vmess/fullchain.pem",
      "key_path": "/etc/ssl/airport/jp-vmess/privkey.pem"
    }
  }
}
```

## `PATCH /api/v1/proxy-profiles/:id`

Updates one protocol template.

## `DELETE /api/v1/proxy-profiles/:id`

Deletes one protocol template when it is no longer referenced by users or releases.

## `GET /api/v1/node-groups`

Returns current static release groups.

## `POST /api/v1/node-groups`

Creates one static node group.

Request body:

```json
{
  "name": "香港入口组",
  "type": "static",
  "node_ids": ["node_xxx", "node_yyy"],
  "note": "先给入口节点小范围试发"
}
```

## `PATCH /api/v1/node-groups/:id`

Updates one node group.

## `DELETE /api/v1/node-groups/:id`

Deletes one node group when it is no longer referenced by users or releases.

## `GET /api/v1/config-releases`

Returns the publish history for managed config releases.

## `POST /api/v1/config-releases`

Creates one publish action and reuses the existing task and operation execution pipeline.

Request body:

```json
{
  "title": "香港入口 VLESS 首批下发",
  "profile_id": "profile_xxx",
  "access_user_ids": ["access_user_xxx"],
  "node_group_ids": ["group_hkg"],
  "operator": "console",
  "note": "先试发入口组"
}
```

Success response:

```json
{
  "release": {
    "id": "release_xxx",
    "status": "success",
    "operation_id": "op_xxx",
    "task_ids": ["task_xxx", "task_yyy"]
  },
  "operation": {
    "id": "op_xxx",
    "status": "success"
  },
  "tasks": [
    {
      "id": "task_xxx",
      "type": "publish_proxy_config",
      "status": "success"
    }
  ]
}
```

Notes:

- when no target nodes can be resolved from `node_group_ids` or `node_ids`, the endpoint rejects the request
- current version renders a real `sing-box` config for `VLESS` / `VMess` profiles and reuses the existing task / operation pipeline
- inactive or expired access users are skipped before rendering; if no publishable users remain, the request is rejected
- when `security` is `tls`, the template JSON should provide `template.tls.certificate_path` and `template.tls.key_path`
- when `security` is `reality`, the template JSON should provide `template.reality.private_key_path` and `template.reality.short_id`; private key content should stay on the node and is not accepted inline
- `vmess` currently supports `tls` or `none`, not `reality`
- built-in system template `Alpine ACME 证书申请` can generate files under `/etc/ssl/airport/<cert_name>/fullchain.pem` and `/etc/ssl/airport/<cert_name>/privkey.pem`
- node-side publish now attempts: write manifest -> render sing-box config -> `sing-box check` -> replace config -> restart service -> rollback on failure

## `GET /api/v1/tasks`

返回当前平台记录的真实任务流，当前已接入初始化任务。

Example response:

```json
{
  "items": [
    {
      "id": "task_xxx",
      "node_id": "node_xxx",
      "type": "init_alpine",
      "title": "初始化 Alpine",
      "status": "new",
      "template": "alpine-base",
      "attempt": 0,
      "scheduled_at": "2026-04-13T09:00:00.000Z",
      "note": "等待节点确认平台 SSH 公钥写入完成，随后自动执行初始化模板。"
    }
  ]
}
```

Notes:

- `trigger = "scheduled_probe"` means the task was created by the background periodic inspection scheduler
- current first version already mixes `bootstrap_auto_probe` / `manual_probe` / `scheduled_probe` in the same task stream, and the frontend distinguishes them by `trigger`

## `GET /api/v1/probes`

返回平台最近的探测结果；可通过 `?node_id=` 只看单节点。

Example response:

```json
{
  "items": [
    {
      "id": "probe_xxx",
      "node_id": "node_xxx",
      "task_id": "task_xxx",
      "probe_type": "ssh_auth",
      "target": "203.0.113.8:19822",
      "target_host": "203.0.113.8",
      "target_port": 19822,
      "access_mode": "direct",
      "transport_kind": "ssh-direct",
      "transport_label": "SSH 直连",
      "latency_ms": 42,
      "packet_loss_ratio": null,
      "success": true,
      "control_ready": true,
      "reason_code": "ssh_control_ready",
      "summary": "SSH 探测成功，平台已经可以接管该节点，端到端耗时 42ms。",
      "error_stage": null,
      "error_message": null,
      "stages": {
        "tcp": {
          "success": true,
          "latency_ms": 18,
          "error_message": null
        },
        "ssh": {
          "attempted": true,
          "success": true,
          "latency_ms": 42,
          "exit_code": 0,
          "error_message": null,
          "skipped_reason": null,
          "transport_kind": "ssh-direct",
          "transport_label": "SSH 直连"
        }
      },
      "observed_at": "2026-04-13T10:00:00.000Z"
    }
  ]
}
```

## `POST /api/v1/tasks/:id/bootstrap-complete`

由 `bootstrap.sh` 在尝试写入平台 SSH 公钥后回报控制面，触发初始化；只有初始化真正成功后，才会自动衔接“自动首探”。

Request body:

```json
{
  "bootstrap_token": "demo-token",
  "installed_ssh_key": true
}
```

`installed_ssh_key` may be `false` when the platform has not prepared a public key yet, or when this bootstrap run did not actually write it into `authorized_keys`.

Success response:

```json
{
  "task": {
    "id": "task_xxx",
    "status": "success"
  },
  "node": {
    "id": "node_xxx",
    "status": "active"
  },
  "operation": {
    "id": "op_xxx",
    "status": "success"
  },
  "probe_task": {
    "id": "task_probe_xxx",
    "type": "probe_node",
    "status": "success",
    "trigger": "bootstrap_auto_probe"
  },
  "probe": {
    "id": "probe_xxx",
    "reason_code": "ssh_control_ready",
    "summary": "SSH 探测成功，平台已经可以接管该节点，端到端耗时 58ms。"
  }
}
```

Notes:

- when initialization is skipped or failed, `probe_task` and `probe` may be `null`
- the response also carries `probe_summary`, `transport` and `capability` fields so the bootstrap caller can understand why auto first probe did or did not run
- repeated callbacks for the same init task will not create duplicate automatic first-probe tasks

## `POST /api/v1/nodes/:id/init`

从控制台手动重试某个节点的初始化模板。

Request body:

```json
{
  "template": "alpine-base"
}
```

## `POST /api/v1/nodes/:id/probe`

从控制台手动触发一次真实探测。默认会先做 TCP 连通性，再尽量补一层 SSH 接管验证。

Request body:

```json
{
  "probe_type": "ssh_auth"
}
```

Supported `probe_type` values:

- `ssh_auth`: 先做 TCP，再做非交互 SSH 公钥接管验证
- `tcp_ssh`: 只做 TCP 端口探测

Success response:

```json
{
  "task": {
    "id": "task_xxx",
    "type": "probe_node",
    "title": "手动复探",
    "status": "success",
    "trigger": "manual_probe"
  },
  "node": {
    "id": "node_xxx",
    "status": "active",
    "health_score": 90
  },
  "probe": {
    "id": "probe_xxx",
    "probe_type": "ssh_auth",
    "target": "203.0.113.10:19822",
    "latency_ms": 58,
    "success": true,
    "control_ready": true,
    "reason_code": "ssh_control_ready",
    "summary": "SSH 探测成功，平台已经可以接管该节点，端到端耗时 58ms。"
  },
  "transport": {
    "kind": "ssh-direct",
    "label": "SSH 直连",
    "note": "已尝试使用平台 SSH 密钥连接该节点。"
  },
  "summary": "SSH 探测成功，平台已经可以接管该节点，端到端耗时 58ms。",
  "capability": {
    "tcp_reachable": true,
    "ssh_reachable": true,
    "relay_used": false
  }
}
```

Validation rules:

- `status` if present must be `active` or `disabled`
- `max_uses` must be a non-negative integer
- `expires_at` must be a valid timestamp/date

## `PATCH /api/v1/bootstrap-tokens/:id`

Updates the control fields of one bootstrap token.

Request body:

```json
{
  "status": "disabled"
}
```

Supported fields:

- `status`: `active` or `disabled`
- `expires_at`
- `max_uses`
- `label`
- `note`

## Future endpoints

- `GET /api/v1/nodes/:id`
- `POST /api/v1/nodes/:id/actions`
- `GET /api/v1/tasks`
- `POST /api/v1/probes/report`
- `POST /api/v1/providers/:provider/provision`

## `POST /api/v1/nodes/manual`

手工录入一个节点，适用于厂商 API 还未接入时先维护资产台账。

Request body:

```json
{
  "hostname": "alpine-hkg-04",
  "provider": "Vultr",
  "region": "HKG",
  "public_ipv4": "203.0.113.88",
  "private_ipv4": "10.0.0.88",
  "memory_mb": 1024,
  "bandwidth_mbps": 300,
  "traffic_quota_gb": 2000,
  "traffic_used_gb": 320,
  "expires_at": "2026-05-20",
  "auto_renew": false,
  "access_mode": "relay",
  "entry_region": "中国大陆",
  "relay_node_id": "node_hkg_01",
  "relay_label": "alpine-hkg-01",
  "relay_region": "HKG",
  "route_note": "中国大陆 -> 香港中转 -> 日本落地",
  "billing_cycle": "月付",
  "note": "月底前决定是否续费"
}
```

Success response:

```json
{
  "node": {
    "id": "node_xxx",
    "status": "active"
  }
}
```

## `PATCH /api/v1/nodes/:id/assets`

更新一个节点的资产字段，适用于自动注册节点和手工录入节点。

Request body:

```json
{
  "public_ipv4": "203.0.113.88",
  "public_ipv6": "2408:xxxx::88",
  "private_ipv4": "10.0.0.88",
  "ssh_port": 2222,
  "provider": "Vultr",
  "region": "HKG",
  "role": "edge",
  "expires_at": "2026-05-20",
  "auto_renew": true,
  "billing_cycle": "月付",
  "bandwidth_mbps": 300,
  "traffic_quota_gb": 2000,
  "traffic_used_gb": 320,
  "access_mode": "relay",
  "entry_region": "中国大陆",
  "relay_node_id": "node_hkg_01",
  "relay_label": "alpine-hkg-01",
  "relay_region": "HKG",
  "route_note": "中国大陆 -> 香港中转 -> 日本落地",
  "note": "自动注册后补充的资产信息"
}
```

Success response:

```json
{
  "node": {
    "id": "node_xxx",
    "commercial": {
      "expires_at": "2026-05-20",
      "auto_renew": true
    },
    "networking": {
      "access_mode": "relay",
      "entry_region": "中国大陆",
      "relay_node_id": "node_hkg_01"
    }
  }
}
```

Supported route fields for `POST /api/v1/nodes/manual` and `PATCH /api/v1/nodes/:id/assets`:

- `public_ipv4`: override the SSH ingress IPv4 used by probes / operations
- `public_ipv6`: override the SSH ingress IPv6 used by probes / operations
- `private_ipv4`: override the internal IPv4 used for LAN / relay routing decisions
- `ssh_port`: override the SSH ingress port
- when `public_ipv4` / `public_ipv6` are changed here, their source is stored as `manual_override`
- `access_mode`: `direct` or `relay`
- `entry_region`: entry area for the route
- `relay_node_id`: optional internal node ID of the relay/jump node
- `relay_label`: optional human-readable relay node name
- `relay_region`: optional relay node region
- `route_note`: free-form route description

## `GET /api/v1/operations`

Returns recent batch execution history for the web terminal page.

Example response:

```json
{
  "items": [
    {
      "id": "op_xxx",
      "mode": "command",
      "title": "批量安装基础依赖",
      "status": "partial"
    }
  ]
}
```

## `POST /api/v1/operations/execute`

Creates one batch shell/script execution record and returns per-node output.

Request body for command mode:

```json
{
  "mode": "command",
  "title": "批量安装基础依赖",
  "node_ids": ["node_a", "node_b"],
  "command": "apk update && apk add curl bash"
}
```

Request body for script mode:

```json
{
  "mode": "script",
  "title": "批量初始化目录",
  "node_ids": ["node_a"],
  "script_name": "Alpine 目录初始化",
  "script_body": "#!/bin/sh\nset -e\nmkdir -p /opt/airport/bin\n"
}
```

Success response:

```json
{
  "operation": {
    "id": "op_xxx",
    "started_at": "2026-04-13T03:53:04.953Z",
    "finished_at": "2026-04-13T03:53:04.970Z",
    "duration_ms": 17,
    "status": "success",
    "summary": {
      "total": 2,
      "success": 2,
      "failed": 0
    },
    "targets": [
      {
        "node_id": "node_a",
        "status": "success",
        "transport_kind": "ssh-direct",
        "transport_label": "SSH 直连",
        "exit_code": 0,
        "finished_at": "2026-04-13T03:53:04.970Z",
        "duration_ms": 16,
        "output": ["[01:45:48] 建立连接 node-a (直连)"]
      }
    ]
  }
}
```

Returned target metadata now includes:

- `output_text`: string version of the full output
- `exit_code`
- `signal`
- `timed_out`
- `transport_kind`
- `transport_label`
- `transport_note`
- `started_at`
- `finished_at`
- `duration_ms`

## `POST /api/v1/shell/sessions`

为某台节点创建一个会话型 Web Shell。当前实现会优先尝试 SSH；若没有配置 `PLATFORM_SSH_PRIVATE_KEY_PATH` 或节点缺少可用 SSH 条件，则会自动退回控制面本机演示模式。

Request body:

```json
{
  "node_id": "node_xxx"
}
```

Success response:

```json
{
  "session": {
    "id": "shell_xxx",
    "node_id": "node_xxx",
    "status": "open",
    "transport_kind": "local-demo",
    "transport_label": "控制面本机演示",
    "transport_note": "未配置 PLATFORM_SSH_PRIVATE_KEY_PATH，当前会话运行在控制面宿主机。",
    "output": "[control-plane] 已创建 Web Shell 会话..."
  }
}
```

## `GET /api/v1/shell/sessions/:id`

获取某个 Web Shell 会话的当前状态与累计输出。

Success response:

```json
{
  "session": {
    "id": "shell_xxx",
    "status": "open",
    "updated_at": "2026-04-13T03:00:00.000Z",
    "closed_at": null,
    "output": "..."
  }
}
```

## `POST /api/v1/shell/sessions/:id/input`

向某个打开中的 Web Shell 会话写入原始输入。

Request body:

```json
{
  "data": "pwd\n"
}
```

Success response:

```json
{
  "session": {
    "id": "shell_xxx",
    "status": "open"
  }
}
```

## `DELETE /api/v1/shell/sessions/:id`

关闭某个 Web Shell 会话，并保留一段时间的最终输出供前端查看。

Success response:

```json
{
  "session": {
    "id": "shell_xxx",
    "status": "closed",
    "closed_at": "2026-04-13T03:01:00.000Z"
  }
}
```
