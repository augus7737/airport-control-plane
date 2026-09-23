# 页面 UI 与布局合理性评估汇总（13 模块）

评估时间：2026-09-23
状态：13 个模块各派一个评估窗口（读代码 + 六宽度实测），本轮只产问题清单与优先级；窗口 B（假结论族）已按决策实施并在浏览器复验，窗口 A（共享层）与窗口 C（确认与各模块单点）排队。

关联文档：`docs/module-ui-optimization-plan.md`（第一~十轮按模块的功能级修复与 deferred 清单）

## 0. 取证方法与三条口径修正

**方法**：在独立端口起一套只服务于本次评估的实例（独立数据目录，不碰 8080/8081），用同源 iframe 在 **390 / 720 / 900 / 1013 / 1440 / 1920** 六档量测每页的 `pageHeight`、`ox = scrollWidth − clientWidth`、`.tiny` 元素数、越界元素数、被裁元素数，并对溢出页逐个 dump 越界元素的 `rect` 与选择器链。**1013 是运营实际宽度**（应用内浏览器面板固定视口），所有"实际会不会撞到"的判断以该档为准。

**行号口径**：§1~§5 的行号是**评估时（窗口 B 实施前）**的位置。本轮改过的文件（`tasks-page*.js`、`releases-page.js`、`terminal-page*.js`、`proxy-profiles-page.js`、`core-formatters.js`、`runtime-api.js`、`runtime-store.js`、`app.js`）会有小幅漂移，实施项的**当前**位置只写在 §7。

三条口径必须先修正，否则后面所有判断都会错：

1. **`ox = 0` 不等于"没溢出"**。`public/styles/base.css:17` 是 `overflow-x: clip`，它把溢出吞成"看不见也滚不到"。所以只有 `ox>0` 的页是真死区；`ox=0` 的页还要看 `.table-shell` 是否在内部横滚（节点清单 / 发布中心 / 总览属后者：能滚但零提示）。
2. **`.tiny` 全站没有字号**，只有颜色（`public/styles/layout.css:64-74` 那个 color-only 选择器组 + `base.css:14-20` body 无 `font-size` → 落回 UA 16px）。`public/styles/pages/tasks.css:64` 也只是颜色。即全站次要说明的实际字号几乎为 0 个声明。
3. **可达性判定要看 DOM 链**：4 个越界页结构完全同形 —— `section.workspace > article.panel > .panel-body > .table-shell > table[min-width]`，而 `.panel`（`layout.css:121-131`）从未拿到 `min-width:0`。

## 1. 四个跨页家族（按"改一次能收掉几页"排，不按页排）

### F1 表格最小宽度上抬 grid 轨道 → 内容永久不可达 · P0

| 页 | 1013 实测不可达宽度 | 声明处 |
|---|---|---|
| 注册令牌 | 246（操作列整列 + 备注列半截，x=1077–1244 在视口外） | `public/styles/pages/tokens.css:29`(980) + `:70` 裸 `1fr` |
| 系统用户 / 系统模板 | 286（编辑/删除列，越界元素 24 个） | `access-users.css:240-242`(1020)；两页规则**内嵌在 access-users.css**，特异度 (0,2,1) 还压掉了壳层 ≤980 的单列折叠 |
| 接入用户 | 126（整列操作不可达，越界元素 47 个） | `access-users.css:777`(860) + `:819` 裸 `1fr` |
| 同机制待爆（当前 `ox=0`） | 总览预览表 134 / 节点清单 48 / 发布中心 1080 壳内横滚，均无 sticky 首列、无渐隐提示 | `overview.css:732-734`、`nodes.css:337`(760)、`releases.css:182-184` |

390 档同源放大：657 / 691 / 691 / 531。

**决策（已拍）**：**逐页 `minmax(0,1fr)`**，不改共享 `.panel`。理由：共享一行 `.panel{min-width:0}` 同样能收口，但会一次性改变 13 页的轨道计算，回归面与本轮"先修假结论"的窗口选择不在一个方向上；逐页改零波及，且这 5 处规则本就各自复制、无共享声明可收。归入**窗口 A** 执行。

### F2 高代价动作零确认 + 静默回落目标 · P0

- 节点详情「执行初始化」：一次点击即 POST `/api/v1/nodes/:id/init`（重启 sshd、覆写 `node.env`），模板默认 `alpine-base`，无确认 —— `public/js/pages/node-detail-actions.js:353-367`（同文件仅 `:78` 删除有 confirm）。
- 发布中心「立即发布」：下发 N 台并重启服务，只校验必填 —— `public/js/pages/releases-page.js:1084-1126`。
- 系统用户 / 系统模板「开始下发」：改 SSH 账号、sudo、跑脚本到多节点，提交前无确认，且**未选节点组与节点时后端静默回落到该记录自带的 `node_group_ids`**（`src/server.js:3173-3176` 模板 / `:3279-3282` 系统用户；两个分支同构，只有解析结果为空才 400）—— `public/js/pages/system-users-page.js:814-870`、`public/js/pages/system-templates-page.js:817-873`。
- 云厂商删除：**确认文案与页面展示口径相反** —— 前端 `getBoundNodeCount`（`providers-page.js:290-295`）与后端 guard（`src/http/routes/providers.js:175-177`）都按 `provider_id` 计数，表格"节点概况"按 `labels.provider` 计数；取证实例 6/6 节点 `provider_id` 为 null → 行内写"4 台节点"，弹窗却说"无节点"，删完 4 台机器仍自称 Vultr。（跨层，含后端）

归入**窗口 C**。

### F3 前端把"取不到"渲染成确定结论 · P0 —— 本轮已实施（见 §7）

下面这段描述的是**修复前**状态（`grep reachability public/js` 一条命中也没有、非 401 失败一律吞成空集合），现已按 §7 收口，留在这里是为了说明这类缺陷的成因。

根因在共享层，一处引起全站：`public/js/services/runtime-api.js` 的 `fetchCollection` 任何非 401 失败一律 `return emptyCollection`，`getPlatformContext` 失败回落 `createDefaultPlatformContext()`（其 `probe_scheduler.enabled = false`）。于是后端 500 / 网络抖动的表现是：任务池"当前还没有真实任务…"（`tasks-page.js:450-452`）+ 状态条"周期巡检未启用"（`:262-264`）—— 两条自信的错误结论，运营会整晚查错方向。全站每个空态都继承这条。

同族的产品真相缺口：

- `reachability_status` 已落库（`src/server.js:3093`），前端 `grep reachability public/js` = **0 命中** → "sing-box 已生效但业务端口不通"在发布列表仍显示绿色"可用"，可达层只在展开行灰字（`releases-page.js:159-163`）。
- 批量终端提交后不轮询（全站唯一轮询在 `tasks-page-actions.js:243`），并把运行中打印成"[无输出] 后端未返回…"（`terminal-page.js:184`、`core-formatters.js:6`）。
- 任务中心"下一轮 3 分钟后"是渲染瞬间快照，之后一直说谎；轮询只在 `running/queued` 才开（`new` 不算），取证实例 9/9 任务全 failed → 页面永久静止（`tasks-page-actions.js:184-189`）。
- 厂商页同屏三处反向信号："总月成本 待补"×3 + "预算预警 0" + 尾注"台账已基本对齐"，而实际 `unlinked_provider_node_count=6`、头部总额 USD 41.42（`providers-page.js:348/373-377/385/479`）。

### F4 字号 / 层级倒挂 · P1（全站）

`.stat-label` 10px 的标签旁边站着 16px 的 `.tiny` 说明（总览 `.tiny` 元素 119 个，且 **390/1013/1440/1920 计数完全相同** → 与宽度无关，是写死的小字 + 落回的大字）；厂商卡脚说明比它上面的标签大 60%，把指标带挤成 2 行 ≈340px；任务中心 `.task-summary-text` 把 58–66 字的失败原因按 3 行 clamp 掉一半且**无 ellipsis、无 title**（实测 @390 丢 21/15 字、@720 丢 7 字）—— 这正是运营要点开看的东西，而 ≥1101 选中时整列 `display:none`（`tasks.css:222-225`，`note` 全页唯一渲染点 `tasks-page.js:459`）。两端同时丢诊断。修在 `tokens.css` 加字阶 + `layout.css` 给 `.tiny` 定档（波及 13 页），归入**窗口 A**。

## 2. 各模块最值得开工的独立项（一行一条）

| 模块 | 问题 | 证据 | 面 / 优先级 |
|---|---|---|---|
| 节点清单 | 搜索框输入 `"` 或 `<` 后**工具栏塌掉**（属性未转义） | `nodes-page.js:190,204,214` | 仅本模块，P0 级 bug |
| 节点清单 | IP / CPU·内存·磁盘 / 已用流量**只存在于 hover 面板**，触屏与键盘永久不可达 | `node-table-cells.js:184-204,335-343` + `primitives.css:626-629` | P0 |
| 节点清单 | 901–1056 一档 `min-width:760` 把"打开终端"裁成半截；手机只见主机名 + 状态点 | `nodes.css:337`、`:474-527` | P1 |
| 运维终端 | 回显区是文档最后一个 section（要滚 1.5–2.5 屏），且输出框无高度上限，200 行回显把卡撑到数千 px | `terminal-page.js:194,200,333`、`terminal.css:423-434` | P0（窄档需动壳层高度链） |
| 运维终端 | 会话超时后终端"看似活的"：屏内无终止说明，"已关闭"与"未连接"同灰 | `node-shell-runtime.js:105-115` | P1 |
| 节点详情 | 唯一操作台 aside 排在 7228px（@390）文档末尾；1013 正文仍双列被挤到 ~484px | `node-detail-page.js:108-114`、`node-detail.css:32-36` | P1 |
| 节点详情 | "延迟拆分"永远是 "-"：本页没把 `formatProbeLatencyBreakdown` 传进 helpers，而 helpers 有 `typeof === "function"` 守卫 → 静默降级 | `node-detail-page.js:8-51,62-106` vs `node-detail-page-helpers.js:301,393` | P1 |
| 发布中心 | 徽章词不达意：成功="可用"、失败="异常"，终态与进行中共用蓝 | `core-formatters.js:1-35` + `releases-page.js:408` | P1 |
| 发布中心 | 发布后停在"执行中"，本页零轮询；提交回执在面板底部而滚动回顶部（像没成功） | `releases-page.js:356-358` | P1 |
| 协议模板 | 改 TLS/Reality 或高级区字段后要向下滚 900–1200px 才碰到保存；4 个 section 无锚点 | `proxy-profiles-page.js:978-986,760-933` | P1 |
| 协议模板 | 连接/Ping 超时字段恒可见但只有 grpc/http 落库，其余传输填了**静默丢弃** | `proxy-profiles-page.js:941-948,416-421` | P1 |
| 接入用户 | 顶部指标写"7 天内到期 1"，行内却无到期预警，现成的 `.asset-expiry-pill` 没用 | `access-users-page.js:912-917` | P1 |
| 接入用户 | 切协议后隐藏凭证字段仍随表单提交（可写脏数据） | 同文件 | P2→建议升 P1 |
| 注册令牌 | "可用"令牌行内没有改有效期入口，过期/用尽只剩"调整上限"，改完仍不可用（`expires_at` 全站不可改）→ 运营以为已恢复 | `tokens-page.js:44-45,68-72,219,265` | **P0 产品缺口** |
| 注册令牌 | 新建令牌的**明文整串常驻**右侧面板（表格与摘要行都走掩码），无揭示/收起动作 | `tokens-page.js:142` vs `:74,:125` | P1 安全 |
| 注册令牌 | 令牌页第一块 sticky 侧栏写着"完整密钥信息放到令牌页集中维护 / 去令牌页查看"，用户就在令牌页 | `tokens-page.js:119` → `platform-ssh-page.js:225,240` | P1 |
| 中转拓扑 | 无标签地图占页高近半且居首屏，能回答链路的分组卡被推到 3.4 屏（@390 y≈3000）；地图 `roam:true` 让手机上整屏拖不动 | `routes-page.js:557-558,574-681`、`routes.css:94,123,334` | P1 |
| 中转拓扑 | 分组只按中转机聚合，入口区域取**首个成员**的 `entry_region` → 可显示错误链路；浅色主题链路 pill 对比度 ≈2:1 | `route-helpers.js:78-98`、`routes.css:355-401` vs `:561-633` | P1 |
| 总览 | 首屏 8 张同权重 KPI 卡 5 张为 0，第一颗可点按钮 y≈600；右栏 1370 vs 左栏 725 | `overview-page.js:182-289,406-506` | P1 |
| 厂商 | 页面**没有任何到期日/续费方式字段**，而它唯一要答的就是"哪家 30 天内续费"（数据已在 `/costs/nodes`）；13 控件的表单常驻展开 ≈1850px | `providers-page.js:569-582` vs `app.js:231` 承诺 | P0（信息架构） |
| 厂商 | 901–1180 断点倒挂：900→1013 页面反而高 1022px、正文窄 99px；搜索无防抖（整页 4178px 重建，IME 组字会吞字） | `providers.css:259` vs `primitives.css:1174`；`providers-page.js:766-776`（对照 `access-users-page.js:1186-1198` 已修写法） | P1 |
| 任务中心 | 筛选器在 721–1100 档换成 4 行 ≈256px 且常驻 sticky，首行任务被推到 y≈570，抵消第十轮"失败队列优先"的首屏收益 | `tasks.css:72-90`、`:469-478` | P1 |
| 任务中心 | ≤1100 选中后详情整块沉到表尾，`scrollIntoView({block:"nearest"})` 只露出摘要卡顶边，答案（回显 / 摘要日志）还要再滚 1–2 屏；重试按钮在看不见的地方 | `tasks.css:480-487`、`tasks-page-actions.js:149-166,201` | P1 |
| 任务中心 | 自动刷新把日志滚动位置和选中文字弹掉：`restoreViewport` 只恢复 window 纵向与表格 `scrollLeft`，rail 内两个真正的日志容器（回显 360px / 摘要日志 320px）不恢复；"数据没变不打断"形同虚设，`finally` 无条件重绘 | `tasks-page-actions.js:62-104,218-225`、`page-render-runtime.js:71-72` | P1 |
| 任务中心 | 零数据页找不到下一步：文案指向 bootstrap，但本页无纳管/创建入口，也没有"去节点清单手动触发探测/初始化"的出口 | `tasks-page.js:451`、`app.js:207-214`、`provisioning-modals.js:93-99` | P1 |
| 任务中心 | 日志里"完整输出见 GET /api/v1/operations/<id>"是裸文本、不能点；"查看完整执行"只在 `operation_id` 存在时出现，而取证实例 9/9 任务 `operation_id=null` | `src/domain/tasks/log-excerpt.js:36-40`、`tasks-page.js:557-561,636-650` | P2 |
| 任务中心 | 状态词共用一枚告警黄：`new/queued/partial` 三语义同为 `badge-new`，计数行无 partial；`node_id`/任务 ID/说明列截断处无 title、不可复制 | `task-helpers.js:85-100`、`tasks-page.js:435-437`、`tasks.css:280-297` | P2 |
| 任务中心 | 筛选/搜索/选中三份状态只活在内存，刷新即全丢，无法把某条失败任务贴进故障群（同仓 terminal / system-templates / access-users 都会读 `location.search`） | `runtime-store.js:123-135` vs `terminal-page.js:56` | P2 |

## 3. 共享壳层欠账（都是 P1，改动波及 13 页 → 窗口 A）

1. 13 页里 **12 页 DOM 无页面标题**（hero 只在 nodes 分支渲染，`shell-template.js:155-176` + `provisioning-modals.js:93-95`）→ `pageMeta.*.subtitle` 全是死文案，标题层级从侧栏 h1 直跳 h3。
2. 4 个壳层弹窗**无 `role="dialog"` / `aria-modal` / 焦点捕获与归还**（`provisioning-modals.js:103,179,240` + `node-asset-modal-templates.js:11,298`）。更正评估员说法：ESC 关闭**已实现**（`node-asset-modal-events.js:4-11`、`provisioning-modals.js:225-232`），缺的是 dialog 语义与焦点，别当"完全不可用键盘"来报。
3. 901–1100 档侧栏常驻吃 212px（占 1013 面板 21%），是 F1 全部越界的共同挤压源；建议压到 ~160px 或该档改图标栏。
4. 断点体系不成一套：壳层 900/980，页内 1100/1180 → **901–1180 是全站最差档**（同一页三种列数、`.content` padding 不收缩、rail 沉底但正文仍双列）。
5. `.table-shell` 有 `overflow-x:auto` 但零线索（无 sticky 首列、无渐隐）；`primitives.css:351` 的 `.list-table{min-width:1080px}` 是全站地板。
6. 登录页：浅色主题（默认即 light）把错误提示压成灰色，与普通提示无法区分（`login.css:227-229` 被 `:354-360` 特异度压过）；被限流后硬编码"请稍后再试"（`public/js/auth/login-page.js:93-94` 的 429 分支直接覆盖了 `error.message`），而后端已经把秒数写进响应（`src/domain/auth/session.js:425-431` 的 `retry_after_seconds` / `message`，经 `public/js/auth/auth-client.js:269-292` 已经带到前端）。

## 4. 核过并否掉的评估结论

- "4 页 `ox=0` 所以干净" → 错，已在 §0 第 1 条。
- "弹窗完全没有键盘支持" → 错，ESC 与 `aria-label`/`aria-live` 都在，缺的是 dialog 语义 + 焦点陷阱。
- "节点详情初始化在页面加载时自动触发" → 错，是单击触发无确认（严重度不变，机制要写对）。
- "发布中心动作列不可达（P0）" → 降级 P1：该页 `ox=0`，列可在 `.table-shell` 内滚到，缺的是**可发现性**（无 sticky/渐隐），不是可达性。
- "任务中心被裁元素可能是统计假象" → 用原始量测数据钉死：就是 `.task-summary-text`，@390 丢 21/15 字、@720 丢 7 字，无 ellipsis 无 title。
- "`tasks.css:64` 给 `.tiny` 定了字号" → 错，该行是颜色声明；由此推出的"全站有 3 处 `.tiny` 字号"同样不成立（§0 第 2 条）。
- "系统用户 / 模板下发时后端静默回落**默认组**" → 机制写错：实际回落**该记录自带的 `node_group_ids`**（`src/server.js:3173-3176` / `:3279-3282`），且解析不到节点时是 400 而不是无目标广播。严重度不变（提交前仍无确认、回落仍不可见），但修的时候不要按"默认组"改。
- "登录被限流后前端读不到重试秒数" → 半对：后端已经把 `retry_after_seconds` 和带秒数的 `message` 一路送到前端，是 `public/js/auth/login-page.js:93-94` 的 429 分支把它覆盖成了硬编码文案。修法只需删掉这个分支，不需要动后端。

## 5. 与既有 deferred 清单重复、本轮不重复计

`docs/module-ui-optimization-plan.md` 的"已确认但未修复（下一轮）"已记：`provider_id` 优先匹配（= F2/F3 厂商那两条的上游）、节点清单头部指标 vs 筛选 chips 口径、接入用户 `aggregateTargetCount` 混用、`ensureEntryPoint` 静默"中国大陆"、原生 `alert/confirm` 内联化（7 处）。

另有一条上一轮**自身引入的回归**：浅色主题下 `.provider-inline-tag.is-more` 的虚线 + 透明被 `providers.css:279-291`（特异度 0,3,2）压过，"另有 N 个未展示"在默认主题里长得像真厂商标签。这条不排队，已在 `public/styles/pages/providers.css` 补同权重 (0,4,2) 覆盖修掉，并合成元素复验（虚线/透明/无阴影 vs 真标签的渐变 + 阴影）。

## 6. 窗口切分与决策

- **窗口 A｜共享层一次收口**：F1 逐页 `minmax(0,1fr)`、F4 字号标度、dialog 语义 + 焦点、页面标题层、断点统一、`.table-shell` 滚动线索、登录页两处。回归 13 页。**状态：排队。**
- **窗口 B｜F3 假结论族**：`runtime-api` 失败可判别 + 任务中心 / 发布中心 / 终端三处"未知态与轮询收口" + `reachability_status` 前端渲染。**状态：本轮已实施并复验，见 §7。**
- **窗口 C｜F2 确认 + 各模块单点**：4 处破坏性动作加确认（厂商含后端 guard）、节点清单转义 bug + hover-only 落地、令牌有效期入口与明文、厂商到期列与口径文案、协议模板锚点/保存。**状态：排队。**
- 每窗门禁：`npm run check` + `npm test` 全绿；push 由维护者执行。

## 7. 窗口 B 实施记录（本轮已改并复验）

### B1 共享层：数据读取失败变成可判别状态

- `public/js/store/runtime-store.js`：新增 `appState.dataHealth.sources`（`:100`）与 `recordCollectionHealth(source, {ok, error, now})`（`:185`）/ `getCollectionHealth(source)`（`:196`）。每次记录写 `status` / `error` / `checked_at`，并在成功时保留 `ok_at`（供"最近成功读取 N 分钟前"）。
- `public/js/services/runtime-api.js`：新增 `collectionSource(url)`（`:32`；去掉 `/api/v1/` 前缀、`/`→`.` → `tasks`、`nodes`、`probes`、`platform-context`、`operations`、`costs.summary`）；`fetchCollection`（`:94`/`:100`）/ `getLiveCostSummary`（`:201`/`:207`）/ `getPlatformContext`（`:247`/`:253`）在成功与失败两侧都记健康度，并额外校验收体形状（`items` 数组 / `summary` 对象 / `probe_scheduler` 字段），形状不对按失败处理而不是当空数据用。401/403 仍然上抛，不记成"数据读不到"。
- 影响：`emptyCollection` 语义未改（调用方不会突然拿到 undefined），但任何"0 条 / 未启用"的文案在渲染前都可以先问 `getCollectionHealth(source)`。这是全站空态谎报的根因收口点。

### B2 任务中心：未知态、刷新反馈、数据过期

- `public/js/pages/tasks-page.js`：任务池三分支空态（`:470-473`）—— 有筛选 → "清空筛选"；`tasks` 读失败 → "任务数据读取失败（…），这里的 0 条不代表没有任务。" + `#task-load-retry` 重试按钮；否则才显示原文案。计数在失败时输出"共 N 条 · 未确认"（`:727`）。巡检状态条新增 `巡检状态未知` 分支（`badge-degraded`），说明里带上错误与最近成功读取时间。"数据时间"改为随秒龄判定，超过 300s 加 `.is-stale`（`public/styles/pages/tasks.css` 用 `--warning-text`，两个主题都有定义）。轮询开关文案改为"有任务未完成或巡检在跑时自动刷新"。
- `public/js/pages/tasks-page-actions.js`：`hasInFlightTasks()`（`:200`）纳入 `new`（取证实例 9/9 全 failed → 旧逻辑永不轮询）；新增 `shouldPollTasks()`（`:269`；有在途任务，或数据龄 ≥300s 才做一次有界补拉）；`refreshTasksView` 补 `catch`，按 `isUnauthorizedError` 分别给"登录已过期…"与"刷新失败：… 当前列表可能已经不是最新。"；用 `keepViewport`（`:230`/`:247`/`:263`）让"数据没变就不打断"成为事实（原先 `finally` 无条件重绘）；刷新成功时若本页任一数据源读失败，文案改为"已刷新，但任务、节点…数据读取失败，这里的 0 不代表没有。"
- `public/js/pages/tasks-page-bindings.js`：`#task-load-retry` 绑定到 `refreshTasksView`。
- `public/app.js`：向任务页注入 `getCollectionHealth`、`isUnauthorizedError`。

### B3 发布中心：可达层按判定口径 C 分层渲染（不改生效判定）

- `public/js/shared/core-formatters.js:429`：新增 `getReleaseReachability(release)`，把 `summary.reachability_status`（回退 `verification.reachability_status`）映射为 4 条标签（入口可达已验证 / 部分通过 / 未通过 / 未复检），并从 `summary.reachability_failures` 去重汇总节点数与 `reason_code`（最多列 3 类 + "等 N 类"）。字段缺失时返回 `null`，不编造结论。
- `public/js/pages/releases-page.js`：列表状态格在 `warn` 时改走 `badge badge-degraded`、`skipped` 加一枚 `pill`，并在格下渲染说明；展开行的逐节点标签补"入口未通过"。**生效层已判失败的记录不再叠加可达层警示**，避免两层红字混在一起。
- `public/js/pages/proxy-profiles-page.js`：协议模板的"最近关联发布"同样分层。
- `test/release-reachability-view.test.js`（新增 6 项）：四种状态映射、缺字段不产结论、`summary` 缺失时回退 `verification`。
- 浏览器复验：造 4 条发布（failed / skipped / partial / success）后，同一列表页四种表现互不相同，`success` 不产生额外噪音；该页 `ox` 未因新增说明变大。

### B4 批量终端：提交后自动收口，运行中不再谎报"无输出"

- `public/js/pages/terminal-page-actions.js`：新增 `findActiveOperation` / `isInFlightOperation`（操作状态 `queued|running`）/ `activeOperationSignature()`（操作 + 每目标 `node_id:status:finished_at:outputLength`）；`pollActiveOperation()`（`:73`）每 5s 拉一次 operations，**读失败时回滚到上一次快照**（否则瞬时 500 会把页面渲染成"没有执行记录"），签名不变则不重绘，结束时停表并给"本轮执行已结束，下方回显为节点最终回传结果。"；`syncOperationPoll()`（`:109`）在提交、切换操作、手动刷新三处挂/停；`submitExecution` 开头先 `stopOperationPoll()`，避免上一轮定时器在本轮请求期间把旧列表写回。
- `public/js/pages/terminal-page.js`：目标状态在 `pending|queued|running` 时输出"执行中：节点尚未回传输出，页面每 5 秒自动刷新，完成后这里会显示回显。"（`:205`），只有真正结束的节点才显示"[无输出] 后端未返回…"。
- `public/js/store/runtime-store.js`：`appState.terminal` 增加 `pollTimer` / `isPolling` / `lastPolledSignature`。
- 浏览器复验：提交后无人点击，回显计数从 1 自然涨到 4，运行中显示"执行中…"，结束后显示真实输出与结束提示；停表后计数在 8s 观察窗内保持不变（定时器确已停止）。

### 门禁

- [x] `npm run check`（全量 JS `node --check`）通过
- [x] `npm test` 309/309 通过（含本窗新增 `test/release-reachability-view.test.js` 6 项）
- [x] 复验宽度：运营实际宽度 1013；B3/B4 造了最小可复验样本（4 条不同可达层的发布、1 个在途批次），样本只在临时实例内，不入库

## 8. 取证环境备注

六宽度量测与页面复验都在一个**临时实例**（独立端口 + 独立数据目录 + 该目录内自带样本）上完成，样本字段结构取自真实 store 形状，不代表任何线上环境。该实例与临时数据目录在收轮时按 PID 关闭并删除，产物不入库。
