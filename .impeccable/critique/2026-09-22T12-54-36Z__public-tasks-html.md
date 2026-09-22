---
target: 任务中心 (public/tasks.html)
total_score: 16
max_score: 40
na_heuristics: 
p0_count: 3
p1_count: 2
target_identity: "file:/Users/linkai/Documents/airport/airport-control-plane/public/tasks.html"
target_fingerprint: "sha256:9346e9d2f29102c6f8e0cc00790bdccfffe8ccc41303620dd377aed789ea81f9"
target_path: /Users/linkai/Documents/airport/airport-control-plane/public/tasks.html
timestamp: 2026-09-22T12-54-36Z
slug: public-tasks-html
---
Method: dual-agent (A: general-purpose design review, live browser · B: general-purpose impeccable detect + browser DOM evidence)

## Design Health Score — 16/40

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 1 | 前端全局 0 个 setInterval；`执行中 0 条` 是加载快照；running 永不推进；无数据时间戳 |
| 2 | Match System / Real World | 2 | `success`→可用 / `failed`→异常 与筛选器「已成功/失败」不一致；`重试次数` 渲染 attempt 而非 retries；`触发参数` 吐原始 snake_case |
| 3 | User Control and Freedom | 1 | 7 行任务 tabIndex=-1、无 role（实测）→ 键盘打不开详情栏；无取消/撤销/深链；带筛选重试会删掉当前行 |
| 4 | Consistency and Standards | 2 | 筛选标签 ≠ 徽章标签；`计划时间` 表格与 rail 取不同字段；`共 N 条`(已筛选) 与 `可处置 N 条`(全量) 并排 |
| 5 | Error Prevention | 1 | `重新初始化` 单击直发 /nodes/:id/init（脚本会重启 sshd），与无害的 `立即复探` 同权重同 label |
| 6 | Recognition Rather Than Recall | 2 | 真答案在第 4 块面板 `任务摘要日志`，其标题却写「适合快速扫一眼状态变化」；第 3 块抢职责且撒谎 |
| 7 | Flexibility and Efficiency | 1 | 无批量重试、无键盘路径、不读 location.search、每次刷新全量 innerHTML 重绘 |
| 8 | Aesthetic and Minimalist Design | 1 | 第一行任务前约 17 个装饰件 / 224px 自动巡检块；6 条失败面前页面在讲「未启用/已暂停/0 条」 |
| 9 | Help Users Recover from Errors | 2 | 加分：日志面板给 IP:port + 健康分 + 节点状态。减分：appState.probes 的 reason_code/error_stage/latency_ms 引用 0 次；英文原始报错可外泄 |
| 10 | Help and Documentation | 2 | 内联面板文案具体，但关键处写错；`可处置 / 部分成功` 无解释 |
| **Total** | | **16/40** | 低于健康线（真实界面通常 20–32）——问题在结构层，不是打磨层 |

na_heuristics: 无（10 项全部适用并打分）

## Design Specificity Verdict

词汇是本项目的，层级是模板的。具体部分是真的：taskTriggerLabel (tasks-page.js:261-277) 把 bootstrap_auto_probe→注册后自动首探、scheduled_probe→周期巡检调度翻译成了运维语言；task-helpers.js:42-53 把 probe_node 拆成自动首探/周期巡检/手动复探。去掉中文后剩下的仍是 KPI 卡行 + 计数 pill + 筛选条 + 8 列表格 + 右侧抽屉。

自相矛盾的决定性证据：副标题写「进入页面先看当前任务池」(tasks-page.js:521)，实测第一条任务行在文档 y=605，上面压着 224px 自动巡检面板 + topbar。1280x800 上任务行为 0。

**Deterministic scan**: impeccable detect 对 4 个在范围文件退出码 0、主问题 0（用含已知反模式的 canary 复扫得 3 项/退出 2，证明扫描真跑了）；扩到共享 CSS/app.js/js/shared 仅 1 条 advisory `codex-grid-background` @ styles/base.css:23（全局 shell 底纹，非任务中心）。URL 模式因无鉴权 cookie 被重定向到登录页，7 条发现全为范围误报。探测器干净而本轮最严重的问题它一个都没抓到：缺陷全在运行时/状态层（选中态溢出、快照不刷新、错误解释文案），来自 A 的实测与代码交叉验证。

**Visual overlays**: 注入前置检查通过（title 哨兵 + append script 确认执行），但没有可靠的用户可见 overlay，不声称有。detect.js 是 2.2MB 自包含文件，无法经 evaluate_script 载荷传入，8080 不托管它，live-server 会起第二个服务（本轮禁止）。降级信号 = CLI 静态扫描 + 确定性 DOM 测量。

## Overall Impression

数据层比界面层成熟。后端把诊断所需的一切都算好了（probes.reason_code/error_stage/latency_ms、任务 started_at/finished_at、6 条失败同源于 1 轮巡检），界面把它们丢掉：6 条失败耗时全部恰好 4.05s（统一快速失败超时，本身就是答案）无处渲染，probes 没关联，批次没聚合。最大机会不是重画，而是把「任务中心」从一张表改造成有实时性、能按轮次归并的故障队列。

## What's Working

1. 任务摘要日志 (tasks-page.js:491-510) 是全页唯一回答问题的地方：探测类型/目标 IP:port/管理链路 TCP 未连通/健康分 16 + 节点状态 degraded —— 目标、原因、后果顺序正确。问题只在被埋在第 4 块且标题被降级成「扫一眼状态变化」。
2. 空状态区分成因 (tasks-page.js:316-326)：「下一台新节点完成 bootstrap 后，这里会自动出现初始化和首探任务」对第一周值班是真定向信息。
3. tabular-nums 已正确落在 th, td (primitives.css:177)，数字列无对齐回归。

## Priority Issues

### [P0] 选中任务后详情栏被视口裁掉且无法滚到
A 在 1222px 实测表格 scrollWidth 988 / shell 591、动作按钮右边缘 1236；B 独立测到 .tasks-detail-rail 轨道 320px (tasks.css:168) 而面板实际 401px、右边缘 1253 > 视口 1222，且 body{overflow-x:clip} (base.css:17) 让 ~31px 溢出滚动不可达。根因：tasks.css:185-188 的 min-width:980px 撞上 tasks.css:167-170 选中后的 591px 轨道。
Why: 唯一必做的循环是「读诊断 → 重试」；未选中已有 65px 溢出，选中后主操作躲进无标签内部滚动条，诊断栏同时缺一块。
Fix: tasks-page.js:652-661 从 8 列降到 6 列（类型 并进 任务 做副标签、重试 并进 状态），动作 移到 rail 的 task-detail-actions (:391-407) 做唯一主按钮，行内只留紧凑 复探 ghost；tasks.css:185 min-width 降到 ~720px。
Command: /impeccable layout (+ distill)

### [P0] 关联执行回显 对 100% 真实失败任务给出错误结论
实测 7 条任务 operation_id 全为 null，getLinkedOperation (:134-140) 恒 null，:441 渲染「当前任务还没有绑定执行记录，通常表示它还未真正下发到节点」，而下方日志证明探测真的跑了、真的失败了。
Why: 这是唯一声称回答「为什么」的面板，却给自信的假答案；值班人会 conclude 控制面到不了节点，整晚查错方向。本模块最危险的单条文案。
Fix: tasks-page.js:438-443 按 task.status + 是否有 log_excerpt 分支，已完成且无 operation_id → 「探测由控制面直接执行，未生成执行记录；失败原因见下方摘要日志」；把 任务摘要日志 提到 触发参数 之前；用 probe.task_id 关联 appState.probes 渲染 reason_code/error_stage/latency_ms。
Command: /impeccable clarify (+ audit)

### [P0] 队列是冻结快照却按实时状态呈现
全 public/js 无 setInterval；refreshTasksView (tasks-page-actions.js:91-98) 无 pending 态（行内按钮却正确做了 disabled aria-busy）；实测点刷新后 window.scrollY→0、表格 scrollLeft 65→0、activeElement→BODY（page-render-runtime.js:71-72 全量 innerHTML 替换）。
Why: 盯长任务的人分不清「还在跑」和「页面是旧的」；唯一能修正它的按钮把人送回 1335px 页面顶部。
Fix: 存在 running/queued 时 15s 轮询；任务池 头部 (:599-605) 加「数据时间 hh:mm:ss + 自动刷新开关」；refresh 加 isRefreshing 复用行内 is-loading；renderCurrentContent 保留 scroll/focus。
Command: /impeccable harden (+ optimize)

### [P1] 状态词汇三套系统互相矛盾，且键盘与焦点不可达
core-formatters.js 的 success→可用 / failed→异常 / new→待初始化（为节点状态写的）被任务页直接复用 (:307,353)，筛选器 (:614-620) 却写「已成功/失败/待执行」；partial 有 label 但不在 select 里 → 不可筛；statusClassName 把 queued/running/partial 涂同一蓝、failed/degraded/expired/disabled/exhausted 涂同一红；待执行 同时是筛选标签、attempt 0 文案、计数 pill。B 实测键盘聚焦 #task-status/#task-type/#task-query 时 :focus-visible 为真但 outline-style:none（primitives.css:26 的 .field … {outline:none} 同特异度覆盖 base.css:54-61 焦点环）；8 个 th 无 scope、无 caption。
Why: 筛选器是首要分诊工具，标签与结果不一致就永远学不会；「失败筛出来却显示可用」摧毁对标签的信任；键盘操作员完全无法诊断。
Fix: 建任务专属 label/tone 映射（已成功/绿、失败/红、待执行/中性、排队中/琥珀、执行中/蓝、部分成功/琥珀）；partial 入筛选；tr[data-task-select] 加 tabindex=0 role=button aria-selected + Enter/Space；恢复 .field 焦点环；重试→执行轮次；计划时间两处统一字段。
Command: /impeccable clarify (+ audit)

### [P1] 重新初始化 一次点击、无确认地改真实节点
tasks-page-actions.js:106-139 直接 POST /nodes/:id/init，服务端脚本 rc-service sshd restart、重写 /etc/airport/node.env；按钮出现在每条 init_alpine 行 (:120) 和 rail (:404)，与无害的 立即复探 同 label 同权重。docs/module-ui-optimization-plan.md:41-42 显示该项目对更轻动作（关 Shell 会话、禁 token）已上确认。
Why: 复探幂等安全，重初始化会重新装配可能在承载流量的机器；全页破坏性最强的控件摩擦最小。
Fix: 行内只留 立即复探 ghost；重新初始化 降为 rail 次级按钮，走既有 modal 原语，点名目标节点、模板 key、"会重启该节点的 sshd 服务"。
Command: /impeccable harden

## Persona Red Flags

**Alex（8 小时值班、键盘优先、吃得下密度）**: tr 是 tabIndex -1，诊断路径只有鼠标能走；#task-refresh 无 pending、无快捷键、滚动与焦点清零；6 条同轮失败（scheduled_at 精确到毫秒全相同）无批量重试 → 6x(选→滚→点→刷新)；不读 location.search，无法把任务贴进故障线程、刷新丢选中，而同文件 terminalOperationHref (:22-23) 证明 codebase 会做深链；#task-query 260ms debounce 直接换 innerHTML、全仓无 compositionstart/end 保护 → 中文搜节点名掉输入法。高放弃风险。

**Sam（值班第一周、焦虑）**: 首屏三块卡说 未启用/已暂停/还没有周期巡检记录，无路径说明这是正常还是事故；关联执行回显 的假解释他会照单全收；重试次数 第 1 次 读成「同事已重试一次」而其实零次；可处置 7 条 读作「7 件事找我」，实际 isActionableTask (:35-37) 忽略状态、7 条全算，无匹配空状态同时显示 共 0 条 与 可处置 7 条；暂不支持 (:127) 是无出口的裸 span；.task-row-selected 只有 8% 青底 (tasks.css:405)，窄屏 rail 掉到表格下方且无 scrollIntoView (tasks-page-actions.js:66-74) → 点行看起来没反应；3 点按下无确认的 重新初始化。

## Minor Observations

- 两处 sticky; top:16px 相撞：.tasks-filter-toolbar (tasks.css:89-106, z-index 2) 盖掉 rail 首块的 任务摘要 标题与头两行 KV（截图可见「探」「手动复」透出）。一行 z-index/top 可修。
- .badge 的 letter-spacing:.08em + text-transform:uppercase (primitives.css:219-230) 落在 2–4 个汉字上 = 0.96px 字距 + 大写空转；实测 待初始化 pill 在 98px 状态列 78x36px 断成两行。
- 11px 列头 + 12px 正文 (tasks.css:195-203) 压在最密的列上；说明 无 line-clamp，把唯一决策 token（203.0.113.x:port）埋在整段灰话中间 → 行高实测 78–112px、7 行 ≈680px。
- .kv-row span 浅色对比度 4.19:1 低于 AA (primitives.css:322-333)；深色 5.8–8.9:1 健康。
- 全页最重要的数字没有颜色：失败 6 条 与 抖动保护 10 秒 同一个灰 .pill (:570)，只有 probeScheduler.last_error（真实数据为 null）有 .pill.danger。
- sortTasks (runtime-store.js:282-288) 只按 scheduled_at 倒序：1 小时前 running 排在 1 分钟前 success 下面，失败与在途不被提上来。
- 时间只给「9 分钟前」，无绝对戳无 title (core-formatters.js:55-65)，无法对齐事故时间线；started_at→finished_at（恰好 4.05s）整页无处可见。
- GET /api/v1/tasks (src/server.js:3864-3869) 不分页不过滤全量返回，200 条时是 200x8 格全量 innerHTML 重写；tasks-page.js:285-292 每次渲染约 9 遍全量扫描。
- tasks-page.js:369 的 .slice(0, 8) 静默截断 触发参数，无「还有 N 项」；app.js:205 副标题承诺「修复」但无 repair 任务类型。
- 与 docs/module-ui-optimization-plan.md 交叉核对：无回归（搜索框焦点还原、payload 序列化、timer 清理、queued 筛选项、trigger 中文化、空状态二分均仍生效）。.field 焦点环抑制与选中态裁切不在那七轮覆盖范围内，属新增。

## Questions to Consider

1. 如果自动巡检只配一行状态、页面第一眼就是失败队列呢？一个在生产数据里「未启用」的子系统占掉首屏 224px 和 3 个最强字号位 —— 这是为管调度配置的人设计的，不是为 3 点值班的人。把第一行任务提到 1280x800 折叠线以上，页面还成立吗？
2. 如果任务中心的真正职责是归并而不是罗列？6 条失败、同一毫秒 scheduled_at、同一个原因，界面要人点 6 次才发现是同一件事。若工作单元是「巡检轮次」（批次展开按节点结果），「什么坏了、为什么」从 6 个循环变 1 个，批量重试还免费。任务行真的是这里的原子吗，还是 GET /api/v1/tasks 返回扁平数组的遗留？
3. 如果 appState.probes 才是诊断界面、任务列表只是它的索引？reason_code/error_stage/latency_ms/每阶段 exit_code 后端全算好、内存现成、本模块引用 0 次，换来一个对 100% 真实任务恒空还撒谎的 关联执行回显。按 probe.task_id 重建 rail 后，「缺关联执行」会不会直接消失，而那个统一 4.05s 的耗时会不会变成全页最有价值的一列？
