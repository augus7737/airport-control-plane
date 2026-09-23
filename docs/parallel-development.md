# 模块边界与并行开发手册

适用前提：`src/server.js` 已完成路由拆分（5763 → 3805 行），16 个业务命名空间各占
`src/http/routes/<ns>.js` 一个文件。本手册给两类人看：

- 单个模块窗口：用第 3 节的边界提示词开工。
- 同时开多个窗口：额外遵守第 4 节的隔离与合并约定。

## 1. 拆分后的事实

- 派发点：`src/server.js:3644` 的 `for (const handleApiRoutes of apiRoutes)`，位于静态资源
  之后、尾部 404 之前。handler 不返回布尔值，server.js 用
  `reply.headersSent || reply.writableEnded` 判断是否已被处理，所以路由块可以逐字保留
  原来的 `return;` 写法。
- 模块形状：`create<Ns>Routes(ctx)` 返回 `async function handle<Ns>Routes({ request, reply, url })`，
  内部是搬迁前的原始路由块，只做了 +2 缩进。
- 仍留在 `src/server.js` 里、**不属于任何模块**的部分：登录页跳转、`/api/v1/auth/*`、
  鉴权门（未登录时 `/api/v1/*` 返 401、页面重定向）、`/healthz`、`/bootstrap.sh`、
  `/bootstrap/enroll.sh`、`/sub/:token`、`/api/v1/artifacts/sing-box/:version/:target`、
  静态资源、最终 404。这些是请求管线的顺序保证，改动前先确认顺序影响。
- 顺序约定：命名空间之间按 URL 前缀互斥，`createApiRoutes` 里的顺序 = 各命名空间首个路由块
  拆分前在 server.js 中的出现顺序；命名空间内部保持原顺序（例如 `nodes/:id` 与
  `nodes/manual` 的先后不能变）。
- 门禁：`npm run check`（全树语法）+ `node --test`（98 例）。
  `test/route-table.test.js` 是路由回归网：它真的起一个 `node src/server.js` 实例
  （`PORT=0` + 临时 `AIRPORT_DATA_DIR`），登录后按 78 行冻结矩阵逐条比对状态码和 error code。
  任何路由增删改都必须让它继续全绿；新增路由时把新行加进那个矩阵。
- `AIRPORT_DATA_DIR` 现在真的生效（此前硬编码 `../data`），`PORT=0` 会打印实际端口。
  实例之间的数据隔离靠这两项。

## 2. ctx：模块与宿主之间的唯一通道

模块能拿到的东西只有两类：

1. `ctx` 里的符号——server.js 模块级的 store 数组、持久化函数、领域构造器。每个文件顶部的
   `const { ... } = ctx;` 就是该模块的完整依赖清单，**加依赖要改 server.js，属于跨界操作**。
2. 直接 import 的纯函数：`../../utils/http.js`（jsonResponse / readJsonBody /
   extractRemoteAddress）、`../../utils/network.js`、`../../http/validators.js`、
   `../../utils/static-assets.js`、node 内置模块。

拆分是纯搬家，没有顺手改逻辑，所以 nodes 这类老模块 ctx 很重（38 项）。后续任何一轮里，
把某模块的 ctx 项下沉为 utils/domain 的直接 import 是**降耦合的正确方向**，但必须一次一个模块、
`node --test` 全绿再走下一步。

## 3. 各模块边界

### 通用提示词模板（把对应模块的卡片贴在末尾）

```text
你在 /Users/linkai/Documents/airport/airport-control-plane 上工作，这是一个零框架
原生 Node.js（>=20）+ 原生 ES module 前端的控制面项目。本次只做一个模块的改动，
严格按下面的边界执行：

- 只改卡片里"可改"列出的文件。其他文件一律只读。
- 路由块保持现有写法：命中即写出响应并 `return;`，不要改成返回布尔值，
  server.js 靠 reply 是否已开始输出来判断。
- 不要新增/修改 ctx 依赖。确实需要新依赖时停下来告诉我，说明要什么、为什么不能
  用现有的，我来决定是否改 server.js。
- 不要在 src/server.js 里加路由；业务路由只能待在 src/http/routes/<ns>.js。
- 新增或改动接口时，同步在 test/route-table.test.js 的矩阵里加/改对应行。
- 收尾必须跑：npm run check && node --test，全绿才算完成。
- 不要在文档、日志、提交里写入密码、bootstrap token、分享 token 或 SSH 私钥。
- 不要 git push。改完把 diff 摘要给我。
```

### 卡片

**platform**
- 可改：`src/http/routes/platform.js`
- 接口面：`GET /api/v1/platform-context`、`GET|PATCH /api/v1/platform/sing-box-distribution`、
  `POST /api/v1/platform/sing-box-distribution/{mirror,sync}`、
  `POST /api/v1/platform/ssh-key/generate`
- 依赖：`buildPlatformContext`、`buildPublishDistribution`、`generateManagedPlatformSshKey`、
  `mirrorPlatformSingBoxArtifact`、`updatePlatformSingBoxDistribution`、`hasOwn`
- 领域：`src/domain/platform/{ssh.js,sing-box-distribution.js}`；`PUT` 的校验在
  `src/http/validators.js`
- 注意：`platform-context` 是几乎所有前端页面的首屏数据源，字段是契约，删字段=全站回归。

**nodes**
- 可改：`src/http/routes/nodes.js`
- 接口面：`GET /api/v1/nodes`、`DELETE /api/v1/nodes/:id`、`POST /api/v1/nodes/:id/init`、
  `POST /api/v1/nodes/:id/probe`、`POST /api/v1/nodes/:id/diagnostics`、
  `PATCH /api/v1/nodes/:id/assets`、`POST /api/v1/nodes/{manual,register}`
- 依赖：38 项（含 8 个 `persist*`、任务/探测/操作的 prune 与 upsert、bootstrap token 校验）
- 领域：`src/domain/nodes/*`、`src/domain/bootstrap/tokens.js`
- 注意：`/register` 是节点侧脚本调用的公开入口（鉴权门放行），改动会影响真机 bootstrap；
  `nodes/manual`、`nodes/register` 必须在 `nodes/:id` 之后判定；目前**没有**
  `GET|PATCH /api/v1/nodes/:id`，补单个节点读接口是已登记缺口。
- 前端：`public/nodes.html`、`public/node.html` + `public/js/pages/{nodes-page.js,node-detail-page*.js}`

**tasks**
- 可改：`src/http/routes/tasks.js`
- 接口面：`GET /api/v1/tasks`（无查询过滤，整表返回，先跑 `reconcileTaskStoreFromOperations`）、
  `POST /api/v1/tasks/:id/bootstrap-complete`
- 依赖：`taskStore`、`sortTasks`、`reconcileTaskStoreFromOperations`、bootstrap 自动探测相关
- 领域：`src/domain/tasks/{lifecycle.js,store.js}`；测试 `test/task-lifecycle-concurrency.test.js`
- 前端：`public/tasks.html` + `public/js/pages/tasks-page*.js`（该页刚做完首屏层级重排，
  文案与状态语义见 `docs/module-ui-optimization-plan.md`）

**probes / diagnostics**
- 可改：`src/http/routes/probes.js`、`src/http/routes/diagnostics.js`
- 接口面：`GET /api/v1/probes?node_id=`、`GET /api/v1/diagnostics?node_id=`
- 依赖：`listNodeProbes`/`sortProbes`/`probeStore`；`listDiagnostics`
- 领域：`src/domain/probes/*`、`src/domain/diagnostics/node-quality.js`
- 注意：只读展示口径，不产生写操作；调度在 `src/runtime/probe-scheduler.js`，属禁改区。

**bootstrap-tokens**
- 可改：`src/http/routes/bootstrap-tokens.js`
- 接口面：`GET|POST /api/v1/bootstrap-tokens`、`PATCH /api/v1/bootstrap-tokens/:id`（**没有** DELETE）
- 依赖：`bootstrapTokenStore`、`registerBootstrapToken`、`serializeBootstrapToken`、
  `buildBootstrapTokenRecord`、`persistBootstrapTokens`、两个 validator
- 注意：响应里出现 token 明文是设计（一次性展示），**不要**把样例 token 写进代码或文档；
  耗尽判定在 `isBootstrapTokenExhaustedError`（属 nodes/tasks 共用）。
- 前端：`public/tokens.html` + `public/js/pages/tokens-page.js`

**access-users**
- 可改：`src/http/routes/access-users.js`
- 接口面：`GET|POST /api/v1/access-users`、`PATCH|DELETE /api/v1/access-users/:id`、
  `GET /api/v1/access-users/:id/share`（订阅链接）、
  `POST /api/v1/access-users/:id/share-token`（轮换）
- 依赖：19 项（含 `rotateAccessUserShareToken`、`buildAccessUserShareResponse`、
  `validateAccessUserProfileLink`）
- 领域：`src/domain/shares/links.js`（订阅链接与中转拓扑在这里，改动会同时影响 `/sub/:token`）
- 前端：`public/access-users.html` + `public/js/pages/access-users-page.js`
- 注意：`/sub/:token` 本体在 server.js 内（禁改区），若需求要改订阅渲染，先谈。

**proxy-profiles / node-groups / providers**
- 可改：`src/http/routes/{proxy-profiles,node-groups,providers}.js`
- 接口面：各自 `GET|POST /api/v1/<ns>` + `PATCH|DELETE /api/v1/<ns>/:id`（三者都没有
  `GET /:id`）；node-groups 的 `DELETE` 前会查 6 个 store 做引用保护
- 依赖：store + `build*Record` + `find*ById` + `persist*` + validator，7~14 项
- 注意：node-groups 读 6 个别的 store 做引用检查，删除保护逻辑跨模块，别只看本文件。
- 前端：`public/proxy-profiles.html`、`public/providers.html`

**system-templates / system-users**
- 可改：`src/http/routes/system-{templates,users}.js`
- 接口面：`GET|POST /api/v1/system-<x>`、`PATCH|DELETE /api/v1/system-<x>/:id`、
  `GET /api/v1/system-<x>-releases`、`POST /api/v1/system-<x>/apply`
- 依赖：`execute*Apply`、`system*ReleaseStore`、冲突收集（system-users 的
  `collectSystemUserConflictMessages`）
- 领域：`src/domain/system/{templates.js,users.js}`
- 注意：`/apply` 会生成节点侧脚本并下发，涉及 `docker/local-nodes` 才能真验证；
  不要在 Mac 本机开 `AIRPORT_ENABLE_LOCAL_DEMO_TRANSPORT`。
- 前端：`public/system-templates.html`、`public/system-users.html`

**config-releases**
- 可改：`src/http/routes/config-releases.js`
- 接口面：只有 `GET /api/v1/config-releases`、`POST /api/v1/config-releases`
- 依赖：`configReleaseStore`、`executeConfigRelease`、`buildPlatformContext`、`sortByUpdatedAt`
- 缺口：没有 `GET/PATCH /api/v1/config-releases/:id`，也没有回滚接口——发布中心方案
  第 3 步会加 `POST /api/v1/config-releases/:id/rollback`，需要新命名空间决策，先谈。
- 领域：`src/domain/releases/{sing-box.js,verification.js,haproxy.js}`、
  测试 `test/release-verification.test.js`
- 前端：`public/releases.html` + `public/js/pages/releases-page.js`

**operations**
- 可改：`src/http/routes/operations.js`
- 接口面：`GET /api/v1/operations`、`POST /api/v1/operations/execute`
- 依赖：`operationStore`、`pushOperationRecord`、`buildOperationRecord`、`nodeStore`
- 领域：`src/domain/operations/executor.js`；测试 `test/operation-executor-limits.test.js`
- 注意：执行器有并发/超时口径（见 `docs/stability-roadmap.md`），别在路由层加重试。

**shell**
- 可改：`src/http/routes/shell.js`
- 接口面：`POST /api/v1/shell/sessions`、`GET /api/v1/shell/sessions/:id`、
  `POST /api/v1/shell/sessions/:id/input`、`DELETE /api/v1/shell/sessions/:id`
- 依赖：`createShellSession`、`closeShellSession`、`serializeShellSession`、`shellSessionStore`
- 注意：会在节点侧起 PTY；本地验证必须走 `docker/local-nodes`，且 session 创建接口
  故意没有进 `test/route-table.test.js` 矩阵（避免真起 shell）。
- 前端：`public/shell.html`、`public/terminal.html` + `public/js/shell/*`、`public/js/pages/terminal-page*.js`

**costs**
- 可改：`src/http/routes/costs.js`
- 接口面：`GET /api/v1/costs/{summary,nodes,providers,releases,access-users}`
- 依赖：只有 `buildLiveCostViews`（全项目最干净的模块，可作为其他模块降耦合的样板）
- 领域：`src/domain/costs/*`

## 4. 并行开发提示词

### 硬约束（为什么不能随便开窗口）

1. 一个仓库、`main` 分支、无子模块：并行的唯一安全形式是 git worktree，不能多窗口共用一个工作目录。
2. `src/server.js`、`src/http/routes/index.js`、`src/http/validators.js`、
   `public/js/services/runtime-api.js`、`public/js/store/runtime-store.js`、
   `public/styles/tokens.css` 是全模块共用文件——**共享文件冲突只能靠"谁改"规则避免，
   git 救不了逻辑冲突**。
3. `docker/local-nodes` 起的是宿主机级资源（容器名、端口）。当前 `airport-local-e2e-*`
   一整套（控制面 8081 + 4 台节点）已在运行，属别的会话，不要动、不要复用。

### 窗口启动提示词（每个模块窗口用一份，替换三处）

```text
你在一个独立的 git worktree 里工作（不是主工作目录）。先执行并确认：
  git rev-parse --show-toplevel   # 必须是 .../<module>-worktree，不是主目录
  git status -sb                  # 分支应是 module/<module>
然后读 docs/parallel-development.md 第 1~3 节，按其中 <module> 的卡片开工。

本窗口实例的固定资源（不得改用其他值）：
  PORT=<port>  AIRPORT_DATA_DIR=<worktree>/data  AUTO_PROBE_ENABLED=false
  前端地址 http://127.0.0.1:<port>
本地服务用 `PORT=<port> npm run dev` 挂在后台，改完刷新页面自查。

共享文件规则：
  src/server.js、src/http/routes/index.js、src/http/validators.js、
  public/js/services/runtime-api.js、public/js/store/runtime-store.js、
  public/styles/** 一律只读。确实需要改，把要改的内容写成一段说明交给我，
  由主窗口在集成分支上落。
  唯一例外：runtime-api.js / runtime-store.js 允许**只在文件末尾追加**新导出，
  不得改动或重排已有行。
禁止：git push、合并别的分支、跑 docker/local-nodes/reset-fleet.sh、
  设置 AIRPORT_ENABLE_LOCAL_DEMO_TRANSPORT=true。
收尾：npm run check && node --test 全绿，并给出改了哪些文件、接口面变化、
  route-table 矩阵新增行。
```

### 主窗口（集成人）提示词

```text
你是这条线的集成人。工作目录是主工作目录，端口 8080 的实例挂着给人实时看效果。
按第 5 节的合并顺序逐个合入 module/<name> 分支：
  1. 先看该分支是否触碰共享文件；触碰则手工重放，不要 -X theirs/ours。
  2. 合一个跑一次 npm run check && node --test，尤其确认 test/route-table.test.js。
  3. 需要新命名空间或新 ctx 依赖时，才允许你改 src/server.js 与
     src/http/routes/index.js，并保持 createApiRoutes 的顺序规则。
  4. 合并完成、门禁全绿后再 commit；push 由我来做，先问我。
全部合完后按我的既有要求，把 README 与 docs/*.md 对齐到最新代码状态。
```

### 资源分配表

| 模块窗口 | 分支 | worktree | PORT |
| --- | --- | --- | --- |
| 主窗口/集成 | `main` | 当前目录 | 8080（挂着） |
| platform | `module/platform` | `../wt-platform` | 8091 |
| costs | `module/costs` | `../wt-costs` | 8092 |
| probes+diagnostics | `module/probes` | `../wt-probes` | 8093 |
| bootstrap-tokens | `module/tokens` | `../wt-tokens` | 8094 |
| providers / node-groups | `module/providers` | `../wt-providers` | 8095 |
| proxy-profiles | `module/profiles` | `../wt-profiles` | 8096 |
| access-users | `module/access-users` | `../wt-access-users` | 8097 |
| system-templates / system-users | `module/system` | `../wt-system` | 8098 |
| config-releases（发布中心） | `module/releases` | `../wt-releases` | 8099 |
| tasks | `module/tasks` | `../wt-tasks` | 8100 |
| nodes / operations / shell | `module/nodes` | `../wt-nodes` | 8101 |

worktree 建立（主窗口执行一次）：

```bash
cd /Users/linkai/Documents/airport/airport-control-plane
for m in platform costs probes tokens providers profiles access-users system releases tasks nodes; do
  git worktree add ../wt-$m -b module/$m main
done
git worktree list
```

`node_modules` 只有 `qrcode`，各 worktree 里 `npm install --offline` 或直接
`ln -s ../../../airport-control-plane/node_modules node_modules`。
数据天然隔离：`AIRPORT_DATA_DIR` 默认落在各自 worktree 的 `data/`（已被 gitignore）。

需要节点侧真验证的模块（nodes / tasks / operations / shell / system-* / releases）不要并行，
它们会抢同一套 `docker/local-nodes` 集群；真要并行就给每个窗口一套
`COMPOSE_PROJECT_NAME=airport-<module>` 的独立集群，并各自确认端口不撞。

### 合并顺序（依赖从少到多）

1. `costs`、`probes`、`diagnostics`、`platform`：只读展示，接口面小。
2. `providers`、`node-groups`、`proxy-profiles`、`access-users`、`bootstrap-tokens`：
   独立 CRUD，冲突面在 validators 和 runtime-api。
3. `system-*`、`releases`：会下发节点侧脚本，需真集群复验。
4. `tasks`、`operations`、`shell`、`nodes`：互相引用最重（nodes 的 ctx 38 项，
   牵动 8 个 store 的持久化），放最后，且这一层合完要人工过一遍 `src/server.js`。
