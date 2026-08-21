# 裸机 systemd 部署

更新时间：2026-08-21

这条部署链路是低配 Ubuntu/Debian 控制面主机的 canonical 方式：不使用 Docker，不依赖 Compose，直接用专用系统用户和 systemd 运行 Node.js 服务。

## 适用范围

- Ubuntu / Debian 及其兼容发行版
- 单机控制面
- 低内存 VPS 或 LXC
- 数据继续落在本机 JSON 文件

暂不建议把同一份 JSON 数据目录挂给多实例并发写入。

## 一键安装

在服务器上准备仓库 checkout 后执行：

```bash
git clone https://github.com/augus7737/airport-control-plane.git
cd airport-control-plane
sudo bash scripts/deploy-systemd.sh install
```

脚本会完成：

- 安装基础包和 Node.js 20.x
- 创建专用 `airport` 系统用户
- 创建 `/opt/airport-control-plane`
- 创建 `/etc/airport-control-plane/airport.env`
- 生成 `/etc/systemd/system/airport-control-plane.service`
- 在候选目录执行 `npm ci --omit=dev`
- 执行最低部署验证：`npm run check`
- 测试通过后才同步到运行目录
- 重启 systemd 服务并等待 `/healthz` 就绪

默认不在低配远端执行完整 `npm test`，避免 LXC/VPS 在部署期被测试峰值拖垮。需要完整测试时显式开启：

```bash
sudo bash scripts/deploy-systemd.sh update --full-test
AIRPORT_RUN_FULL_TESTS=true sudo bash scripts/deploy-systemd.sh update
```

如果候选版本验证失败，脚本不会重启线上服务。从写入 systemd unit、激活代码到健康检查期间，任何失败都会尝试恢复旧代码和旧 unit；如果是首次安装且没有可回滚版本，会停止失败服务并以失败退出。

如果服务器已经使用旧的 `/opt/airport-control-plane/.env.production` 裸机配置，首次执行时会把它迁移到新的环境文件位置，不会重新生成管理员密码。已有 `/etc/airport-control-plane/airport.env` 时始终以新文件为准，并拒绝覆盖迁移。

升级激活会保留 `.git/`、`data/`、历史 `data-prod/` 和旧 `.env.production`，不会把持久数据或仓库元数据当作应用代码清理。

## 升级

```bash
cd airport-control-plane
git pull
sudo bash scripts/deploy-systemd.sh update
```

`install` 和 `update` 都会走同一套验证流程：生产依赖安装、最低语法检查、激活、重启、健康检查。只有健康检查通过后才算成功。

## 旧 Docker 数据迁移

从旧 Docker/Compose 方式迁移时，历史数据通常在 checkout 目录的 `data-prod/`，旧环境文件通常在 `.env.production`。systemd 脚本不会自动搬迁这些 Docker 路径，必须显式指定，避免误把测试数据覆盖到生产目录：

```bash
sudo bash scripts/deploy-systemd.sh install \
  --migrate-env ./\.env.production \
  --migrate-data-prod ./data-prod
```

安全规则：

- `--migrate-data-prod` 的目标固定是 `/opt/airport-control-plane/data`
- 目标 `data/` 非空时会拒绝迁移，不做覆盖
- 迁移后 `data/` 会设置为 `airport:airport` 和 `0750`
- `--migrate-env` 只在 `/etc/airport-control-plane/airport.env` 不存在时生效，目标已存在则拒绝覆盖
- 旧 `/opt/airport-control-plane/.env.production` 只作为裸机历史配置自动迁移；checkout 根目录 `.env.production` 必须显式传入

## systemd 单元

脚本生成的服务固定使用：

- `User=airport`
- `Group=airport`
- `WorkingDirectory=/opt/airport-control-plane`
- `EnvironmentFile=/etc/airport-control-plane/airport.env`
- `MemoryMax=256M`（可在部署时通过 `AIRPORT_MEMORY_MAX` 覆盖）
- `NoNewPrivileges=true`
- `ProtectSystem=strict`
- `ReadWritePaths=/opt/airport-control-plane/data`

`StartLimitIntervalSec` 和 `StartLimitBurst` 放在 `[Unit]`，兼容现代 systemd 的推荐位置。

发布后的代码和 `node_modules` 会设置为 `root:airport` 只读，运行用户 `airport` 只对 `/opt/airport-control-plane/data` 有写权限。脚本会保留 `.git/`、旧 `.env.production` 和历史 `data-prod/` 的原有权限，不把它们纳入发布代码权限收紧。

## 环境文件

首次部署会生成：

```bash
/etc/airport-control-plane/airport.env
```

至少需要关注：

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

修改环境文件后执行：

```bash
sudo systemctl restart airport-control-plane
```

并检查：

```bash
curl -fsS http://127.0.0.1:8080/healthz
systemctl status airport-control-plane --no-pager
```

## 常用命令

```bash
sudo systemctl status airport-control-plane --no-pager
sudo journalctl -u airport-control-plane -n 120 --no-pager
sudo systemctl restart airport-control-plane
```

## 数据与备份

运行数据目录：

```bash
/opt/airport-control-plane/data
```

建议至少备份：

- `nodes.json`
- `tasks.json`
- `probes.json`
- `operations.json`
- `bootstrap-tokens.json`
- `operator-sessions.json`
- `platform-ssh/`
- `artifacts/`

示例：

```bash
sudo tar -czf airport-control-plane-backup-$(date +%F).tar.gz -C /opt/airport-control-plane data
```
