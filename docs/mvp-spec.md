# Threadline Human-Agent Gateway MVP Spec

状态：Approved for implementation  
版本：v0.1  
日期：2026-07-18

## 1. 产品目标

Threadline 是一个单用户、自托管的 Human-Agent Gateway。它为人和多个异构 Agent 提供统一的工作事实源，用来保存值得关注的交付、持续事项和需要闭环的决定。

它要解决的核心问题不是“Agent 是否在线”，而是：当多个 Agent 在不同 Runtime 和 session 中并行工作时，用户仍能知道每件事为什么开始、当前在等谁、下一步是什么，以及某个决定是否已经完成。

## 2. MVP 使用者与部署

- 唯一用户为实例所有者 Jim。
- Gateway 自托管在私有服务器，开发阶段可在本地运行。
- 正式部署使用 Docker，SQLite 数据目录通过持久化 volume 挂载。
- 源码托管在 GitHub Public Repository；任何 Token、数据库和本地配置均不得提交。
- 人通过 Web 使用 Gateway。
- Agent 通过 CLI 使用 Gateway。
- Web 和 CLI 使用同一套后端语义能力。
- MVP 不做细粒度权限；所有持有实例 Token 的客户端均可读写全部内容。
- 所有写操作记录 actor、source、runtime、agent 和 session，保证可追溯。

## 3. 核心原则

### 3.1 Gateway 是独立事实源

Gateway 不依赖 Paseo、OpenClaw、Codex 或其他 Runtime 的生命周期。Runtime 被停用、断连或替换后，Gateway 中已有的事项、提交和决定仍然有效。

### 3.2 事实与注意力分离

Submission 表示发生过的事实；Notification 表示该事实当前是否需要占用人的注意力。Submission 一旦写入就保留，Notification 可以被抑制、归档或因决定关闭而结束。

### 3.3 人和 Agent 能力对等

Web 和 CLI 是同一领域 API 的不同客户端。MVP 不限制 Agent 只能读取或修改自己创建的数据，但每次操作必须带有可审计的 actor 信息。

### 3.4 不猜测 Runtime 状态

Gateway 不读取日志、不轮询 session、不自动发现工作，也不反向调用 Agent。Agent 或人必须主动提交标准化内容。

## 4. MVP 核心链路

1. Agent 在某个 session 中通过 Skill 调用 CLI，创建 `decision_request`。
2. 后端在同一事务中创建 Submission、Decision 和 Active Notification。
3. Web Inbox 展示 runtime/agent 名称、session ID、摘要和所需动作。
4. Jim 根据这些信息自行找到原 Agent session；MVP 不提供跳转链接。
5. Jim 在原 session 中告诉 Agent 决定。
6. Agent 根据已安装 Skill 调用 CLI：`threadline decision resolve <id> ...`。
7. 后端幂等地关闭 Decision，并将关联 Notification 标记为 resolved。
8. Web Inbox 不再显示该待处理项，Decision Registry 保留完整结果。
9. Agent 查询到已关闭结果并继续工作。

## 5. 领域对象

### 5.1 Initiative（界面名称：事项）

表示一项持续推进的工作主题，回答“为什么做”。它不是单次任务，也不是 Agent session。

字段：

- `id`
- `title`
- `intent`
- `status`: `active | waiting_for_jim | waiting_for_agent | paused | completed | cancelled`
- `next_step?`
- `created_at`
- `updated_at`
- `last_activity_at`
- `created_by`

规则：

- 由人或 Agent 显式创建，不根据 Submission 自动猜测。
- Submission 可以关联一个事项，也可以独立存在。
- Workboard 的每张卡代表一个事项。
- 关联 Submission、Decision 或事项更新时刷新 `last_activity_at`。

### 5.2 Submission

表示人或 Agent 主动投递的一条标准内容，回答“发生了什么、希望接收者做什么”。

字段：

- `id`
- `kind`: `delivery | recommendation | decision_request | alert | digest | progress_update`
- `title`
- `summary`
- `detail?`
- `detail_ref?`
- `initiative_id?`
- `attention_policy`: `interrupt | inbox | digest | record_only`
- `dedupe_key?`
- `source`
- `runtime?`
- `agent?`
- `session_id?`
- `observed_at?`
- `created_at`
- `created_by`

规则：

- `decision_request` 必须同时携带 Decision 数据。
- `observed_at` 表示用户已在当前 Agent session 中看到该内容；此时内容留痕，但不生成 Active Notification。
- `record_only` 不生成 Active Notification。
- 普通成功日志不应提交为 Inbox 内容。
- 同一非空 `dedupe_key` 的 Active Notification 只保留一个注意力入口，后续 Submission 仍分别留痕。

### 5.3 Decision

表示一个需要明确关闭的问题。

字段：

- `id`
- `submission_id`
- `initiative_id?`
- `question`
- `options?`
- `risk_level`: `low | medium | high`
- `status`: `open | seen | resolved | expired | superseded`
- `resolution?`
- `resolved_via?`
- `resolved_by?`
- `resolved_at?`
- `created_at`
- `updated_at`

规则：

- Decision 只能随 `decision_request` 创建。
- `resolve` 必须幂等：重复提交相同结果返回当前对象，不创建新事件或新提醒。
- 已 resolved 的 Decision 若收到不同结果，返回冲突错误，不静默覆盖。
- 通过原 Agent session 完成时，`resolved_via` 记录为 `agent_session`。
- Decision 关闭后，所有关联 Active Notification 同步转为 `resolved`。

### 5.4 Notification

表示 Submission 在 Inbox 中的注意力投影。

字段：

- `id`
- `submission_id`
- `channel`: MVP 固定为 `web`
- `status`: `active | read | snoozed | archived | resolved | suppressed`
- `suppression_reason?`: `observed | record_only | digest | deduplicated`
- `snoozed_until?`
- `created_at`
- `updated_at`

Inbox 默认只返回 `active`、`read` 以及已到期的 `snoozed` Notification。Decision 关闭产生的 `resolved` Notification 只在历史记录中可见。

### 5.5 Audit Event

所有状态变化写入 append-only 审计记录：

- `id`
- `entity_type`
- `entity_id`
- `event_type`
- `actor_type`: `human | agent | system`
- `actor_name`
- `source?`
- `runtime?`
- `agent?`
- `session_id?`
- `payload?`
- `created_at`

## 6. Web 功能范围

Web 是 MVP 的人类操作界面，但视觉设计不在本实现阶段确定。

### Inbox

- 查看当前需要处理的 Notification。
- 按紧急性、是否需要决策和创建时间排序。
- 显示摘要、所需动作、事项、runtime/agent 和 session ID。
- 支持标记已读、稍后处理和归档。
- 能进入 Submission/Decision 详情。

### Workboard

- 按“进行中、等待 Jim、等待 Agent、暂停/完成”聚合事项。
- 卡片显示意图、状态、最后活动、等待对象和下一步。
- 支持进入事项详情查看关联历史。

### Decision Registry

- 查看 open、seen、resolved、expired、superseded 的决定。
- 查看问题、选项、风险、来源 session 和最终结果。
- 人也可以从 Web 关闭 Decision，行为与 CLI 相同。

### 详情与创建

- 创建和编辑事项。
- 提交标准内容。
- 查看事项、Submission、Decision 和 Audit Event 的关联关系。

## 7. CLI 能力

CLI 命令名为 `threadline`。输出默认适合人阅读，`--json` 输出稳定 JSON，供 Agent 使用。

### 配置

- `threadline config set-url <url>`
- `threadline config set-token <token>`
- `threadline config show`
- 环境变量 `THREADLINE_URL`、`THREADLINE_TOKEN` 优先于配置文件。

### 状态与读取

- `threadline status`
- `threadline inbox list|get|read|snooze|archive`
- `threadline workboard list`
- `threadline initiative create|list|get|update`
- `threadline submission create|list|get`
- `threadline decision list|get|resolve`

### Agent 上下文

CLI 支持通过选项或环境变量提供：

- `THREADLINE_ACTOR_NAME`
- `THREADLINE_RUNTIME`
- `THREADLINE_AGENT`
- `THREADLINE_SESSION_ID`

Skill 应要求 Agent 在写操作中提供准确的 session 信息。

## 8. HTTP API

所有 `/api/v1/*` 请求使用 `Authorization: Bearer <token>`。健康检查 `/health` 不需要认证。

主要资源：

- `/api/v1/inbox`
- `/api/v1/workboard`
- `/api/v1/initiatives`
- `/api/v1/submissions`
- `/api/v1/decisions`
- `/api/v1/notifications`
- `/api/v1/events`

约束：

- 使用 JSON 请求和响应。
- Initiative/Submission 创建接口支持 `Idempotency-Key`；Decision resolve 自身保持语义幂等。
- 错误响应包含稳定的 `code`、可读 `message` 和可选 `details`。
- 列表接口使用 cursor pagination，并允许按状态、事项、runtime、agent 和 session 过滤。
- 时间统一使用 UTC ISO 8601；展示层再转换时区。

## 9. Skill 包

仓库内提供一个可安装的 Agent Skill：`skills/threadline-gateway/`。

Skill 的职责：

- 识别值得提交的 delivery、recommendation、decision_request、alert 和 progress_update。
- 避免把普通运行日志或低价值成功信息写入 Inbox。
- 创建 Decision 时保留 decision ID 和当前 session 信息。
- 当用户在原 session 给出明确决定后，调用 CLI resolve，而不是再次询问。
- 在继续有风险的工作前查询 Decision 当前状态。
- 已关闭的决定只读取结果，不重复请求。

Skill 不是后台进程，也不负责轮询。目标 Agent 必须支持 Agent Skills 规范，并能执行本地 CLI。

## 10. 技术方案

- TypeScript monorepo，使用 npm workspaces。
- Node.js 22 LTS。
- API：Fastify。
- 运行时校验与共享协议：TypeBox。
- 存储：SQLite，使用 `better-sqlite3` 和显式 SQL migration。
- CLI：Commander。
- 后续 Web：React + Vite，消费同一共享协议包。
- 测试：Vitest；API 通过 Fastify inject 测试，CLI 使用临时配置和测试服务器完成端到端验证。
- 部署：多阶段 Docker 镜像；运行容器使用非 root 用户，数据库位于 `/data` volume。
- 配置：容器通过环境变量接收 Token、监听地址、端口和 SQLite 路径。

建议目录：

```text
apps/
  api/
  cli/
  web/                 # UI 设计确认后实现
packages/
  protocol/
  store/
skills/
  threadline-gateway/
docs/
Dockerfile
compose.yaml
```

### Docker 运行约束

- 镜像不得内置实例 Token 或任何开发机配置。
- `THREADLINE_TOKEN` 在启动时必须显式提供。
- 默认监听容器内 `0.0.0.0:3000`。
- 默认数据库为 `/data/threadline.sqlite`，`/data` 必须映射到持久化 volume。
- 提供容器健康检查并调用无认证的 `/health`。
- SQLite schema migration 在 API 启动时自动、幂等执行。
- MVP 发布单个 Gateway API 镜像；CLI 作为独立 npm workspace/package 在 Agent 环境中运行。

## 11. MVP 非目标

- Telegram 双向交互或其他消息通道。Outbound Telegram delivery for new Decisions and Alerts is supported through environment configuration.
- Agent session 深链接。
- 多用户、组织、角色和细粒度权限。
- Runtime 日志、状态监控、生命周期管理或反向调用。
- 后端自然语言解析和自动审批。
- 自动发现或自动创建事项。
- 自动将无活动事项改为 paused。
- 日报、周报和复杂摘要调度。
- 完整聊天能力。

## 12. 验收标准

1. 本地启动后端后，CLI 可通过可配置 URL 和 Token 完成所有核心操作。
2. Agent 创建 `decision_request` 后，Inbox 能读取包含 runtime、agent 和 session ID 的提醒。
3. Agent 在原 session 获得用户决定后，CLI resolve 能幂等关闭 Decision 和关联 Notification。
4. Web 与 CLI 读取和修改同一份领域数据。
5. `observed` 的普通交付被记录，但不会出现在 Active Inbox。
6. 无任何 Runtime 在线时，已有事项、提交和决定仍可查询和修改。
7. Workboard 能在一屏数据量内清楚回答 3–4 个并行事项的意图、等待对象和下一步。
8. 数据库迁移、API 校验、核心状态转换和 CLI 决策链路均有自动化测试。
9. `docker compose up` 能启动 Gateway，健康检查通过，容器重建后 volume 中的数据仍然存在。
10. GitHub Public Repository 不包含 Token、数据库文件、`.env` 或其他机器私有数据。

## 13. 实施阶段

### 阶段 A：无 UI 的可用内核

- protocol、SQLite schema/migrations、API、CLI、Skill。
- 完成 Decision 端到端闭环和自动化测试。

### 阶段 B：设计驱动的 Web

- UI 设计 Agent 根据独立 brief 产出信息架构和高保真方案。
- 设计确认后实现 Web Inbox、Workboard、Decision Registry 和详情页。

### 阶段 C：真实使用校准

- 用多个 Agent/session 运行 1–2 周。
- 根据真实噪音调整 attention policy、dedupe 和摘要策略。
