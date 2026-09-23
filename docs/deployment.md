# 生产部署（Docker / Compose 兼容路径）

更新时间：2026-09-23

> 本文是可选的容器化部署路径。低配单机的推荐形态是裸机部署（Ubuntu / Debian / Alpine ×
> systemd / OpenRC），见
> [`docs/deployment-bare-metal.md`](deployment-bare-metal.md)。两者写的是同一份数据目录，
> 不要同时启用；环境变量口径以裸机文档为准。

## 适用场景

仍然适合走这条路径的情况：

- 主机已经统一用 Docker / 1Panel / 宝塔容器管理，不希望额外装 Node 运行时
- 需要在多台机器之间快速搬迁整套运行环境
- 只需要内网演示或临时实例，不追求极致内存占用

不适合的情况：内存 ≤ 1G 且需要长期稳定运行（systemd 路径的资源限制与回滚更完整）。

## 当前推荐方式

容器路径的推荐形态：

- 单机部署
- Docker 容器运行控制面
- `data-prod/` 持久化 JSON 台账、平台 SSH 密钥和分发制品
- 反向代理负责 HTTPS

原因很直接：

- 现在数据层仍是单机 JSON 文件，不适合多实例并发写入
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
5. 构建一个已经内置 Node 运行时与生产依赖的镜像
6. 优先使用 Compose 部署；如果主机没有 Compose，就自动退回到 `docker build + docker run`
7. 等待容器健康检查通过，避免“容器起了但服务没真的可用”

这条部署链路不依赖宿主机安装 `node` 或 `npm`。

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
CLIENT_PUBLIC_BASE_URL=https://你的订阅域名
CONTROL_PLANE_SESSION_SECURE=true
```

补充说明：

- `CONTROL_PLANE_AUTH_PASSWORD` 不能保留为示例值 `CHANGE_ME`，部署脚本会直接拒绝上线。
- 默认一键部署只挂载 `data-prod/ -> /app/data`。
- 如果你设置 `PLATFORM_SSH_PRIVATE_KEY_PATH` 指向 `/run/secrets/...` 这类自定义位置，请确认你已经额外挂载了对应文件；否则容器内看不到这把私钥。
- `AIRPORT_ENABLE_LOCAL_DEMO_TRANSPORT` 必须保持 `false`（默认值）。打开后 SSH 传输层会在连接失败时退化到控制面本机执行命令，那是离线演示专用开关，生产环境等于把节点命令在自己的服务器上跑。

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

备份对象是整个数据目录（默认 `data-prod/`，systemd 路径为 `/opt/airport-control-plane/data`），
而不是单个文件：里面除各 store 的 JSON 台账外，还有平台 SSH 私钥、订阅制品和 `.bak` 副本。

```bash
tar -czf airport-backup-$(date +%F).tar.gz data-prod
```

清单式的文件与枚举定义见 [`docs/data-model.md`](data-model.md)。

## 升级方式

```bash
git pull
bash install.sh
```

如果你走的是 Compose，脚本会自动重建镜像并重启服务。
如果你走的是纯 `docker run`，脚本也会自动替换旧容器。
无论哪条路径，脚本都会等待容器健康检查成功后才算部署完成。

## 目前不建议的部署方式

暂时不建议：

- 多实例部署
- 多台控制面共用同一份 JSON 存储
- 把容器无持久化运行

原因：

- 数据虽然已经做了原子写入（`tmp -> fsync -> rename` + `.bak`）和同文件串行写队列，
  但进程内仍持有整份内存态 store，多实例之间不会互相感知写入，会互相覆盖
- 管理员 session、平台托管 SSH 密钥、订阅制品都默认存放在同一个数据目录里
- Web Shell 与巡检调度器都是单进程语义，多实例会出现重复调度

换句话说，阻挡多实例的已经不是"JSON 会不会写坏"，而是"内存态没有共享与失效机制"。
真正的解法是存储迁移（见 [`docs/stability-roadmap.md`](stability-roadmap.md) 的 SQLite 阶段）。

## 正式生产前你还应做的事

- 把控制面放在独立服务器或独立虚拟机上
- 只开放 `80/443`，不要直接裸露 `8080`
- 改掉默认账号密码
- 定时备份 `data-prod/`
- 为宿主机配置防火墙和 SSH 登录保护
- 后续尽快把 JSON 存储替换成数据库
