# 项目进度

更新时间：2026-09-23
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
| P1 节点接管与运维 | 已跑通，SSH 主机指纹信任仍缺 | 70% |
| P2 任务与状态闭环 | 进行中；缺租约、取消、可靠重试、任务详情页 | 65% |
| P2.5 统一配置发布 | 已跑通 VLESS/VMess/Reality/HY2；缺多跳与 RoutePool | 72% |
| P3 自动化与扩缩容 | 初期；只有台账与成本，无告警/自愈/建机 | 18% |

## 模块完成度

前端：总览 80 · 节点清单 78 · 节点详情 80 · 任务中心 72 · 运维终端 70 · Web Shell 62 · 注册令牌 80 · 接入用户 68 · 协议模板 70 · 发布中心 68 · 系统用户 66 · 系统模板 66 · 中转拓扑 62 · 云厂商 35 · 登录 85

后端：纳管链路 78 · SSH 接管 68 · 探测系统 70 · 批量执行 66 · 任务系统 62 · 统一发布 70 · 系统用户下发 68 · 系统模板下发 66 · 资产编辑/删除 82 · 分享订阅 70 · 持久化与恢复 52 · 鉴权与审计 45 · 自愈与自动化 22 · 厂商自动扩缩容 0

## 当前本地数据快照（非生产事实）

`data/` 已 gitignore，下列是本轮开发用 `npm run seed`（`scripts/seed-local-demo.js`）造出的本地演示配置，加上当前的真实运行态：

- 配置台账：接入用户 3 · 协议模板 3 · 节点组 2 · 厂商 3 · 系统模板 5 · 注册令牌 2
- 运行态：节点 0 · 任务 0 · 探测 0 · 操作 0（此前 7 台过期演示/真实节点已按要求删除，避免污染测试）
- 需要节点样本时改用 `docker/local-nodes/` 假集群（Debian + systemd、Ubuntu、Alpine + OpenRC），通过真实 bootstrap 流程注册，不再往 `data/` 手写演示节点

历史文档里“5 台真实节点 / 200 任务 / 224 探测”是某一时刻的生产快照，不应再作为现状引用。

## 当前主要风险

- JSON 无事务、跨文件一致性不足；SQLite 迁移仍是最大结构性欠债
- SSH 主机指纹未持久化信任，中间人风险与密钥轮换确认缺失
- `src/server.js` 仍 3805 行：路由已按命名空间拆到 `src/http/routes/`，剩下的装配/编排/实体构造未拆
- 路由模块的 `ctx` 偏重（nodes 40 项、access-users 19 项），纯函数依赖尚未下沉为直接 import
- 无 `/readyz`、无结构化日志与 `request_id`、无服务端登录限流
- 任务缺执行租约与取消；发布/探测失败无告警出口
- `data/` 自动备份尚未实现（只有单文件 `.bak`）
- Web Shell 无单用户/单节点会话数上限，仍非生产级 bastion
- 裸机部署的 amd64 分支未在真机复验（本机 Docker 是 arm64，Rosetta 模拟 systemd 不可信），OpenRC 分支也没有 `MemoryMax` 等价物

## 下一阶段优先级

P0：SSH host key 信任与变更确认 → 通用任务租约/取消/重试 → `/readyz` + 结构化日志 + 登录限流 → 每日数据备份
P1：JSON → SQLite（事务 + 唯一约束）→ Endpoint/Link/Route/RoutePool 实体化 → 国际出口与回国双向线路
P2：路由 `ctx` 瘦身（纯函数下沉为直接 import）+ 抽出服务层 → 统一协议兼容矩阵单一来源 → 告警与事件中心
P3：厂商 API 建机/替换 → 多管理员与 RBAC → 终端用户门户与配额
