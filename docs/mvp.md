# MVP

更新时间：2026-09-22
文档性质：早期里程碑计划，保留作历史参照。里程碑的**实际交付状态**见本文末尾，当前范围以 `docs/current-state-prd.md` 与 `docs/project-assessment-and-roadmap.md` 为准。

## Product goal

Build a lightweight control plane that can register, track, and operate low-memory VPS nodes from multiple providers with minimal software installed on each node.

## Non-goals for v1

- full auto-scaling
- billing reconciliation with every provider
- permanent heavy agent on nodes
- complex workflow engine
- full observability stack in this repository

## Milestone 1: Node registration

Success means a newly created VPS can run one bootstrap command and appear in the system with a stable node ID and normalized facts.

Deliverables:

- bootstrap registration API
- node fingerprint deduplication
- normalized fact schema
- node list API
- bootstrap response contract for follow-up actions

## Milestone 2: Node initialization

Success means the control plane can push a standard Alpine initialization workflow to newly registered nodes.

Deliverables:

- SSH credential handoff during bootstrap
- task records for initialization jobs
- command execution abstraction
- default init template for Alpine nodes

## Milestone 3: Health and state

Success means each node has a health summary and lifecycle state visible in the platform.

Deliverables:

- probe result ingestion
- status model: `new`, `active`, `degraded`, `failed`, `disabled`
- health score calculation
- action recommendations based on probe results

## Milestone 4: Lifecycle automation

Success means the system can rebuild or replace nodes through provider integrations.

Deliverables:

- provider adapter interface
- create and destroy flow
- post-create bootstrap workflow
- reconciliation loop for orphaned or failed nodes

## Recommended first engineering sequence

1. implement registration API and persistence
2. add bootstrap shell script
3. add SSH key exchange and task queue
4. add node probe ingestion and health scoring
5. add one provider adapter end to end

## Actual delivery status (2026-09-22)

| Milestone | 状态 | 说明 |
| --- | --- | --- |
| M1 节点注册 | ✅ 已交付并超出范围 | 一行接入（服务端下发脚本）、指纹去重、事实归一、手动录入、引导命令 |
| M2 节点初始化 | ✅ 已交付并超出范围 | bootstrap 交接 SSH 公钥、任务落库、非交互执行通道、Alpine / Debian-Ubuntu / RHEL 三类基线模板、系统用户与系统模板批量下发 |
| M3 健康与状态 | 🟡 已交付，状态枚举收敛 | 探测入库、健康分、周期巡检、节点诊断；实际状态为 `new/active/degraded/failed`，`disabled` 未实现写入路径 |
| M4 生命周期自动化 | ⬜ 未开始 | 厂商模块只有台账与成本；无 provider adapter 接口、无建机/销毁、无对账与替换闭环 |

工程顺序 1–4 已完成；第 5 项（provider adapter 端到端）没有做，且已明确排后：当前优先级是先补稳定性（备份、`/readyz`、结构化日志、登录限流、SQLite）与链路事实（Endpoint/Link/Route），见 `docs/project-assessment-and-roadmap.md`。

早期非目标（自动扩缩容、厂商账务对账、常驻重 Agent、复杂工作流引擎、完整可观测栈）目前仍然成立。
