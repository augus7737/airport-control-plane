# 重复口径统一化审计

更新时间：2026-08-18

本轮由 3 个子代理分别审计前端、后端、脚本与文档。结论是：币种前端列表已经统一，但系统里仍有多处业务枚举、默认值和示例口径散落，需要逐步抽成单一来源。

## P0

### 1. SSH 管理端口默认值

状态：本轮已处理第一阶段。

发现位置：

- `src/domain/nodes/facts.js`
- `src/domain/nodes/records.js`
- `src/domain/routes/management.js`
- `src/domain/platform/ssh.js`
- `src/domain/tasks/lifecycle.js`
- `scripts/bootstrap.sh`
- `public/js/modals/node-asset-modal-templates.js`
- `public/js/shared/node-formatters.js`
- `README.md`
- `docs/api.md`

问题：

- 节点管理入口默认端口 `19822` 散在多处，代理 SSH 端口 `22` 又在另一些地方单独硬编码。
- LXC/NAT 场景中外部映射端口需要显式填写，散落默认值会诱导用户漏填或让探测回退到错误端口。

方案：

- 后端抽 `src/domain/nodes/management-defaults.js`，统一 `DEFAULT_NODE_SSH_PORT`、`DEFAULT_PROXY_SSH_PORT`、`normalizeSshPort()`。
- 前端抽或复用同样语义的 shared 默认值，节点资产表单不再写死 `19822`。
- 新节点默认管理端口使用 `22`；映射端口由网页一键脚本显式携带。
- 已新增前端 `public/js/shared/management-defaults.js`，表单、payload 和展示回退已改用统一默认。

## P1

### 1. 计费周期选项

状态：本轮已处理第一阶段。

发现位置：

- `public/js/modals/node-asset-modal-templates.js`
- `src/domain/costs/normalize.js`
- `src/http/validators.js`
- `docs/api.md`

问题：

- 前端有两份 `月付 / 季付 / 年付 / 周付 / 日付 / 小时付 / 一次性`。
- 后端 normalize 支持英文别名，但 validator 只接受中文归一化值。

方案：

- 前端抽 `public/js/shared/billing-options.js`。
- 后端 validator 改为调用 `normalizeBillingCycle()` 判定输入是否可归一化。
- 已新增前端 `public/js/shared/billing-options.js`，手动录入和资产编辑弹窗已复用同一组选项。

### 2. 代理协议栈选项

发现位置：

- `public/js/pages/proxy-profiles-page.js`
- `public/js/pages/access-users-page.js`
- `src/http/validators.js`
- `src/domain/releases/sing-box.js`
- `src/server.js`

问题：

- `vless / vmess / hysteria2`、`tcp / udp / ws / grpc / http / httpupgrade`、`reality / tls / none` 多处维护。
- HY2 必须 `tls + udp`、VMess 不支持 Reality 等规则分散，容易出现“能保存不能发布”。

方案：

- 后端抽 `src/domain/proxy/protocols.js`，集中协议、传输、安全枚举和兼容矩阵。
- 前端抽 `public/js/shared/proxy-options.js`，尽量与后端配置同源或由 API 暴露。

### 3. 状态选项与状态流转

发现位置：

- `public/js/shared/core-formatters.js`
- `public/js/pages/providers-page.js`
- `public/js/pages/proxy-profiles-page.js`
- `public/js/pages/access-users-page.js`
- `public/js/pages/system-users-page.js`
- `public/js/pages/system-templates-page.js`
- `public/js/pages/tasks-page.js`
- `src/http/validators.js`
- `src/runtime/probe-scheduler.js`
- `src/domain/tasks/lifecycle.js`

问题：

- 展示 formatter 已集中，但表单和筛选选项仍各自写。
- `active` 在不同资源中显示为“可用”或“启用”，语义未分层。

方案：

- 前端新增 `public/js/shared/status-options.js`，按资源域导出选项。
- 后端按边界拆 `nodes/statuses.js`、`tasks/statuses.js`，集中终态判断、可运行状态、任务到节点状态映射。

### 4. 初始化模板和任务类型

发现位置：

- `src/server.js`
- `src/domain/tasks/store.js`
- `src/domain/tasks/lifecycle.js`
- `docs/api.md`
- `docs/mvp.md`

问题：

- 已支持 Alpine、Debian/Ubuntu、RHEL family，但任务类型仍叫 `init_alpine`。
- 文档仍有 Alpine-only 叙述，和当前多系统兼容不一致。

方案：

- 抽 `src/domain/bootstrap/init-templates.js`，集中模板名、系统族匹配、默认模板选择。
- 新任务类型迁移为 `init_node`，旧 `init_alpine` 做兼容别名。
- 文档明确 `init_alpine` 是历史兼容字段，直到迁移完成。

### 5. 部署模式口径

发现位置：

- `scripts/deploy-production.sh`
- `install.sh`
- `README.md`
- `docs/deployment.md`
- `docs/current-state-prd.md`

问题：

- 文档和脚本仍偏 Docker / Compose，但当前实际目标是低配机器 systemd 直接部署。

方案：

- 新增 canonical systemd 安装脚本和部署文档。
- README 主流程改成 systemd；Docker 标注为可选/历史路径。

## P2

### 1. 通用 normalize 工具

问题：

- `normalizeString`、`normalizePort`、`normalizeBoolean`、`isPlainObject` 在多个 domain 重复。

方案：

- 抽 `src/domain/shared/normalize.js` 或 `src/utils/normalize.js`。

### 2. 前端列表工具

问题：

- `splitCommaList`、`joinCommaList`、行列表解析在多个页面重复。

方案：

- 抽 `public/js/shared/list-formatters.js`。

### 3. 节点组摘要渲染

问题：

- 发布、系统用户、系统模板、接入用户页面都有节点组摘要渲染变体。

方案：

- 抽 `public/js/shared/node-group-renderers.js`。

### 4. 文档示例生成

问题：

- API 示例中的端口、模板、币种、计费周期容易和代码漂移。

方案：

- 先把文档指向 canonical 枚举和默认值；后续引入生成式示例检查。
