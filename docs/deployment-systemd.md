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
- 执行 `npm test`
- 测试通过后才同步到运行目录
- 重启 systemd 服务并等待 `/healthz` 就绪

如果候选版本测试失败，脚本不会重启线上服务。如果重启后健康检查失败，脚本会尝试回滚上一版，并以失败退出。

如果服务器已经使用旧的 `/opt/airport-control-plane/.env.production` 裸机配置，首次执行时会把它迁移到新的环境文件位置，不会重新生成管理员密码。已有 `/etc/airport-control-plane/airport.env` 时始终以新文件为准。

升级激活会保留 `.git/`、`data/`、历史 `data-prod/` 和旧 `.env.production`，不会把持久数据或仓库元数据当作应用代码清理。

## 升级

```bash
cd airport-control-plane
git pull
sudo bash scripts/deploy-systemd.sh update
```

`install` 和 `update` 都会走同一套验证流程：生产依赖安装、测试、激活、重启、健康检查。只有健康检查通过后才算成功。

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
