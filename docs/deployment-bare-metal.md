# 裸机部署（Ubuntu / Debian / Alpine）

更新时间：2026-09-23（对照 `scripts/deploy-bare-metal.sh` 与 `src/server.js` 复核）

这条链路是低配控制面主机的 canonical 方式：不使用 Docker，不依赖 Compose，用专用系统用户 + 本机 init 系统托管 Node.js 服务。脚本早期只支持 systemd，现在按「包管理器 × init 系统」分支，覆盖：

| 维度 | 支持 | 实现 |
| --- | --- | --- |
| 发行版 | Ubuntu、Debian、Alpine | `detect_os` → `apt` / `apk` |
| init 系统 | systemd、OpenRC | `detect_init_system` → unit 或 `/etc/init.d` 脚本 |
| 架构 | amd64、arm64 | 应用是纯 JS；Node 源本身双架构（NodeSource `nodistro`、apk 原生） |
| 无源码 checkout | curl 拉取 | `AIRPORT_DEPLOY_REF` 指定的 GitHub tarball，服务器不需要 git |

不支持的系统/架构会直接失败并说明原因，不会静默走 apt 分支。没有 systemd 也没有 OpenRC 的机器（例如无 init 的 LXC  shell）同样直接拒绝，因为脚本无法托管服务。

## 一键安装

方式 A：服务器上已有 checkout。

```bash
git clone https://github.com/augus7737/airport-control-plane.git
cd airport-control-plane
sudo bash scripts/deploy-bare-metal.sh install
```

方式 B：不装 git，直接从 GitHub 取脚本（Alpine 最小镜像没有 bash，所以用 `sh` 起步，脚本会自己装 bash 再切回去）。

```bash
curl -fsSL https://raw.githubusercontent.com/augus7737/airport-control-plane/main/scripts/deploy-bare-metal.sh -o /tmp/airport-deploy.sh
sudo AIRPORT_DEPLOY_REF=main sh /tmp/airport-deploy.sh install
```

`AIRPORT_DEPLOY_REF` 可以是分支、tag 或 commit SHA；想锁定可复现的版本就填 SHA。

脚本会完成：

- 识别发行版与 init 系统，安装基础包和 Node.js（Debian/Ubuntu 走 NodeSource，Alpine 走 `apk add nodejs npm`）
- 创建专用 `airport` 系统用户（busybox 用 `addgroup`/`adduser`，glibc 发行版用 `groupadd`/`useradd`）
- 创建 `/opt/airport-control-plane` 与 `/etc/airport-control-plane/airport.env`
- 生成 `/etc/systemd/system/airport-control-plane.service` 或 `/etc/init.d/airport-control-plane`
- 在候选目录执行 `npm ci --omit=dev`
- 执行最低部署验证：`npm run check`
- 验证通过才同步到运行目录
- 重启服务并等待 `/healthz` 就绪

默认不在低配远端执行完整 `npm test`，避免 LXC/VPS 在部署期被测试峰值拖垮。需要完整测试时显式开启：

```bash
sudo bash scripts/deploy-bare-metal.sh update --full-test
AIRPORT_RUN_FULL_TESTS=true sudo bash scripts/deploy-bare-metal.sh update
```

如果候选版本验证失败，脚本不会重启线上服务。从写入服务定义、激活代码到健康检查期间，任何失败都会尝试恢复旧代码和旧服务定义；首次安装没有可回滚版本时，会停止失败服务、移除刚写入的服务定义并以失败退出。

如果服务器已经使用旧的 `/opt/airport-control-plane/.env.production` 裸机配置，首次执行时会把它迁移到新的环境文件位置，不会重新生成管理员密码。已有 `/etc/airport-control-plane/airport.env` 时始终以新文件为准，并拒绝覆盖迁移。

升级激活会保留 `.git/`、`data/`、历史 `data-prod/` 和旧 `.env.production`，不会把持久数据或仓库元数据当作应用代码清理。

## 升级

```bash
cd airport-control-plane
git pull
sudo bash scripts/deploy-bare-metal.sh update
```

`install` 和 `update` 走同一套验证流程：生产依赖安装、最低语法检查、激活、重启、健康检查。只有健康检查通过后才算成功。

## 旧 Docker 数据迁移

从旧 Docker/Compose 方式迁移时，历史数据通常在 checkout 目录的 `data-prod/`，旧环境文件通常在 `.env.production`。脚本不会自动搬迁这些 Docker 路径，必须显式指定，避免误把测试数据覆盖到生产目录：

```bash
sudo bash scripts/deploy-bare-metal.sh install \
  --migrate-env ./.env.production \
  --migrate-data-prod ./data-prod
```

安全规则：

- `--migrate-data-prod` 的目标固定是 `/opt/airport-control-plane/data`
- 目标 `data/` 非空时会拒绝迁移，不做覆盖
- 迁移后 `data/` 会设置为 `airport:airport` 和 `0750`
- `--migrate-env` 只在 `/etc/airport-control-plane/airport.env` 不存在时生效，目标已存在则拒绝覆盖
- 旧 `/opt/airport-control-plane/.env.production` 只作为裸机历史配置自动迁移；checkout 根目录 `.env.production` 必须显式传入

## systemd 分支

脚本生成的 unit 固定使用：

- `User=airport` / `Group=airport`
- `WorkingDirectory=/opt/airport-control-plane`
- `EnvironmentFile=/etc/airport-control-plane/airport.env`
- `ExecStart=<部署时解析到的 node 路径> src/server.js`
- `MemoryMax=256M`（部署时可用 `AIRPORT_MEMORY_MAX` 覆盖）
- `NoNewPrivileges=true`
- `ProtectSystem=strict`
- `ReadWritePaths=/opt/airport-control-plane/data`

`StartLimitIntervalSec` 和 `StartLimitBurst` 放在 `[Unit]`，兼容现代 systemd 的推荐位置。

## OpenRC 分支（Alpine）

生成 `/etc/init.d/airport-control-plane` 并 `rc-update add ... default`：

- `command_user=airport:airport`、`directory=/opt/airport-control-plane`、`command_background=yes`
- OpenRC 没有 `EnvironmentFile`，init 脚本在 `start_pre` 里逐行读取 `/etc/airport-control-plane/airport.env` 并 `export`，因此含空格的值不会被当成命令
- 日志写 `/var/log/airport-control-plane.log`（不是 journal）
- OpenRC 分支没有 `MemoryMax` 等价物，内存上限需要自己用 cgroup 工具兜住

## 环境文件

首次部署会生成 `/etc/airport-control-plane/airport.env`，至少需要关注：

```bash
PORT=8080
CONTROL_PLANE_AUTH_USERNAME=admin
CONTROL_PLANE_AUTH_PASSWORD=改成你的强密码
PLATFORM_PUBLIC_BASE_URL=https://你的控制面域名
CLIENT_PUBLIC_BASE_URL=https://你的订阅域名
CONTROL_PLANE_SESSION_SECURE=true
OPERATION_OUTPUT_LIMIT_BYTES=128000
OPERATION_TARGET_CONCURRENCY=3
AIRPORT_ENABLE_LOCAL_DEMO_TRANSPORT=false
```

`AIRPORT_ENABLE_LOCAL_DEMO_TRANSPORT` 必须保持 `false`：打开后控制面会在本机 shell 执行节点命令，等于在服务器上直接跑下发脚本。

登录失败计数默认开启（5 分钟窗口 / 10 次失败 / 锁 5 分钟，按用户名与客户端 IP 双桶），需要调整或关闭时：

```bash
CONTROL_PLANE_LOGIN_GUARD=true          # false 可整体关闭（只保留鉴权本身）
CONTROL_PLANE_LOGIN_WINDOW_MS=300000    # 失败计数窗口
CONTROL_PLANE_LOGIN_MAX_FAILURES=10     # 窗口内触发锁定的次数
CONTROL_PLANE_LOGIN_LOCKOUT_MS=300000   # 锁定时长
```

发布后的代码和 `node_modules` 会设置为 `root:airport` 只读，运行用户 `airport` 只对 `/opt/airport-control-plane/data` 有写权限。`.git/`、旧 `.env.production` 和历史 `data-prod/` 保留原权限，不纳入发布代码的权限收紧。

修改环境文件后重启并检查：

```bash
# systemd
sudo systemctl restart airport-control-plane
curl -fsS http://127.0.0.1:8080/healthz

# OpenRC
sudo rc-service airport-control-plane restart
curl -fsS http://127.0.0.1:8080/healthz
```

## 常用命令

```bash
# systemd
sudo systemctl status airport-control-plane --no-pager
sudo journalctl -u airport-control-plane -n 120 --no-pager

# OpenRC
sudo rc-service airport-control-plane status
sudo tail -n 120 /var/log/airport-control-plane.log
```

## 数据与备份

运行数据目录：

```bash
/opt/airport-control-plane/data
```

仓库自带快照脚本 `scripts/backup-data-dir.sh`（POSIX sh，Alpine 最小镜像可直接跑），四个动作：

| 动作 | 行为 |
| --- | --- |
| `backup` | 把整个 data 目录打成 `daily/airport-data-<时间戳>.tar.gz`（排除 `*.tmp`）并写 `.sha256` 伴生文件，随后按保留策略清理 |
| `list` | 列出 daily / weekly 快照 |
| `verify <路径>` | 先做 tar/gzip 可读性校验，再比对 `.sha256` |
| `restore latest\|<路径>` | 恢复快照；**当前 data 目录整体挪走成 `data-pre-restore-<时间戳>`，不删除**，确认无误后再手工清理 |

保留策略是两级分桶：`daily/` 里超过 `AIRPORT_BACKUP_DAILY_KEEP`（默认 7）天的快照按 7 天分桶提升为 `weekly/`（每桶只留一份），`weekly/` 只保留最新 `AIRPORT_BACKUP_WEEKLY_KEEP`（默认 4）份。相关环境变量：`AIRPORT_DATA_DIR`、`AIRPORT_BACKUP_DIR`（未设时若 `/opt` 可写则用 `/opt/airport-backups`）、上面两个 KEEP、`AIRPORT_APP_USER`（属主校验）、`AIRPORT_BACKUP_FORCE`。

定时任务用仓库里的 unit（部署脚本**不会**自动启用，需要手工打开）：

```bash
sudo cp scripts/systemd/airport-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now airport-backup.timer
systemctl list-timers airport-backup.timer   # 每天 03:17 + 最长 15 分钟抖动，Persistent=true 会补跑
```

OpenRC / 无 systemd 的机器直接挂 crontab：

```cron
17 3 * * * AIRPORT_DATA_DIR=/opt/airport-control-plane/data AIRPORT_BACKUP_DIR=/opt/airport-backups /opt/airport-control-plane/scripts/backup-data-dir.sh backup
```

备份对象就是整个 data 目录（含 `nodes.json`、`tasks.json`、`probes.json`、`operations.json`、`bootstrap-tokens.json`、`operator-sessions.json`、`platform-ssh/`、`artifacts/`），不需要逐文件挑。临时归档可用：

```bash
sudo tar -czf airport-control-plane-backup-$(date +%F).tar.gz -C /opt/airport-control-plane data
```

## 验证口径

两条 init 分支都在本地 Docker 容器里真跑过 `install`，不是只写代码：

- Alpine 3.20 + OpenRC（arm64）：`服务已健康`，`rc-service airport-control-plane status` 为 `started`，`rc-update show default` 含 `airport-control-plane | default`，`/healthz` 返回 `{"ok": true, ...}`
- Debian 13 + systemd（arm64）：`systemctl is-enabled` 为 `enabled`，unit 里 `ExecStart=/usr/bin/node src/server.js`、`MemoryMax=256M`，`/healthz` 同样返回 ok

已知未覆盖：amd64 主机（本机 Docker 是 arm64，Rosetta 下 systemd 不稳定，结论不可信）需要真实 VPS 复验；`update` 与回滚路径已在失败注入下验证过（服务起不来时会移除服务定义并停止，不误报成功）。
