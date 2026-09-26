# 开源同类项目可借鉴清单

更新时间：2026-09-24（2026-09-26 只增量更新 A2 的状态：节点资源侧小时桶已落地，`probes.json` 探测历史仍未处理。其余条目本轮未复核，保持原样；其中 `⬜ 未实现` 类标记可能已过期，开工前按当前代码重验）
文档性质：外部参照与候选改造清单。**本轮只做调研，未改动任何代码**；本文所列"落点"是候选位置，不是已实施的计划。
关联文档：`docs/stability-roadmap.md`（缺口权威状态）、`docs/project-progress.md`（风险清单）、`docs/ui-layout-audit-2026-09-23.md`

## 0. 取证方法与可信度口径

三个只读调研窗口分别读 Marzban / Hiddify / CELERITY 系源码（读代码，不读 README 宣称），主会话对高价值结论逐条抽查复核。**每条证据都标了状态**：

| 状态 | 含义 |
| --- | --- |
| `已复核` | 主会话直接从 GitHub 抓到该文件正文并确认结论成立 |
| `窗口报告` | 子代理给出真实路径但未逐条复核，**开工前必须自己读一遍** |
| `未证实` | 只有 README 或第三方描述支撑，仅作背景，不可作为设计依据 |

三条必须先记住的口径修正：

1. **仓库归属易错**：`hiddifypanel` 这个 Python 包**不在** `hiddify/Hiddify-Manager` 里，`.gitmodules` 显示它是 submodule `services/panel/src` → 独立仓库 `hiddify/Hiddify-Panel`（`已复核`）。同理真同类的 owner 是 `ClickDevTech/CELERITY-panel`、`imrui/xray-pilot`、`ashvvvvv/mini-sb-agent`。
2. **语言不同不等于不能借**：这些项目是 Go / Python，我们是零依赖 Node。**只借设计（判据、数据形状、状态机），不借代码**。
3. **本文所有"代价"按我们的约束估**：不新增运行时依赖、JSON store 优先、无构建步骤、要能在 128MB 级节点与无 systemd 分支上跑。

## 1. 同类项目地图（我们在哪）

| 代际 | 项目 | 中心 | 与我们的关系 |
| --- | --- | --- | --- |
| 销售/订阅型 | `Gozargah/Marzban`+`Marzban-node`（Python, 7.4k★）、`MHSanaei/3x-ui`（Go）、`alireza0/s-ui`（Go, ~10k★）、`hiddify/Hiddify-Manager`+`Hiddify-Panel`（Python, 9.3k★）、`BPB-Worker-Panel`（CF Workers） | 用户 / inbound / 订阅 / 配额 / 收款 | 不是竞品：我们明确不做销售门户。但通用件最成熟 |
| 多节点纳管型（真同类） | `ClickDevTech/CELERITY-panel`（Node/JS, 208★）、`imrui/xray-pilot`（Go, 推配置+漂移检测）、`raypilot-xray-panel`、`p-manager/p-node`、`3m-ui` | 节点集群 + 配置下发 | 同代，但都不做"分层发布复检"和成本台账 |
| 节点侧小内存 | `ashvvvvv/mini-sb-agent`（Go, 42★, 自称 16MB RSS，面向 128/256MB NAT/LXC，支持 Xboard；`已复核` 仓库与描述存在，RSS 数字为 `未证实`） | 单节点 agent | 正对我们 LXC 节点现实 |

**我们目前没有开源对照物的能力**（跨三个窗口一致结论）：分层发布复检（生效层决定结论、可达层仅建议）、发布历史 + 回滚、云厂商成本台账与预算、任务中心与探测历史的可审计链路、零依赖 + 无构建 + JSON store。

## 2. A 组：低成本、直接闭已知待办

按建议开工顺序排列。

### A1 Reality 密钥对自动生成 —— 闭 #23

- 证据：`hiddify/Hiddify-Panel:hiddifypanel/hutils/crypto.py`（`已复核`）——`generate_x25519_keys()` 取 raw 字节后用 `_b64url_nopad()`（urlsafe base64 去 `=`）；short_id 由 `uuid4().hex` 截偶数长度随机构造。
- 我们的落点：Node 内置 `crypto.generateKeyPairSync("x25519")` 导出 JWK，`x`/`d` 两个字段就是同样的 base64url 无填充格式，**零依赖**。新建领域模块（建议 `src/domain/platform/reality-keys.js`），在渲染时注入；Reality 字段现集中在 `src/domain/releases/sing-box.js`（52 处引用）与订阅侧 `src/domain/shares/links.js`（21 处）。私钥只落节点，控制面不留存（与 P2.4 口径一致）。
- 代价：**低**。纯函数 + 单测可验收，不需要真机。
- 附带：`窗口报告` Hiddify 另有 ACME 自动签发与"节点实际证书状态回写 DB"（`sync_tls_store`），回写这个思路值得抄——把"证书/密钥不合规"从待办变成节点上报事实。

### A2 探测历史小时桶 + 调度器 coalesce —— 闭 gap「历史无限增长」

- 证据：`Gozargah/Marzban:app/jobs/record_usages.py`（`已复核`）——`created_at` 用 `strftime('%Y-%m-%dT%H:00:00')` 截到小时，先 insert-if-missing 再 `+=` 累加，**行数天然封顶**；注册处 `scheduler.add_job(..., coalesce=True, max_instances=1)`，上轮未跑完就跳过而不堆积。
- 我们的落点：`src/runtime/probe-scheduler.js`（231 行）加同语义的重叠保护；`probes.json` 拆成"原始近 N 小时 + 小时桶汇总"双层落盘，`docs/data-model.md` 同步登记新 store。
- 代价：**低**。注意别破坏现有 `test/` 里对探测历史的断言。
- 状态（2026-09-26）：**一半已落地，且落地的是另一半场景**。重叠保护两个调度器都有（`probe-scheduler.js:130`、`metrics-scheduler.js:52` 各自 `state.running` 短路）。小时桶这套已用于**节点资源采样**：`src/domain/metrics/collector.js` + `data/metrics.json`（桶 30 天裁剪、样本 240 条封顶），新 store 已登记进 `docs/data-model.md`。**`probes.json` 本身仍是单一数组、无上限**（`src/server.js` 里 `probeStore` 没有任何裁剪/聚合），所以本项按探测历史口径仍未关闭；好消息是桶的读写形状、增量口径与失败样本处理已被验证过，剩下的是搬运而不是设计。

### A3 配置漂移检测 —— 我们完全没有的能力

- 证据：`imrui/xray-pilot:pkg/ssh/client.go`（`已复核`）——`ReadRemoteFile` 用 `sh -lc 'test -s <quoted> && base64 < <quoted> | tr -d "\n"'`（stderr 不参与，避免污染 hash；路径走 `shellQuote`）；`UploadContent` 先写 `*.tmp` 再原子 `mv`。`窗口报告`：`pkg/crypto/crypto.go` 的 `HashConfig` 是规范化 JSON 后 SHA-256，`internal/service/sync.go:CheckDrift` 区分"配置源已变"与"远端被手改"，`internal/scheduler/scheduler.go` 只在状态跳变时记审计。
- 我们的落点：发布渲染时把 `rendered_config_hash` 存进 `config-releases` 记录；巡检周期读回远端配置，规范化后与"本次期望"和"上次实际"三向比对，写 `status=drifted`（只作建议，不改生效层结论）。落点在 `src/domain/releases/verification.js` 与 `src/domain/probes/executor.js`。
- 代价：**低**（约百行）。原子写 + shell 引号这两条纪律我们 `src/infrastructure/json-file-store.js` 侧已有同等实践，可直接对齐。

### A4 可达层判据升级 —— 口径 C 的下一步

- 证据：`hiddify/Hiddify-Panel:hiddifypanel/health_check/service.py`（`已复核`）。三点值得抄：
  1. **连接目标 / SNI / Host 三者解耦**：`_https_get(sni, host_header, connect_host, path)`。探一个没有合规证书的 IP 时，连该 IP 的 443，但 SNI 与 Host 取自 `first_valid_cert_domain()`（挑"有效非自签证书"的域名），从而保持 TLS 校验不被自签污染。
  2. **断言回显身份**：探测端点 `/<secret>/ip/<id>/` 直接返回 `ip_row.address`，判定条件是 `status==200 && body == 被测身份`。这比"端口能 connect"强一个量级——它证明 TCP→TLS→HTTP→应用整条链路路由到了正确后端。
  3. **证书层与连通层分开**：服务端 `handle_domain_health_request` 在证书无效时返回 **503 `certificate not valid`**；结论用 `finally` 无条件落到每个对象行的 `last_health_check / last_health_status / last_health_error`。另有一个 `health_secret_path`（不可猜的 URL 前缀）作为探测端点的轻量鉴权。
- 我们的落点：`src/domain/releases/verification.js` 已有分层骨架（`REACHABILITY_CHECK_NAMES` 聚合在 :699-700，逐节点 `reachability` 与 `skipped` 在 :588-615，`reachability_status`/`reachability_failures` 汇总在 :789-820）。这里补的是**检查项本身**：给 `reachability_failures[]` 增加 `layer: local | tls | port | echo`，并把"本机经核心出口出网"与"外部可达"拆成两个检查名；探测语句与前端展示（`public/js/shared/core-formatters.js:getReleaseReachability`、`releases-page.js`）同步。
- 代价：**低**（判据是纯函数 + 复用现有探测位）。注意：回显断言需要"我们自己掌控的服务端点"，我们的订阅/制品端点符合，业务代理端口不符合——所以对业务端口只能做到 TLS 层，别假装能 echo。
- `窗口报告`（未复核，先别当依据）：Hiddify 还有"L2 本机 `curl -x socks://127.0.0.1:1234` 借核心出口打外网"的判据，以及"健康检查无自动轮询、靠管理员 POST 触发"。前者与我们的诉求吻合但路径未核，后者是反面参考。

### A5 状态翻转才告警 + `/readyz` —— 闭 P1.1 + 补告警出口

- 证据：`窗口报告` CELERITY `src/services/probeModel.js` 有 `offlineNotified` 告警闩；`ClickDevTech/CELERITY-panel:src/services/webhookService.js` 的签名与投递形状（`sha256=` + HMAC(`ts.rawBody`)、`X-Webhook-Signature/Event/Timestamp`、事件白名单、5s fire-and-forget、带 `test()` 采样）。`已复核` 侧：`ashvvvvv/mini-sb-agent` 与 `panelserver` 的 `/health` 都是一行常量响应——`/readyz` 不需要复杂设计。
- 我们的落点：`src/runtime/probe-scheduler.js` 记 per-node `last_alert_state`，仅在 `success ↔ failed` 翻转时出站，发送失败静默不影响巡检；新增 `data/webhooks.json`；出站实现走内置 `fetch`，超时 5s。`/readyz` 返回 `{version, stores_loaded, scheduler_running, uptime_s}`，`/healthz` 保持"进程存活"语义不变。
- 代价：**低**。**但**：告警出站是对第三方发请求，按既有约束需你确认目标地址与凭证，不在无授权下自动化。

### A6 节点 capabilities 自报 —— 消除一类真实误报

- 证据：`窗口报告` `ashvvvvv/mini-sb-agent:cmd/mini-sb-agent/capabilities.go` 用 JSON 报告"这个二进制编译进了哪些协议"。
- 现状澄清（主会话核实）：我们 `src/domain/probes/capabilities.js`（201 行）**不是**这个语义——它判的是链路/中转的传输能力，不是节点二进制支持面。所以这条是新增能力，不是已有。
- 我们的落点：bootstrap 注册与初始化回传时采集 `sing-box version` + 子进程 `version` 输出的协议清单，存 `nodes.json` 探测事实；探测判定在"该节点未编译 HY2"时返回 `skipped` 而非 `failed`。落点 `src/domain/bootstrap/*` + `src/domain/probes/executor.js`。
- 代价：**低**。价值在于把"没编译"从故障里摘出去——这正是我们目前假集群与真机差异最容易咬人的地方。

### A7 SSH 主机密钥 TOFU —— 闭 #54（有可直接照抄语义的参考实现）

- 我们的现状（`已复核`）：`src/domain/platform/ssh.js:252` = `StrictHostKeyChecking=no`、`:254` = `UserKnownHostsFile=/dev/null` —— **完全不校验主机密钥**。
- 参考实现：`imrui/xray-pilot:pkg/ssh/client.go`（`已复核`）：首连自动信任并 `knownhosts.Line` 追加到 known_hosts；后续 `knownhosts.New` 严格比对；错误里 `KeyError.Want` 非空 = 已知主机但密钥不符 → **拒绝连接**并明说"可能存在中间人攻击"；主机 IP/域名变更走 `RemoveKnownHost`（按逗号分隔多主机字段过滤整行），避免旧条目导致误报 MITM；文件写入用互斥锁保护并发。
- 我们的落点：数据目录下 `known_hosts`（纳入 `scripts/backup-data-dir.sh` 备份清单）；`ssh.js` 去掉那两条参数；`nodes.json` 增加 `ssh_host_key_fingerprint` / `ssh_key_state: locked|pending_review` / `ssh_key_changed_at`；前端节点详情在 `pending_review` 时要求人工确认（与"高代价动作需确认"的既有口径一致）。
- 代价：**中**。Node 侧要自写 known_hosts 行解析（`ssh2` 无内建），且必须配套人工确认流程——只做存储不做拦截等于没做。

## 3. B 组：值得抄设计、代价要掂量（全部为 `窗口报告`，开工前逐条自读）

| 项 | 证据（待复核） | 我们的落点 | 代价 |
| --- | --- | --- | --- |
| API scope + 可撤销密钥 | `CELERITY-panel:src/models/apiKeyModel.js`：8 项 scope 枚举、`keyHash/keyPrefix/allowedIPs/rateLimit/expiresAt/lastUsedIP`、`timingSafeEqual`、列表 `select('-keyHash')`；`src/middleware/auth.js:requireScope` → 403 `{error, required}` | `data/api-keys.json` + `src/http/validators.js`/鉴权门禁中间件 | 低-中（动鉴权共享层，需显式征询） |
| 中转链路一等公民 | `CELERITY-panel:src/models/cascadeLinkModel.js`：`mode reverse|forward`、`portalNode/bridgeNode`、`priority`（值小优先且决定 forward 链路顺序）、`status pending|deployed|online|offline|error` + `lastError/latencyMs`；`cascadeService.js` BFS + visited | 我们现在把链路属性挂在节点列上（`窗口报告` 称 `src/domain/nodes/records.js:571-676` 的 `ssh_relay_node_id`/`proxy_host`，**未复核**）→ 抽 `data/relay-links.json`，拓扑视图与路径校验共用 | 中（迁字段 + 改视图数据源；顺带修掉评估轮记录的"拓扑分组键只按中转机导致入口段整组显示错误"缺陷） |
| 订阅多格式 | `MHSanaei/3x-ui:internal/sub/sub.go`：links / sing-box JSON / Clash YAML 三路，各自 `Enable + AutoDetect + UserAgentRegex`；`placeholders.go` 的 `{EMAIL}{ID}{SHORT_ID}{SUB_ID}` 白名单模板；`clash_yaml.go:quoteAmbiguousYAMLScalars`（YAML 歧义标量必须引号） | `src/domain/shares/links.js`（853 行，现只出 sing-box 侧）扩 `/sub/:token/{links,clash}` | 中（每种格式逐协议字段映射，且要防 remark 注入） |
| 备份 manifest + offsite | `CELERITY-panel:src/services/backupService.js`：`*-meta.json` 存加密密钥指纹、restore 前预检、本地与 S3 各自 `keepLast`、路径 basename 白名单 | `scripts/backup-data-dir.sh` 加 manifest 与 presigned PUT 上传（不引 SDK）；`install.sh`/`deploy-bare-metal.sh` 自动 `systemctl enable airport-backup.timer`（当前不启用，P0.5 已知） | 低（脚本级）；offsite 需凭证则中 |
| 小内存节点侧纪律 | `mini-sb-agent`：不引 `net/http`（手写 HTTP/1.1）、只拉不推 + ETag/304 + `schema_version/revision`、面板不可用时回落本地缓存、计数器带 `batch_id` 幂等至少一次、`sysctl tcp_rmem/wmem` 上限防 OOM | 巡检报文改条件拉取；节点侧脚本写明"控制面不可达→保持上次已验证配置"；`docs/deployment-bare-metal.md` 增补 128MB 机器的内核参数建议 | 中 |

`窗口报告` 另一条只记语义、暂不落设计：Marzban 的用量/日志保留与通知（小时桶外还有 `NotificationReminder` 2h 按 `expires_at` 清理、过期用户 6h 自动删、日志 tail 用 `deque(maxlen=100)` 定长环形缓冲）。其中 **Web Shell / 批量终端输出用定长环形缓冲**这一点，与我们 `src/domain/shell/*` 的诉求直接对得上，代价低。

## 4. C 组：明确不要抄（反参考）

1. **Marzban 的节点证书信任模型**（`已复核`：`Gozargah/Marzban:app/xray/node.py`）：`connect()` 每次现场 `ssl.get_server_certificate((address, port))` 当作 `verify`，**不落地指纹**；HTTP 侧 `SANIgnoringAdaptor` 设 `assert_hostname=False`，gRPC 侧 `check_hostname=False` + `verify_mode=CERT_NONE`。结果：节点换证书面板无感，中间人替换证书不会被发现。#54 要做的正是它跳过的那一步。
2. **Hiddify 的重启等待**（`已复核`：`Hiddify-Manager:scripts/restart.sh`）：`for i in {1..10}` + `sleep 1` 死等 `*active*`，无退避、无 jitter，且并发重启所有 service。我们调度器已有节流，别退化成轮询硬等。
3. **CELERITY 的 SSH**（`窗口报告`：通读 `src/services/sshPoolService.js` 无 `serverVerify`/`hostHash`/known_hosts）：Node 生态同类也普遍不做主机密钥校验——这是行业欠账，不是可以照抄的先例。
4. **Marzban 的失败处理**（`窗口报告`）：节点连接失败只写 `status=error + message`，**无退避**；巡检重叠靠 `coalesce` 而不是退避。我们借 coalesce，别借"无退避"。

## 5. 与现有待办/roadmap 的映射

| 缺口（权威状态见 `docs/stability-roadmap.md`） | 本文章节 | 状态 |
| --- | --- | --- |
| #23 Reality 密钥对生成 | A1 | 待办 → 可低成本闭 |
| 探测历史无限增长 | A2 | 仍未处理（`probeStore` 无上限）；节点资源侧的同形制小时桶已于 2026-09-26 落地，可直接复用其口径 |
| 配置漂移（无对应待办） | A3 | 新增能力 |
| 口径 C 的可达层判据（#24/#43/#50 的延续） | A4 | 已实施分层，判据可升级 |
| P1.1 `/readyz` + 无告警出口 | A5 | ⬜ 未实现 |
| 探测误报（未编译当故障） | A6 | 新增能力 |
| #54 SSH 主机密钥 TOFU | A7 | pending，参考实现已就位 |
| P0.5 备份 timer 不自动启用、无 offsite | B | ⬜ 部分 |
| P2.3 bootstrap token 明文 | — | 外部无对照，仍需自研哈希化 |
| P1.2 结构化日志 / `request_id` | — | 三个项目都没有，**无开源可抄**（Marzban 也只用 uvicorn 默认 logger） |
| P4.1 SQLite 迁移 | B(小内存纪律) | 同类全用 SQL；我们坚持 JSON 的话就是独一份，但要自备保留策略 |

## 6. 执行建议

- **顺序**：A1 → A2 → A3 → A4 → A6 → A5 → A7，再回头看 B 组。前六项不需要真机，A5 的出站与 A7 的人工确认流需要你的授权与 UI 配合。
- **门禁**：每项独立提交，改完跑 `npm run check` + `node --test`，A3/A4/A6 落新单测；A7 属 `src/domain/platform/ssh.js`（非我独占的共享层，但影响所有远程动作），必须单独一轮并配假集群复验。
- **真机边界**：拼好鸡供应商已恢复，但旗下 3 台 LXC 的可用性仍需取证后才能采信——2026-09-24 被动探测确认三台 sshd 均可达（NAT 口 `22010`、两台 `22`），但台账里三者 `status=degraded`、`last_seen_at` 为空，即**从未完成一次 SSH 纳管**；且控制面没有 host key 基线，无法区分"原机"与"已重装"。A3/A7 在纳管打通之前只能做到"实现 + 假容器验证"，别标成"已完成"，口径同 `docs/module-ui-optimization-plan.md` 的 deferred 清单。
- **纳管顺序已改**：原计划"控制台跑一行 bootstrap"经实测不成立——控制面无公网回连地址（`PLATFORM_PUBLIC_BASE_URL` 未设、本机无 `cloudflared`/`tailscale`/`ngrok`/`frpc`、无可当跳板的公网机），且平台 SSH 密钥仍是 `missing / can_generate`，注册成功也写不进公钥。三台的入站 SSH 已实测可达，所以真实卡点只有一条：**平台公钥进节点 root 的 `authorized_keys`**，不需要把控制面暴露到公网。顺序改为 控制台只读探测判生死 → 生成密钥 → 装公钥 → 控制面直连 SSH 验证（A7 的 TOFU 正好在这一步开始积累基线）。
- **不要**把 B/C 组任一 `窗口报告` 项直接开工：它们的文件正文我未逐条核验，历史上这类报告出现过"结论对、机制错"的情况。
