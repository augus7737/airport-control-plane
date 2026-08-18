# 稳定运行改造路线图

更新时间：2026-08-17

## 目标

把当前单机 MVP 版本改造成低配服务器上也能长期稳定运行的控制面。

优先顺序：

1. 数据不丢、不损坏
2. 服务崩溃后能自动恢复
3. 故障可定位
4. 低资源占用
5. 控制面安全加固
6. 后续平滑迁移到数据库

## P0：立即处理

### 1. JSON 原子写入

当前风险：

- `data/*.json` 直接覆盖写入
- 进程崩溃、磁盘满、并发写入时可能造成 JSON 文件损坏

改造内容：

- 新增统一的 `atomicWriteJson`
- 写入流程改为 `tmp -> fsync -> rename`
- 写入成功后保留上一版 `.bak`
- 启动时如果主文件损坏，尝试从 `.bak` 恢复

涉及文件：

- `src/infrastructure/store-persistence.js`

验收标准：

- 写入过程中强杀进程，不应留下不可解析的主 JSON 文件
- 主 JSON 损坏时服务能从备份恢复或明确报错

### 2. Store 写入串行队列

当前风险：

- 节点注册、任务更新、探测、发布可能同时写同一个 JSON
- 最后一次写入可能覆盖前一次状态

改造内容：

- 每个 store 文件维护一个写入队列
- 同一文件的写入串行执行
- 写入失败时记录结构化错误日志

优先保护：

- `nodes.json`
- `tasks.json`
- `operations.json`
- `probes.json`
- `bootstrap-tokens.json`

验收标准：

- 并发创建任务/注册节点时数据不丢
- 日志中能看到写入失败原因

### 3. 请求体大小限制修复

当前风险：

- 请求体超过 1MB 后只 reject，但连接仍可能继续读
- 低配机器可能被大请求拖垮

改造内容：

- 超过限制立即停止读取并销毁请求
- 返回 `413 Payload Too Large`
- 保证 Promise 只 resolve/reject 一次

涉及文件：

- `src/utils/http.js`

验收标准：

- 超大 JSON 请求返回 413
- 进程内存不会持续上涨

### 4. 裸机 systemd 加固

当前风险：

- 低配服务器资源有限
- 服务异常重启策略和资源限制还不完整

改造内容：

- 增加内存限制
- 增加重启频率限制
- 限制文件系统写入范围
- 只允许写入项目数据目录

建议配置：

```ini
Restart=always
RestartSec=3
StartLimitIntervalSec=60
StartLimitBurst=10
MemoryMax=256M
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/opt/airport-control-plane/data
```

验收标准：

- 服务异常退出后自动恢复
- 内存异常增长时被 systemd 限制
- 服务只能写入允许的数据目录

### 5. 自动备份

当前风险：

- 单机 JSON 数据没有自动备份

改造内容：

- 每日备份 `/opt/airport-control-plane/data`
- 备份到 `/opt/airport-backups`
- 保留最近 7 天每日备份和最近 4 周每周备份

验收标准：

- 能通过一条命令恢复最近一次备份
- 备份任务失败时写入系统日志

## P1：短期增强

### 0. 多系统节点接入兼容

当前进展：

- bootstrap 已支持 Alpine、Debian / Ubuntu、RHEL family 的基础准备
- 节点注册会上报 `os_id` / `os_family`，控制端按系统事实自动选择初始化模板
- 内置模板已覆盖 `alpine-base`、`debian-base`、`rhel-base`

继续改造：

- 发布 sing-box 时按 `apk` / `apt` / `dnf` / `yum` 自动补装运行时
- 增加 Arch / openSUSE 的轻量模板或明确提示为“未验证系统”
- 在前端节点详情展示“系统识别结果”和“自动选择模板”

验收标准：

- 新设备只需复制网页的一行命令执行，不需要人工判断系统模板
- 不支持的系统应保留节点记录并给出明确下一步，而不是静默失败

### 1. `/readyz` 就绪检查

当前 `/healthz` 只能说明进程活着，不能说明数据已加载完成。

改造内容：

- 保留 `/healthz` 作为存活检查
- 新增 `/readyz` 作为就绪检查
- 检查核心 store 是否加载成功

验收标准：

- store 加载失败时 `/readyz` 返回非 200
- systemd 或反向代理可用 `/readyz` 判断服务是否可接流量

### 2. 结构化日志

当前日志分散，不利于定位故障。

改造内容：

- 新增统一 logger
- 每条日志包含 `time`、`level`、`event`
- 请求链路增加 `request_id`

优先覆盖事件：

- 登录失败
- 节点注册
- bootstrap 完成
- SSH 执行开始和结束
- 探测开始和结束
- 配置发布开始和结束
- store 写入失败和恢复失败

验收标准：

- 一次节点注册能通过 `request_id` 串起完整日志
- 失败任务能从日志定位到节点、任务和错误原因

### 3. 任务状态机标准化

当前任务状态已可用，但还需要更明确的异常恢复语义。

建议状态：

- `queued`
- `running`
- `success`
- `failed`
- `cancelled`
- `timeout`
- `interrupted`

改造内容：

- 启动时把遗留 `running` 任务标记为 `interrupted`
- SSH/探测/发布任务统一超时字段
- 探测任务允许有限重试
- 发布任务默认不自动重试，只允许人工重试

验收标准：

- 控制面重启后无永久 `running` 任务
- 任务失败原因可在任务中心看到

### 4. Web Shell 资源限制

当前 Web Shell 是真实后端进程，需要保护低配机器。

改造内容：

- 单用户最大 session 数
- 单节点最大 session 数
- session idle 超时
- 输出 buffer 上限

验收标准：

- 超出限制时返回明确错误
- 空闲 session 自动关闭

## P2：安全加固

### 1. 登录限流

改造内容：

- `/api/v1/auth/login` 按 IP 统计失败次数
- 5 分钟内最多 10 次失败
- 超限后短暂锁定

验收标准：

- 连续失败登录会返回限流错误
- 成功登录后清理失败计数

### 2. Cookie 安全策略

改造内容：

- HTTPS 部署时启用 `CONTROL_PLANE_SESSION_SECURE=true`
- 保留 `HttpOnly`
- 保留 `SameSite=Lax`

验收标准：

- HTTPS 下 Cookie 带 `Secure`
- HTTP 本地调试不受影响

### 3. Token 脱敏

当前 bootstrap token 需要复制使用，短期可以保留明文。

中期改造：

- 创建时只显示一次明文
- 服务端持久化 token hash
- 注册时比对 hash

验收标准：

- JSON 文件中不再保存 bootstrap token 明文
- 旧 token 可通过迁移兼容

### 4. 敏感日志清理

禁止日志输出：

- 控制面登录密码
- bootstrap token 明文
- share token 明文
- SSH 私钥内容

验收标准：

- 搜索日志不会出现敏感明文

## P3：工程质量

### 1. 增加测试脚本

改造内容：

- 使用 Node 内置 test runner
- 补充 `npm test`
- 补充基础语法检查脚本

建议脚本：

```json
{
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "test": "node --test",
    "check": "node --check src/server.js"
  }
}
```

优先测试：

- auth session
- request body limit
- bootstrap token 创建和消耗
- atomic store write
- 节点注册去重
- 任务重启回收

验收标准：

- `npm test` 可在本地和服务器执行
- 核心链路改动前后有自动回归

### 2. 拆分 `src/server.js`

当前问题：

- `src/server.js` 超过 5000 行
- 路由、业务编排、迁移、执行逻辑混在一起

建议顺序：

1. `src/routes/auth-routes.js`
2. `src/routes/node-routes.js`
3. `src/routes/task-routes.js`
4. `src/routes/bootstrap-routes.js`
5. `src/routes/release-routes.js`
6. `src/services/node-service.js`
7. `src/services/task-service.js`
8. `src/services/release-service.js`

验收标准：

- 拆分后路由行为不变
- 每次拆分都有测试覆盖

## P4：数据库化

### 1. SQLite 迁移

当前项目部署在低配机器上，第一阶段不建议直接引入 PostgreSQL。

推荐先迁移到 SQLite：

- 无需额外数据库服务
- 资源占用低
- 支持事务
- 比 JSON 更适合长期运行

优先迁移表：

- `nodes`
- `tasks`
- `operations`
- `probes`
- `bootstrap_tokens`
- `access_users`
- `proxy_profiles`
- `node_groups`
- `providers`
- `config_releases`
- `system_users`
- `system_templates`

迁移策略：

- 首次启动检测 SQLite 文件
- 如果不存在，从 JSON 导入
- 导入成功后 JSON 转为备份
- 保留只读 JSON 导入工具

验收标准：

- 原有 JSON 数据可完整导入
- 核心 API 读写改为事务
- 服务重启后任务和节点状态一致

### 2. PostgreSQL 预留

等系统需要多实例或更复杂查询时，再迁移 PostgreSQL。

预留要求：

- repository 层不要绑定 SQLite 特有 API
- 查询和事务集中封装
- migration 文件可重复执行

## 推荐执行顺序

### 第一轮

1. JSON 原子写入
2. Store 写入串行队列
3. 请求体大小限制修复
4. systemd 加固
5. 自动备份

### 第二轮

1. `/readyz`
2. 结构化日志
3. 任务状态机标准化
4. Web Shell 资源限制

### 第三轮

1. 登录限流
2. Cookie 安全策略
3. 敏感日志清理
4. Token hash 化

### 第四轮

1. 增加测试脚本
2. 补核心单测
3. 拆分 `src/server.js`

### 第五轮

1. SQLite schema 设计
2. JSON 导入工具
3. 核心 store 迁移
4. 保留备份和回滚路径

## 当前最小可执行改造包

如果只做一次短平快稳定化，优先做：

1. `atomicWriteJson`
2. store 写入队列
3. `readJsonBody` 超限返回 413
4. systemd `MemoryMax` 和 `ReadWritePaths`
5. 每日数据备份

这 5 项完成后，系统的数据安全和低配服务器稳定性会明显提升。
