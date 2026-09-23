# Airport Control Plane

单机运行的轻量代理节点控制面：一台低配机器上的 Node.js 服务，负责节点纳管、SSH 接管、探测巡检、任务执行、配置发布和资产台账。

面向的场景是"手里有一批 VPS / 轻量云节点，需要一个自己的控制面把它们收口"，而不是多云自动建机平台。厂商 API、面板适配、自动扩缩容目前仍是未实现项。

## Current scope

已落地：

- 一行 `bootstrap.sh` 完成节点注册（Alpine / Debian-Ubuntu / RHEL family）
- 平台 SSH 密钥托管与节点接管，TCP + SSH 两层探测，周期巡检调度
- 初始化模板、系统模板、系统用户的批量下发与终端回显
- 接入用户 / 协议模板 / 节点组 / 发布记录，`sing-box` 真实渲染 + 校验 + 回滚（VLESS / VMess / Hysteria2，TLS / Reality）
- 中转链路模型（直连 / 中转、入口端口与内部端口分离）
- 资产台账（厂商、区域、到期、计费周期、流量、成本）与订阅分享页
- 控制面 session 登录保护、SQLite 之前的 JSON 原子写入与串行写队列

未落地：云厂商自动建机、面板/NMS 适配、告警与自愈、数据库化、多实例。

## Tech shape

- 零框架：单个 `node:http` 进程，全部路由在 `src/server.js`
- 前端：静态多页 + 原生 ES module，无构建步骤，样式走 `public/styles/tokens.css` 设计变量
- 持久化：`data/*.json`，一 store 一文件，原子写入 + `.bak` 回退 + 启动修复
- 唯一运行时依赖：`qrcode`
- Node `>= 20`

## Quick start

```bash
npm install
npm run dev        # 或 npm start；热重载用 dev
```

服务默认监听 `http://localhost:8080`（可用 `PORT` 覆盖），打开后会跳到 `/login.html`。

登录凭据只来自环境变量，服务不会读取 `.env` 文件（systemd 部署走 `EnvironmentFile`）。未配置密码时，控制面会临时生成一个随机管理员密码并打印在启动日志里，日志中同时会出现"已启用临时账号"告警：

```bash
CONTROL_PLANE_AUTH_USERNAME=admin \
CONTROL_PLANE_AUTH_PASSWORD='改成你的强密码' \
npm run dev
```

`OPERATOR_USERNAME` / `CONTROL_PLANE_USERNAME` 与 `OPERATOR_PASSWORD` / `CONTROL_PLANE_PASSWORD` 是等价别名。

会话 cookie 名为 `airport_operator_session`，落盘在 `data/operator-sessions.json`，服务重启不会踢出已登录的操作者。

其他 npm 脚本：

```bash
npm test           # node --test，当前 23 个测试文件 / 97 个用例
npm run check      # node --check src/server.js，语法门禁
npm run seed       # 生成/刷新本地演示数据（scripts/seed-local-demo.js）
```

`npm run seed` 只写本地 `data/`（该目录不入库），用于在没有真实节点时把页面填满。

## Page inventory

`public/` 下的页面与侧栏分组：

- 节点运维：`index.html` 总览、`nodes.html` 节点清单、`node.html` 节点详情、`shell.html` 单节点 Web Shell、`terminal.html` 批量终端、`routes.html` 中转拓扑、`tasks.html` 任务中心
- 配置发布：`access-users.html` 接入用户、`proxy-profiles.html` 协议模板、`releases.html` 发布中心、`system-users.html` 系统用户、`system-templates.html` 系统模板
- 系统管理：`tokens.html` 注册令牌、`providers.html` 云厂商与成本
- 无需登录：`login.html`、`/bootstrap.sh`、`/bootstrap/enroll.sh`、健康检查、公开制品下载

## Node enrollment

在「注册令牌」页创建 token 后，页面会直接给出可复制的一行命令（含控制面基地址与 token）：

```bash
sh scripts/bootstrap.sh \
  --server http://localhost:8080 \
  --token <your-bootstrap-token>
```

控制面在节点没有记录 `ssh_port` 时默认使用 `22`。`bootstrap.sh` 本身保持机器当前的 `sshd` 端口，除非显式传 `--ssh-port`。

当节点出网公网 IP 与入站 SSH 入口不一致时（NAT、LXC/LXD、宿主端口映射、中转型厂商），显式覆盖入口信息。LXC 里通常内部 `sshd` 仍监听 `22`，而 `--ssh-port` 要填外部映射端口：

```bash
sh scripts/bootstrap.sh \
  --server http://localhost:8080 \
  --token <your-bootstrap-token> \
  --public-ipv4 203.0.113.10 \
  --ssh-port 2222
```

也可覆盖 `--public-ipv6`、`--private-ipv4`、`--ssh-user`，以及
`--provider`、`--region`、`--role`、`--access-mode direct|relay`、`--entry-region`、
`--relay-node-id`、`--relay-label`、`--relay-region`、`--route-note`、`--harden-ssh`。
完整参数以 `sh scripts/bootstrap.sh` 不带参数时的 usage 输出为准。

Example registration request:

```bash
curl -X POST http://localhost:8080/api/v1/nodes/register \
  -H 'content-type: application/json' \
  -d '{
    "bootstrap_token": "<your-bootstrap-token>",
    "fingerprint": "sha256:example-fingerprint",
    "facts": {
      "hostname": "alpine-sin-01",
      "os_name": "Alpine Linux",
      "os_version": "3.21",
      "arch": "x86_64",
      "public_ipv4": "203.0.113.10",
      "private_ipv4": "10.0.0.10",
      "cpu_cores": 1,
      "memory_mb": 512
    }
  }'
```

## Production deployment

当前架构（单机 JSON 存储）推荐的上线形态是裸机部署：

- 独立 `airport` 系统用户
- `/opt/airport-control-plane` 应用与数据目录
- 由本机 init 系统托管：systemd 走资源限制与重启策略（`MemoryMax`、`ProtectSystem=strict`、`ReadWritePaths` 限定数据目录），OpenRC 走等价 init 脚本 + 环境文件导出
- HTTPS 由反向代理终结

支持 Ubuntu / Debian / Alpine × systemd / OpenRC × amd64 / arm64；不支持的组合直接失败并说明原因。已有 checkout 时：

```bash
sudo bash scripts/deploy-bare-metal.sh install
```

服务器上不想装 git 时，直接拉脚本执行（Alpine 最小镜像没有 bash，所以用 `sh` 起步）：

```bash
curl -fsSL https://raw.githubusercontent.com/augus7737/airport-control-plane/main/scripts/deploy-bare-metal.sh -o /tmp/airport-deploy.sh
sudo AIRPORT_DEPLOY_REF=main sh /tmp/airport-deploy.sh install
```

For upgrades:

```bash
git pull
sudo bash scripts/deploy-bare-metal.sh update
```

部署脚本在暂存目录安装生产依赖，激活前执行 `npm run check` 语法门禁（完整 `npm test` 需显式设置 `AIRPORT_RUN_FULL_TESTS=true`），随后重启服务、等待 `/healthz` 通过，不健康时回滚代码和服务定义。已有的 `.env.production` 凭据会在首次执行时迁移。

完整说明见 `docs/deployment-bare-metal.md`。

`install.sh` + `docs/deployment.md` 的 Docker / Compose 链路仍然可用，但定位为兼容性/可选路径，不是低配主机的首选。

一点部署安全提醒：`AIRPORT_ENABLE_LOCAL_DEMO_TRANSPORT=true` 会让 SSH 传输层退化到在控制面本机执行命令，仅用于离线演示，生产环境必须保持 `false`（默认值）。

## Product direction

控制面内核保持薄，后续扩展方向：

- 云厂商 provisioning（OpenTofu / provider API adapter）
- 面板 / NMS 适配层
- 更完整的任务调度（租约、取消、重试策略）
- JSON → SQLite → PostgreSQL 的存储迁移
- Prometheus blackbox_exporter 等外部探测执行器

## Documentation

- `docs/current-state-prd.md`: 当前状态 PRD，实际交付能力的产品口径
- `docs/architecture.md`: 现状实现结构与目标形态
- `docs/api.md`: 完整 HTTP API 契约
- `docs/data-model.md`: 实体、字段、枚举与 store 清单
- `docs/project-progress.md`: 交付进度与下一阶段优先级
- `docs/project-assessment-and-roadmap.md`: 产品定位、全项目评估与长期路线
- `docs/stability-roadmap.md`: 稳定化改造项与实施状态
- `docs/duplication-audit.md`: 重复实现盘点与收敛落地情况
- `docs/module-ui-optimization-plan.md`: 模块 UI 优化轮次记录
- `docs/deployment-bare-metal.md`: 裸机部署（Ubuntu/Debian/Alpine × systemd/OpenRC，推荐）
- `docs/deployment.md`: Docker / Compose 部署（可选兼容路径）
- `docs/mvp.md`: 最初的里程碑规划（历史文档）
