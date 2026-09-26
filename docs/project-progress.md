# 项目进度

更新时间：2026-09-26
基线提交：`c77d27f`（2026-09-23 假节点按架构固定镜像 tag，并加入 Alpine/OpenRC 节点）+ 本轮控制面裸机部署改造；`46544c0`（2026-08-21）及之前的积累见下方“近期进展”

## 当前定位

项目是一个**单机形态的轻量代理节点控制面**：真实纳管节点、SSH 运维、周期探测、发布 sing-box 配置并生成订阅。已明显超出“节点台账平台”，也还不是多租户 SaaS、自动建机平台或生产级堡垒机。

产品定位与中长期路线见 `docs/project-assessment-and-roadmap.md`；现状能力边界见 `docs/current-state-prd.md`。

## 近期进展（2026-04-16 → 2026-08-21）

接入与纳管：

- 一键接入脚本改为服务端下发（`/bootstrap.sh`、`/bootstrap/enroll.sh?token=`），令牌可生成引导命令，重跑与失败重试链路已修复
- bootstrap 从 Alpine-only 扩展到 Alpine / Debian / Ubuntu / RHEL 家族，按 `os_id`/`os_family` 自动选择初始化模板；默认保留节点现有密码与 root 登录策略，SSH 加固改为显式 `--harden-ssh`
- 平台 SSH 密钥生成、托管与接管链路；operator session 持久化到 JSON，服务重启不再强制重登

协议与发布：

- 新增 Hysteria2（配置渲染、分享 `hysteria2://`、UDP/QUIC 探测）
- Reality 订阅元数据与分享修复；systemd 托管的 sing-box 发布激活
- 发布成功判定收紧为“校验 + 复检”，`rendered_only` 不再计为成功
- 业务链路模型区分公网入口与内部监听，新增 `route_direction`（国际出口 / 回国 / 区域中转）与已验证端点建模

稳定性与安全：

- JSON 原子写 + `.bak` 回读、store 单文件串行写队列、请求体 1 MiB 上限与 `413`、全局 HTTP 异常边界、异常 Host 回退
- 任务原子认领与 owner 终态保护、批量执行并发与单目标输出上限、重启遗留任务回收
- 生产环境禁止 SSH 失败回退控制面本机执行；畸形 Cookie 不再打崩进程；活跃会话续签 Cookie
- canonical 裸机安装/升级脚本（健康检查、失败回滚、`ProtectSystem=strict`、`MemoryMax`）

口径统一：

- 币种、计费周期、管理 SSH 默认端口（统一为 `22`，`19822` 退为 legacy 常量）抽成前后端单一来源
- 探测耗时口径拆分（`latency_source`），管理链路耗时不再冒充业务 RTT

控制台：

- 侧栏重组为节点运维 / 配置发布 / 系统管理三组；中转拓扑升级为世界地图
- 亮/暗主题持久化；模块级 UI 修复七轮（`docs/module-ui-optimization-plan.md`）

## 进展（2026-09-22，任务中心）

- 自动巡检从整块面板降级为一行状态条，首屏直接是任务池
- 任务池实时性：仅在有 `queued/running` 任务时每 15s 轮询，搜索输入防抖并恢复焦点与光标
- 探测诊断文案统一：原因/失败阶段改用 `probe-formatters.js` 单一来源，去除页面自造映射，去重“原始错误”
- 键盘与焦点可达：行 `tabindex` + `aria-label`、Enter/Space 选中、重渲染后按数据属性恢复焦点；`:focus-visible` 焦点环不再被吞
- “重新初始化”增加显式确认，说明会重启 `sshd`、覆写 `/etc/airport/node.env`，并点名目标节点
- 表格列宽改为状态驱动：详情栏展开时隐藏“说明”列，把宽度让给扫描列，避免动作按钮截断
- 复探按钮文案收敛，加载态不再撑破动作列

## 进展（2026-09-23，测试集群与控制面裸机部署）

本地测试集群：

- `docker/local-nodes/` 假节点镜像按架构固定 tag，避免 arm64 主机上被 amd64 镜像覆盖；新增 Alpine/OpenRC 节点，让发布链路覆盖无 systemd 分支
- 8080 实例上过期的演示节点已按要求删除，节点/任务/探测/操作快照归零；节点侧样本改用该假集群

控制面裸机部署（`scripts/deploy-bare-metal.sh`，由只支持 systemd 的版本演进）：

- 按「包管理器 × init 系统」分支：apt / apk × systemd / OpenRC，覆盖 Ubuntu / Debian / Alpine × amd64 / arm64；不支持的组合与无 init 的机器直接失败并说明原因
- 新增无 checkout 入口：`curl` 拉脚本后用 `sh` 执行，脚本自带 bash 引导前缀（Alpine 最小镜像没有 bash），源码可由 `AIRPORT_DEPLOY_REF` 指定
- OpenRC 分支：init 脚本 + `start_pre` 逐行导出环境文件、日志落 `/var/log/airport-control-plane.log`、pidfile 判活；systemd 分支保持原有加固项
- 在真实容器里跑通 `install` 与 `update`（Alpine 3.20 + OpenRC、Debian 13 + systemd），并用失败注入验证回滚会移除服务定义、停止服务且以非零退出，不误报成功
- 修复真实运行暴露的问题：清理阶段只删脚本自己创建的下载目录，不再碰调用方的源码 checkout
- 测试规模 20 文件 → 23 文件 / 97 用例

## 进展（2026-09-23，路由层拆分与并行开发底座）

- `src/server.js` 5763 → 3805 行：16 个业务命名空间的路由块逐字搬到
  `src/http/routes/<ns>.js`，由 `createApiRoutes(ctx)` 按原出现顺序派发；请求管线
  （登录页、`/api/v1/auth/*`、鉴权门、`/healthz`、bootstrap 脚本、订阅、产物下载、静态资源、404）
  仍留在 `src/server.js`，顺序未变
- 模块与宿主只靠 `ctx` 通信（store、持久化函数、领域构造器）；每个模块文件顶部的解构即其完整依赖清单
- 新增 `test/route-table.test.js`：真起一个 `node src/server.js` 实例（`PORT=0` + 临时数据目录），
  登录后按 78 条冻结矩阵比对状态码与 `error` 机器码，作为路由搬迁的回归网；测试规模 24 文件 / 98 用例
- `AIRPORT_DATA_DIR` 此前被硬编码路径架空，现已生效；监听日志改打实际端口（`PORT=0` 可用）
- `npm run check` 从只查 `src/server.js` 扩到全树逐文件 `node --check`
  （`node --check a.js b.js` 只检查第一个文件，多文件门禁会假绿）
- 新增 `docs/parallel-development.md`：模块边界卡片 + 边界提示词 + 多窗口并行的 worktree /
  端口 / 数据目录 / 共享文件 / 合并顺序约定

## 进展（2026-09-23，发布复检口径）

- 节点侧脚本重启 `sing-box` 后只 `sleep 1`，控制面单次 TCP/UDP 复检经常在端口起来前就判失败，
  把「已生效但还没监听」错报成发布失败（真实集群首发即踩到）
- 改为宽限重探：`verifyConfigReleaseAfterPublish` 先按节点收集失败目标，之后每轮等待
  `RELEASE_VERIFY_PROBE_RETRY_GAP_MS`(2000) 只重探仍失败的目标，最多 `RELEASE_VERIFY_PROBE_ATTEMPTS`(3) 轮；
  已通的节点不再参与等待
- 判定模型不变：宽限用尽后仍不通仍然是真实失败，不新增「降级」状态，`business_entry` 依旧计入必需检查

## 进展（2026-09-23，发布回滚：重新发布上一条）

- 新增 `POST /api/v1/config-releases/:id/rollback`，语义定为**回放目标发布存储的产物并生成一条新记录**，
  不是节点侧就地交换备份；脚本、制品、摘要链、任务、operation、复检全部复用正常发布链路
- 回放逻辑放在新的纯领域模块 `src/domain/releases/rollback.js`（`applyRollbackRenderPlans`、
  `buildRollbackUserDiff`、`buildDeploymentPlanDigest`）；`buildConfigReleaseDeploymentPlan` 里原来内联的
  12 行摘要计算抽成 `buildDeploymentPlanDigest`，回放后的摘要与正常发布由同一段代码算出
- 口径（本轮拍板）：只有 `status=success` 且不是该模板当前生效版本的发布可作为回滚目标；
  当前拓扑与目标发布的节点集合必须两侧完全一致，任何一侧漂移都整体 `400`，不做部分回滚；
  用户集差异照旧回放，但写进 `summary.rollback_diff` 并在前端提示
- 真实性取舍：Reality 私钥注入只看存储产物里是否还有占位符（模板后来改成 Reality 也不会给旧配置塞私钥）；
  回滚记录的 `active_user_count` / `skipped_user_count` 取目标发布的 summary，因为节点上跑的字节来自它
- 前端：发布列表每条可回滚记录加「回滚到此版本」+ 二次确认（列出目标版本、当前生效版本、
  回滚后拿不到配置的用户）；新增「当前生效」标记，「可回滚」tooltip 改为真实语义
- 测试规模 25 文件 / 110 用例；路由矩阵 91 条（新增回滚接口 404 与坏编码 400 两条）
- 验证边界：回滚的产物回放、摘要重算、拓扑与产物缺失的拒绝分支由 `test/release-rollback-plan.test.js`
  覆盖；接口在真实例上验证过 404 / 坏编码 400 / 目标节点已删除时的 `no valid nodes resolved` 400。
  **带真实节点的成功回滚尚未在假集群上跑过**，随任务 #43 一起补

## 进展（2026-09-23，六模块并行：接口面补齐 + 三处安全/一致性加固）

集成人按 `docs/parallel-development.md` 的模块卡片开了六个窗口（providers / node-groups、system、operations、
proxy-profiles、access-users、costs），各自在 `../wt-*` 独立 worktree 开发，全部 `--no-ff` 合入 `main`，
每次合并后重跑门禁。合并窗口里 providers 与 proxy-profiles 两窗交付时未提交，由集成人复核 diff、
重跑门禁后代为提交。

接口面（本轮新增，全部进了 128 行矩阵）：

- 单资源读：`GET /api/v1/{providers,node-groups,system-templates,system-users,operations}/:id`，`config-releases`
  的 `GET /:id` 仍缺（卡片已记）
- `POST /api/v1/proxy-profiles/:id/clone`（名称按「X 副本」避重）、`POST /api/v1/access-users/:id/share-token/regenerate`
- `GET /api/v1/operations?node_id=` 台账按节点过滤
- `PATCH /api/v1/nodes/:id/labels` 窄口标签编辑
- `POST /api/v1/config-releases/:id/rollback`

安全与一致性：

- 路径段解码统一走 `ctx.safeDecodePathSegment`，10 处 `decodeURIComponent` 的裸 `URIError` 500 改为 `400 bad_request`，
  矩阵补 `/%` 系列 11 行
- 公开产物下载 `GET /api/v1/artifacts/sing-box/:version/:target`：`version` 参与 `path.join`，`..%2F` 可越出
  `platform/artifacts` 读任意 gzip 文件。现在两段各自解码失败 → `400`，解析后的绝对路径必须落在 artifacts 目录内
- bootstrap token：`id` / `created_at` / `uses` / `last_used_*` 不再接受客户端传入，改由存量记录或 `randomUUID()` 决定，
  客户端只能提供 `token` 本身（查重在 validators 里已挡）
- 接入用户凭证校验：卡片原写成「按协议强制 uuid/password 必填」是**错的**——`buildAccessUserRecord` 会在缺省时自动生成
  （「留空由服务端生成」是有意设计）。强制必填会打断这条产品路径并引发订阅漂移，已回退为**只校验格式**
  （给了非空字符串才要求形如 UUID；HY2 密码给了才要求 ≥8 字符），类型与空串语义仍归 `validators.js`，
  卡片里已写明「不要改成必填」
- 协议模板写入口前置校验：名称查重（`409 profile_name_conflict`）+ 模板语义校验，克隆/编辑不再只在发布渲染时炸；
  连带修好 `scripts/seed-local-demo.js` 三条演示 profile 的 `security`/`reality`/`tls` 字段（旧种子数据在新门槛下 PATCH/clone 会 400）

判定取舍（未拍板前不动）：接入用户 `expired` 是派生显示还是定时落库；节点组缩容不一致返回 `warnings[]` 还是升 409；
探测未知 `node_id` 返回 404 还是空集；任务取消语义。costs 卡片里的「跨请求缓存」和「路由层 try/catch」经复核判为
**净负收益**（宿主没提供指纹 ⇒ 缓存是死代码；`createSafeRequestHandler` 已统一 500 且会打日志 ⇒ 路由内 catch 反而吞掉日志），
只保留其 1157 行成本领域单测。

规模：测试 25 文件 / 110 用例 → **32 文件 / 173 用例**；路由矩阵 91 → **128 行**；`src/server.js` 3849 → **3866 行**。

## 进展（2026-09-23，批次 2：platform / releases / probes + 接入真机前的三处收口）

批次 2 三个窗口合入 `main`：

- **platform**：新增 `GET /api/v1/platform/ssh-key` 只读复查口（`buildPlatformSshKeyView`，只暴露状态/算法/
  `SHA256:` 指纹/文件名，永不含私钥、绝对路径与公钥正文；重复生成改 `409 conflict`）；
  sing-box 镜像/同步前对 `version` 做安全路径段守卫。集成人另外把同一口径前移到**写入口**
  （`validatePlatformSingBoxDistributionUpdate`）：`version` 参与制品落盘与匿名下载的路径拼接，
  脏值一旦入库清不掉，所以写入即锁成单个安全段，而不是只靠两个读出口守。
- **releases**：`GET /api/v1/config-releases/:id`（`200 { release, detail }`，产物有界投影，
  全文出口指向 operations/订阅通道）。
- **probes**：零生产代码改动，75 条用例把探测健康分、降级口径与 `?node_id=` 读接口语义钉死
  （未命中是 `200 + {"items":[]}`；失败探测按分档给分不落 0；领域内**没有** staleness 概念）。
  另记 6 处读码缺口在模块卡片，其中最影响排障的是「诊断异常兜底会把已落库的 transport/预检快照覆写回 null」。

接入真机前由集成人直接落的两处收口：

1. **发布列表不再整表直出渲染配置**：`GET /api/v1/config-releases` 原样返回 store，而每条记录的
   `deployments[].artifacts.*.rendered_config` 是含用户凭证的完整配置文本，是当时最大的响应体与敏感信息面；
   现在与明细共用 `projectConfigReleaseForList`。前端零处读该字段，故无渲染口径变更。
   顺带修掉 `rendered_config_total_bytes` 每节点只累加第一个产物的下计数。
2. **操作启动回收**：任务与诊断早有 `running → failed` 的启动回收，`loadOperationStore` 没有 ——
   崩溃会让操作永久停在"执行中"、未跑完的 target 仍是 `pending`，页面进度与实际相反。
   现按 target 实际结果收口（全成 `success`、混合 `partial`、其余 `failed`）并落盘。

并行开发纪律补一条硬约束（`docs/parallel-development.md` §4）：窗口停实例只能按端口反查 PID 再 kill，
**禁止 `pkill -f "node src/server.js"`** —— 本轮就有一次窗口按命令行模式清理自己的 8091 探针实例，
连带杀掉了同机挂着的其他实例。

规模：测试 32 → **40 文件 / 280 用例**；路由矩阵 128 → **133 行**；`src/server.js` 仍 **3866 行**（本轮零改动）。

## 进展（2026-09-23，接入真机第二轮：发布判定分层 + 任务日志不再只留尾 8 行）

**#24 判定口径定为 C 并落地**：复检 5 项检查分成两层——生效层
（`rendered` / `config_validation` / `activation` / `subscription_entry`）与可达层（`business_entry`）。
只有生效层决定 `release.status` / `deployment.status` / `task.status` 与中转订阅准入；可达层单独成
`reachability_status` + `reachability_failures[]`，并把告警写进逐节点 `note`（发布中心已有的
`deployment.note` 渲染位就能看到，不需要新 UI）。
`verification.status` 原语义保留（含可达层的完整结论），供详情与后续告警出口用。

- 为什么：可达层不通最常见是厂商安全组没放行 / 节点防火墙 / 控制面出口被风控，而配置其实 `result=applied`。
  旧写法 `release.status = verification.status` 会把这种节点判成失败，而 `links.js` 的中转准入读的正是
  被覆写后的 `deployment.status` → 入口节点一抖，该落地机上所有 relay 线路整条从订阅消失，任务中心再记一条假失败。
  直连线路不受影响（它读 apply 层 `operation.targets[].status`），所以旧问题只在中转暴露。
- `subscription_entry` 归生效层而非可达层：它是平台内两份数据（发布入口 vs 订阅里的入口）的比对，
  不一致就是线路真的坏，不是网络抖动。
- 判定映射收成一个纯函数 `resolveDeploymentOutcome`（`src/domain/releases/verification.js`），发布尾部只消费它 ——
  发布逻辑在 `src/server.js` 里，import 即起服务，本身测不到。新增 6 条分层用例。

**#30 修掉**：`src/server.js` 与 `src/domain/tasks/lifecycle.js` 各有一份 `slice(-8)`，真机装失败时
刚好把最要紧的证据（apt/apk 报错、下载超时通常在前 10 行）切掉。统一成
`src/domain/tasks/log-excerpt.js`：头 12 行 + 尾 60 行、单行截 400 字符、中间插一行指明
`GET /api/v1/operations/<id>`（该接口本轮已在）；省略标记必须在中间，因为 `getTaskSummary` 取最后一行当列表摘要。

规模：测试 40 文件 / 280 → **42 文件 / 291 用例**。

## 进展（2026-09-23，13 模块 UI / 布局评估 + 窗口 B：假结论族收口）

真机纳管因供应商故障暂停，本轮转向页面 UI 与布局合理性：13 个模块各派一个评估窗口（读代码 + 六宽度实测 390/720/900/1013/1440/1920），我只做取证、汇总与否掉不实结论，清单落在 **`docs/ui-layout-audit-2026-09-23.md`**。

三条取证口径修正（影响全部判断）：`ox = scrollWidth − clientWidth = 0` 在 `body{overflow-x:clip}` 下**不能**证明无溢出；`.tiny` 全站只有颜色没有字号（次要说明落回 UA 16px）；4 个越界页共享同一条 DOM 链（`.panel` 从未拿到 `min-width:0`，表格 `min-width` 把 grid 轨道顶起来）。

用户拍板：F1 走**逐页 `minmax(0,1fr)`**（不进共享层），本轮只做**窗口 B（假结论族）**，窗口 A（共享层）与窗口 C（破坏性动作确认 + 各模块单点）排队。

- **B1（共享层根因）**：`runtime-api.js` 把每一次非 401 失败都吞成空集合、平台上下文失败回落 `probe_scheduler.enabled=false`，于是全站每个"0 条 / 未启用"都可能在说谎。现在三处取数点各自记录数据健康度（`dataHealth` + `recordCollectionHealth` / `getCollectionHealth`）并校验收体形状，调用方能区分"确实为 0"与"读不到"。
- **B2（任务中心）**：空态拆成"有筛选 / 读取失败 / 真的没有"三分支并给重试入口，巡检状态新增"未知"，`hasInFlightTasks()` 补 `new`（此前全 failed 的实例永不轮询），刷新补 `catch`，"数据没变就不打断"改为事实，数据时间超 300s 标过期。
- **B3（发布中心 / 协议模板）**：#24 定的分层口径 C 此前只落到后端，前端一个字没读 `reachability_status` → "sing-box 已生效但业务端口不通"仍显示绿色"可用"。现在按层渲染（`getReleaseReachability()` + 未通过/部分通过/未复检三种说法），生效层已判失败时不叠加可达层警示，配 6 项回归测试。
- **B4（批量终端）**：在途批次每 5s 自动收口（读失败保留上一次结果，不渲染成"没有执行记录"），运行中不再打印"[无输出] 后端未返回…"。
- 顺手修掉上一轮自身引入的回归：浅色主题下厂商页"另有 N 个未展示"虚线 chip 被高特异度分组规则盖得像真标签。

本轮也**否掉/降级**了几条评估结论（弹窗"完全不可用键盘"、"节点详情初始化在加载时自动触发"、"发布中心动作列不可达 P0"），并修正两条机制描述：系统用户/模板下发的回落目标是**该记录自带的 `node_group_ids`**而非"默认组"；登录限流的后端**已经**把重试秒数送到前端，是 429 分支自己覆盖了文案。

第十轮之前记在 `docs/module-ui-optimization-plan.md` 的"详情栏展开时隐藏说明列"这一手，本轮按证据重新定性为 P1：`note`（58–66 字的失败原因）全页只在被隐藏的那一列渲染，且 clamp 3 行无 ellipsis 无 title（@390 实测丢 21/15 字）——修在窗口 A。

规模：测试 42 文件 / 291 → **44 文件 / 309 用例**（`npm run check` 全量 `node --check` 通过）。

## 进展（2026-09-24，同类开源调研：借鉴清单，未实施）

回答"有没有同种类的开源平台"时顺手做了一轮源码级调研（三个只读窗口 + 主会话抽查复核），产出 **`docs/open-source-borrowing.md`**。**本轮零代码改动**，清单里每条都标了证据路径与可信度（`已复核` / `窗口报告` / `未证实`），`窗口报告` 项开工前必须自读。

定位结论：销售/订阅型面板（Marzban、3x-ui、s-ui、Hiddify）中心是用户与收款，我们明确不做；真同类是 `ClickDevTech/CELERITY-panel`、`imrui/xray-pilot`、`ashvvvvv/mini-sb-agent` 这一代多节点纳管；**分层发布复检（生效/可达两层）、发布回滚、厂商成本台账与预算、可审计的任务中心与探测历史，四项没有开源对照物**。

已亲自复核、可直接落到我们代码的做法（编号沿用该文档）：Reality 密钥对用内置 `crypto` 生成（A1，闭 #23）；探测历史按小时桶聚合 + 调度器 coalesce（A2）；配置漂移用"规范化后 hash + `base64 <` 读回 + `.tmp` 原子替换"（A3，**我们此前完全没有这个能力**）；可达层把"连接目标 / SNI / Host"三者解耦并断言回显身份、证书无效返回 503（A4）；状态翻转才告警 + 常量 `/readyz`（A5）；节点自报二进制支持面，避免"没编译"误判为"挂了"（A6）；SSH known_hosts TOFU 的完整语义（A7，#54）。

同时记下三条**反参考**（明确不抄）：Marzban 每次重连现场拉节点证书当信任锚且不落地指纹（正是 #54 要避免的）、Hiddify 重启靠 `for i in {1..10} sleep 1` 硬等、CELERITY 完全没有 host-key 校验。

调研过程也纠正了我自己前一版的两处错误：低星同类项目的 owner 当时按显示名推断，`CELERITY-project/*`、`rroula/xray-pilot`、`misakacpp/mini-sb-agent` 三个链接都错；`hiddifypanel` 也不在 `Hiddify-Manager` 仓库里，而是 `.gitmodules` 指向的独立仓库 `hiddify/Hiddify-Panel`。教训与 UI 评估轮同源：**外部结论必须抓到文件正文才算取证**。

## 进展（2026-09-26，节点资源监控：cgroup 口径采集 + 小时桶 + `/metrics.html`）

节点侧不装常驻 agent，也没有可信的 `/proc/meminfo`：LXC 容器里 `free`、`nproc`、meminfo 报的都是**宿主**值。
唯一诚实的口径是 cgroup v2，所以 `scripts/node/metrics-collect.sh`（145 行纯 POSIX/busybox，`sh -s` 管道下发，不装包）
只读 `/sys/fs/cgroup/` 下的 `memory.max|memory.current|memory.events|cpu.max|cpu.stat`、`df` 和 `netstat`，
输出 `key=value` 快照；解析、聚合、落盘全在控制面 `src/domain/metrics/collector.js`（502 行）。

接口与调度：

- `POST /api/v1/metrics/collect`：`node_ids` 留空＝对全部 `active/degraded/failed` 节点采集；未知 id **整条请求 400**（不做部分接受）；单节点采集失败仍回 `200`，但留下一条 `status` 非 success 的样本。
- `GET /api/v1/metrics?node_id=&limit=`：返回小时桶，`limit` 默认 40 / 上限 200，`failures[]` 带最近 10 条非成功样本。
- 周期采集复用探测调度器的形态：`AIRPORT_METRICS_ENABLED`(true)、`INTERVAL_MS`(300000)、`JITTER_MS`(15000)、`TIMEOUT_MS`(30000)，默认 5 分钟一次。
- 净流量按桶内首末两点做差，不足 2 点该小时给 `null` 而不是 `0`；`cpu_nr_throttled` / `mem_events_*` 是**累计**计数器，只有窗口差值有意义。
- 修掉一处死状态：`recordSample` 原来在 `status!=="success"` 时直接 `return`，桶根本拿不到，于是 `bucket.failed_count` 永远写不进去——前端"采集失败"这条信号在旧代码里是不可能出现的。现在失败只累加 `failed_count`、**不进 `count`**（`count` 是均值分母，掺失败点会稀释平均值）。
- 容量：样本 240 条封顶，桶按 30 天裁剪；`metrics.json` 是唯一带兄弟数组 `samples` 的 store。

前端 `/metrics.html`（Operate 模式，一节点一卡：CPU/内存/磁盘三条配额计 + CPU 趋势柱 + 本小时净流量 + 告警 chip + 外来监听端口 + 顶部四个统计）。取证后改掉的口径问题：

- 内存条读 `summary.mem_limit_bytes`、磁盘读 `summary.disk_used_pct`——**后端两个字段都不存在**，两条计永远画"-"。改为 `mem_max_bytes` 与 `ratioPct(disk_used_mb, disk_total_mb)`，与桶口径同源。
- 累计计数器原来当告警用，每张卡每次都挂 chip。改成窗口增量并写明 `· 近 N 小时`（`小时跨度`由首末桶反推），累计值只放 `title`；OOM chip 改为点名发生的小时。
- 这些机器常年 CPU <1%，按配额出图是一条 1.76px 的平线。柱子高度按**窗口峰值**归一并给 12% 下限，颜色仍按占配额比例——趋势可读，严重程度也不被夸大；标题标"按窗口峰值归一 + 峰值 X%"，并给柱区加基线，避免空闲节点看起来像整块缺失。
- 本小时只有 1 次采样时增量算不出来，原来显示 0 冒充"没有流量"。现在退到最近一个有区间的小时，并把标题改成 `<时刻>流量`。
- 外来监听端口去重，netstat 被截断的程序名清理干净（`658/bin/xray-linux-` → `xray-linux`）；全是平台进程时说"监听 1 个端口（22），全部由平台服务持有"。
- 顶部"需关注"与卡片 `tone-danger` 用同一条阈值线（配额 ≥90% / 有失败记录 / 端口被非平台进程监听），首屏数字必须能指到需要点开的机器。

验证边界：拿 BR/US/JP **三台真机各自真实抓到的采集输出**灌进临时实例（`AIRPORT_DATA_DIR` 隔离），浏览器实测 1440/900/720/480 无横向溢出。US 的 93% 内存按 `tone-danger` 渲染，"外来监听 3/4 个端口"列出 `62789 · xray-linux`、`12942 · xray-linux`、`56316 · x-ui` —— 这正是 #73/#74 要的证据；BR/JP 均为"监听 1 个端口（22），全部由平台服务持有"。**截图通道本机不可用**（`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`），逐条比的是 DOM 与 computed style，视觉效果需人工确认。

8080 实例（用户日常看的那台）在 `--watch` 自动重载后已经**按 5 分钟节奏真的在跑采集**：`data/metrics.json` 从 11:37Z 起每轮给 6 台节点各写一条样本。但这 6 台全是 `source: "manual"` 的台账记录、`last_seen_at` 为 `null`（从未纳管、没有 SSH 信任基线），所以 84 条样本逐条 `status="unavailable" / error="当前节点缺少可用执行通道"`，桶里只有 `failed_count`。**调度与落盘是真的，页面在这台上现在必然整屏"暂无可用数据"** —— 卡点是纳管（#67），不是监控代码；有纳管真机的是 HK VPS 实例，那里的渲染还需单独确认。

A2（`docs/open-source-borrowing.md`）**没有因此关闭**：本轮的小时桶是**节点资源**采样，`probes.json` 的探测历史仍是单数组、无上限聚合。

规模：测试 44 文件 / 309 → **45 文件 / 321 用例**；路由矩阵 133 → **138 行**（`/metrics.html`、`/metrics`、`GET /api/v1/metrics`、`GET …/collect` 404、`POST …/collect` 400）；`src/server.js` 3866 → **3924 行**。

## 已跑通的主链路

1. 未登录访问自动跳登录页，登录后按 `next` 回原页
2. 节点执行一行接入命令 → 上报事实 → 去重建档 → 回传公钥与初始化动作
3. 控制面按管理链路（直连 / 中转 / `tcp_forward`/`exec_nc`）SSH 接管，执行初始化、系统用户、系统模板、批量操作
4. 周期巡检与手动复探写入健康状态，管理链路与业务链路分段
5. 选择接入用户 + 协议模板 + 节点组 → 渲染 sing-box 配置 → 校验 → 下发 → 重启 → 失败回滚
6. 按“最近一次有效发布 + 线路解析结果”输出节点级订阅、聚合订阅、二维码

## 阶段进度

| 阶段 | 状态 | 完成度 |
| --- | --- | --- |
| P0 节点纳管底座 | 已跑通 | 88% |
| P1 节点接管与运维 | 已跑通；资源采样定时链路已在真实例上跑起来，但只对有 SSH 通道的节点出数，SSH 主机指纹信任仍缺 | 70% |
| P2 任务与状态闭环 | 进行中；缺租约、取消、可靠重试、任务详情页 | 65% |
| P2.5 统一配置发布 | 已跑通 VLESS/VMess/Reality/HY2；缺多跳与 RoutePool | 72% |
| P3 自动化与扩缩容 | 初期；只有台账与成本，无告警/自愈/建机 | 18% |

## 模块完成度

前端：总览 80 · 节点清单 78 · 节点详情 80 · 任务中心 72 · 节点监控 65 · 运维终端 70 · Web Shell 62 · 注册令牌 80 · 接入用户 68 · 协议模板 70 · 发布中心 68 · 系统用户 66 · 系统模板 66 · 中转拓扑 62 · 云厂商 35 · 登录 85

后端：纳管链路 78 · SSH 接管 68 · 探测系统 70 · 节点资源采样 60 · 批量执行 66 · 任务系统 62 · 统一发布 70 · 系统用户下发 68 · 系统模板下发 66 · 资产编辑/删除 82 · 分享订阅 70 · 持久化与恢复 52 · 鉴权与审计 45 · 自愈与自动化 22 · 厂商自动扩缩容 0

## 当前本地数据快照（非生产事实）

`data/` 已 gitignore，下列是本轮开发用 `npm run seed`（`scripts/seed-local-demo.js`）造出的本地演示配置，加上当前的真实运行态：

- 配置台账：接入用户 3 · 协议模板 3 · 节点组 2 · 厂商 3 · 系统模板 5 · 注册令牌 2
- 运行态：节点 0 · 任务 0 · 探测 0 · 操作 0（此前 7 台过期演示/真实节点已按要求删除，避免污染测试）
- 需要节点样本时改用 `docker/local-nodes/` 假集群（Debian + systemd、Ubuntu、Alpine + OpenRC），通过真实 bootstrap 流程注册，不再往 `data/` 手写演示节点

历史文档里“5 台真实节点 / 200 任务 / 224 探测”是某一时刻的生产快照，不应再作为现状引用。

## 当前主要风险

- JSON 无事务、跨文件一致性不足；SQLite 迁移仍是最大结构性欠债
- **节点配置漂移不可见**：纳管后有人在机器上手改配置，控制面没有任何手段发现（`docs/open-source-borrowing.md` A3 给了低成本做法）
- SSH 主机指纹未持久化信任，中间人风险与密钥轮换确认缺失
- `src/server.js` 仍 3864 行：路由已按命名空间拆到 `src/http/routes/`，剩下的装配/编排/实体构造未拆
- 路由模块的 `ctx` 偏重（nodes 40 项、access-users 19 项），纯函数依赖尚未下沉为直接 import
- 无 `/readyz`、无结构化日志与 `request_id`（登录限流与失败锁定已有）
- 任务缺执行租约与取消；发布/探测失败无告警出口
- 节点资源监控只到"页面能看"：没有阈值告警出口，且**只有纳管节点能出数**——8080 台账里的 6 台真机没有 SSH 通道，页面对它们是整屏"暂无可用数据"
- `data/` 备份已就位（`scripts/backup-data-dir.sh` + `scripts/systemd/airport-backup.{service,timer}`），但 `deploy-bare-metal.sh` 不会启用该 timer，需手工 `systemctl enable --now`；恢复流程未在真机演练
- Web Shell 无单用户/单节点会话数上限，仍非生产级 bastion
- 裸机部署的 amd64 分支未在真机复验（本机 Docker 是 arm64，Rosetta 模拟 systemd 不可信），OpenRC 分支也没有 `MemoryMax` 等价物

## 下一阶段优先级

P0：Reality 密钥对自动生成（#23，纯内置 `crypto`，做法见 `docs/open-source-borrowing.md` A1）→ SSH host key 信任与变更确认 → 通用任务租约/取消/重试 → `/readyz` + 结构化日志 → 真机启用备份 timer 并演练恢复 → UI 窗口 C（4 处破坏性动作加确认、节点清单属性转义 bug、令牌有效期入口）
P1：配置漂移检测（A3）与探测历史小时桶聚合（A2，仍是 `probes.json`，节点资源桶已另立）→ 监控数据的下一步：监听清单回写节点台账并标外来进程（#74，页面已给出证据）、facts 资源口径统一到 cgroup（#77）、NAT 端口映射建模（#78）→ UI 窗口 A（逐页 `minmax(0,1fr)` 收口 F1、字号标度、dialog 语义与焦点、12 页缺页面标题层、断点统一、`.table-shell` 滚动线索、登录页两处）→ JSON → SQLite（事务 + 唯一约束）→ Endpoint/Link/Route/RoutePool 实体化 → 国际出口与回国双向线路
P2：路由 `ctx` 瘦身（纯函数下沉为直接 import）+ 抽出服务层 → 统一协议兼容矩阵单一来源 → 告警与事件中心
P3：厂商 API 建机/替换 → 多管理员与 RBAC → 终端用户门户与配额
