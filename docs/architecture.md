# Architecture

更新时间：2026-09-23

本文分两部分：**当前实现**（可以依赖的事实）与**目标形态**（尚未实现的方向）。两者刻意分开写，避免把路线图能力误读成现状。

## Design principles

- 控制面集中：调度、决策、状态都在控制面进程内。
- 节点侧无常驻 Agent：一次 bootstrap 接入，之后靠 SSH 与一次性脚本。
- 边缘足迹极小：节点只需 shell、curl、OpenSSH，Alpine / Debian-Ubuntu / RHEL 家族均可接入。
- 管理链路与业务链路分离：SSH 接管路径与用户流量路径是两套字段、两套探测。
- 数据面不由控制面进程承载：转发由节点侧 sing-box 等成熟组件承担。

## Current implementation

### 进程形态

单个 Node.js 进程（`node:http`，无 Web 框架）承载 API、任务执行、周期巡检、配置发布、订阅生成与 Web Shell 会话。前端是无打包链的静态多页面控制台，业务后端依赖只有 `qrcode`。

```
src/server.js            启动装配 + 请求管线 + 实体构造（3.8k 行）
src/http/routes/         16 个业务命名空间路由模块 + index.js 派发表（见 docs/parallel-development.md）
src/domain/              领域逻辑：auth bootstrap costs diagnostics nodes operations
                         platform probes releases routes shares shell system tasks
src/http/validators.js   入站 payload 校验
src/infrastructure/      json-file-store（原子写 + .bak）、store-persistence（写队列、启动修复）
src/runtime/             startup（load + 幂等迁移 + 修复）、probe-scheduler
src/utils/               http、request-handler（全局异常边界）、static-assets
public/                  15 个 HTML 页面 + js/{pages,modals,cells,layout,store,shared,auth}
data/                    每 store 一个 JSON 文件（gitignore，路径可用 AIRPORT_DATA_DIR 覆盖）
scripts/                 bootstrap.sh、deploy-bare-metal.sh、deploy-production.sh、seed-local-demo.js
docker/local-nodes/      本地假节点集群（Debian+systemd / Ubuntu / Alpine+OpenRC）与真实发布 E2E 脚本
test/                    32 个 node:test 文件（含 route-table：真起服务比对 128 条路由响应）
```

路由层的形状：`src/server.js` 依次执行登录页跳转、`/api/v1/auth/*`、鉴权门、`/healthz`、
`/bootstrap.sh`、`/bootstrap/enroll.sh`、`/sub/:token`、产物下载、静态资源，然后把请求交给
`createApiRoutes(ctx)` 返回的 handler 数组；server.js 用 `reply.headersSent ||
reply.writableEnded` 判断某个模块是否已经应答，未应答才继续下一个命名空间，最后 404。
模块与宿主之间只有一个通道 `ctx`（store 数组、持久化函数、领域构造器），每个模块文件顶部的
解构就是它的完整依赖清单。

### 请求边界

`createSafeRequestHandler` 包裹全部请求：请求体上限 1 MiB（超限 `413` 并销毁连接）、无法解析的 `Host` 回退 `localhost`、未捕获异常统一 `500 { error: "internal_server_error" }`。鉴权与公开接口的白名单在 `src/server.js` 集中判定，详见 `docs/api.md`。

### 三个平面（现状）

```
控制平面  API + 实体构造 + 发布计划 + 任务编排           已实现，单进程
数据平面  节点侧 sing-box / HAProxy / TCP 转发            已实现，由发布写入并重启
观测平面  周期巡检 + 手动复探 + 节点诊断 + 健康分          已实现，无告警
```

### 关键数据事实

- 持久化是每实体一个 JSON 文件，原子写 + 单文件串行写队列 + 启动期修复；**没有事务、没有跨文件一致性**。
- “迁移”是启动时幂等修复函数，没有 migration 账本。
- 业务路由当前由 `node.networking.*` + `node.endpoints.*` + `AccessUser/ProxyProfile/NodeGroup` 在读取时解析成 `TrafficRoute`，序列化后随 `ConfigRelease.routes[]` 落库；独立的 `Endpoint / Link / Route / RoutePool` 实体仍是设计目标。

### 当前架构的硬边界

- 只适合单机部署，不支持多实例并发写。
- Web Shell 会话与内存态运行信息重启即丢失（管理员会话已落盘）。
- 没有正式队列中间件、告警、审计与自动回滚控制面。
- API、执行、探测、发布同进程，压力与故障域集中。

## Target shape（未实现）

### 组件分解（目标，非现状）

| 组件 | 状态 |
| --- | --- |
| API server | 已实现（与下述组件同进程） |
| Inventory / 事实与资产管理 | 已实现 |
| Task orchestrator | 已实现原子认领；缺租约、取消、可靠重试 |
| Probe service | 已实现主动探测；**外部探测结果上报接口不存在** |
| Provider adapters（建机/销毁） | 未实现，厂商模块只有台账与成本 |
| Panel / NMS adapters | 未实现 |
| postgres / redis / blackbox_exporter / prometheus | 未采用；近期路线是 SQLite 而非 PG/Redis |

### 内部边界拆分顺序

1. HTTP 路由层（已完成，实际目录是 `src/http/routes/*`）
2. 节点与 Endpoint 服务
3. 任务执行与租约
4. 探测与质量评分
5. Route / RoutePolicy 解析器
6. 发布计划与执行器
7. 订阅与分享生成器
8. repository 与事务层

### 部署形态

当前 canonical：裸机部署（专用 `airport` 用户、`/opt/airport-control-plane`、HTTPS 由反向代理终结），按「包管理器 × init 系统」分支覆盖 Ubuntu / Debian / Alpine × systemd / OpenRC × amd64 / arm64；systemd 分支带 `MemoryMax=256M`、`ProtectSystem=strict`、`ReadWritePaths=<data>`，OpenRC 分支用 init 脚本 + 环境文件导出，没有 `MemoryMax` 等价物。见 `docs/deployment-bare-metal.md`。Docker/Compose 保留为兼容路径，不是低配主路径。横向扩展、多实例 HA 不在近期范围。

## Historical notes

早期文档设想的 `src/application` + `src/adapters` 目录结构没有采用；实际落地是 `src/domain` + `src/http` + `src/infrastructure` + `src/runtime` + `src/utils`。领域边界的原则保留，目录命名与实现方式已按当前代码记录。
