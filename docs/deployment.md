# 生产部署

更新时间：2026-04-15

## 当前推荐方式

现阶段最适合本项目的上线方式是：

- 单机部署
- Docker 容器运行控制面
- `data-prod/` 持久化 JSON 台账、平台 SSH 密钥和分发制品
- 反向代理负责 HTTPS

原因很直接：

- 现在数据层仍是 JSON 文件，不适合多实例并发写入
- Web Shell / 任务 / 探测都默认按单进程模型设计
- 先把单机版本跑稳，比过早拆成多组件更符合你当前项目阶段

## 一键部署

在目标服务器执行：

```bash
git clone <你的仓库地址> airport
cd airport
bash install.sh
```

脚本会自动完成这些事：

1. 检查 `docker`
2. 生成 `.env.production`
3. 自动生成一组控制面登录账号密码
4. 创建持久化目录 `data-prod/`
5. 优先使用 Compose 部署；如果主机没有 Compose，就自动退回到 `docker build + docker run`

首次执行成功后，你会看到：

- 登录地址
- 数据目录
- 控制面账号
- 控制面密码

## 核心文件

- `Dockerfile`
- `compose.production.yml`
- `.env.production.example`
- `scripts/deploy-production.sh`

## 部署后建议立即修改

编辑 `.env.production`：

```bash
CONTROL_PLANE_AUTH_USERNAME=admin
CONTROL_PLANE_AUTH_PASSWORD=改成你的强密码
PLATFORM_PUBLIC_BASE_URL=https://你的域名
CONTROL_PLANE_SESSION_SECURE=true
```

然后重新执行：

```bash
bash install.sh
```

## HTTPS 与反向代理

推荐把控制面放在 Nginx / Caddy / 1Panel 反向代理后面。

反向代理需要注意：

- 把外部 `443` 代理到控制面 `8080`
- 转发 `Host`
- 转发 `X-Forwarded-Proto=https`

这样控制面登录 cookie 在 HTTPS 下会更稳定，`bootstrap` 基地址也能正确指向正式域名。

## 数据持久化

当前必须备份的目录：

- `data-prod/nodes.json`
- `data-prod/tasks.json`
- `data-prod/probes.json`
- `data-prod/operations.json`
- `data-prod/bootstrap-tokens.json`
- `data-prod/platform-ssh/`
- `data-prod/artifacts/`

最简单的备份方式：

```bash
tar -czf airport-backup-$(date +%F).tar.gz data-prod
```

## 升级方式

```bash
git pull
bash install.sh
```

如果你走的是 Compose，脚本会自动重建镜像并重启服务。
如果你走的是纯 `docker run`，脚本也会自动替换旧容器。

## 目前不建议的部署方式

暂时不建议：

- 多实例部署
- 多台控制面共用同一份 JSON 存储
- 把容器无持久化运行

原因：

- 会话目前是单进程内存 session，重启后会失效
- JSON 文件没有并发写保护，不适合多实例
- 平台托管 SSH 密钥默认也存放在数据目录里

## 正式生产前你还应做的事

- 把控制面放在独立服务器或独立虚拟机上
- 只开放 `80/443`，不要直接裸露 `8080`
- 改掉默认账号密码
- 定时备份 `data-prod/`
- 为宿主机配置防火墙和 SSH 登录保护
- 后续尽快把 JSON 存储替换成数据库
