# Threadline Session 身份与 Agent Timeline 分层视图 Spec

状态：Draft for review  
版本：v0.1  
日期：2026-07-19

## 1. 背景

Threadline 当前允许 Agent 自行提供任意 `session_id`。CLI 会从命令行参数、环境变量和持久化 context 中选择一个字符串，并直接写入 Submission 与 Audit Event。后端不校验该值是否来自当前 Agent harness，也不维护 Session 实体。

这带来三个问题：

1. 不同 Agent 会自行创建、复用或遗漏 ID，同一段用户会话可能被拆成多个 timeline。
2. 单份持久化 session context 不适合同一主机上并发运行多个相同 harness，可能把不同会话归入同一 timeline。
3. Agent 页面只能选择 Session 层级，无法直接查看某个 Host 或 Tool 下的聚合 timeline。

Codex、Claude Code、OpenCode 和 OpenClaw 均能提供自身的原生会话 ID，但暴露方式不同。Threadline 应优先复用该原生 ID，同时允许尚未适配的 Agent 在没有 ID 的情况下继续提交。

## 2. 目标

本需求交付以下能力：

- 直接使用 Agent harness 的原生会话 ID，不生成第二层 Threadline Session UUID。
- 通过轻量 integration adapter 自动采集 Codex、Claude Code、OpenCode 和 OpenClaw 的原生 ID。
- 允许 `session_id` 为空，并将空值稳定归入当前 Host/Tool 下的 `unscoped` 身份。
- Agent 页面支持 Host、Tool、Session 三个层级的 timeline 聚合与直接访问。
- 保留现有数据和客户端兼容性，不要求回填历史 Session。

## 3. 非目标

本需求不包含：

- Session 实体、Session 表、Session resolve API 或 canonical UUID。
- 跨 harness 迁移或合并会话。
- 根据工作目录、PID、进程启动时间或最近活动推断 Session。
- Session close、在线状态、writer lease 或生命周期监控。
- 自动把历史 `unscoped` 记录并入后来出现的真实 Session。
- 新的后端聚合查询或 timeline 事件类型。
- 修改 Codex、Claude Code、OpenCode 或 OpenClaw 本体的构建与启动方式。

## 4. 术语

### 4.1 Host

执行 Agent 的主机身份。沿用现有 `actor.host` 和 Submission `host` 字段。

### 4.2 Tool

用户直接交互的 Agent harness，例如：

- `codex`
- `claude-code`
- `opencode`
- `openclaw`

Tool 是 Agent 页第二层分组。模型提供商、底层 SDK 或被 OpenClaw 调用的外部 harness 不改变当前 Tool。

例如，用户通过 OpenClaw 会话工作，而 OpenClaw 内部使用 Codex app-server 时：

```text
tool = openclaw
runtime = codex
```

### 4.3 Runtime

Tool 内部的实际执行运行时。它用于诊断和审计，不参与 Agent 页的身份分组。

### 4.4 Native Session ID

由 harness 生成、用于恢复或关联其自身连续会话的稳定 ID：

- Codex：thread/session ID
- Claude Code：`session_id`
- OpenCode：`sessionID`
- OpenClaw：`sessionId`

Threadline 将该值原样存入现有 `session_id` 字段，不改变格式。

### 4.5 Unscoped Session

当提交没有可用 Native Session ID 时使用的虚拟身份。它不是数据库中的伪造 ID，而是身份和展示层对空值的稳定解释。

## 5. 身份模型

### 5.1 有效身份

Agent timeline 的完整身份由三部分组成：

```text
ExecutionIdentity = Host + Tool + SessionScope
```

`SessionScope` 是以下判别联合之一：

```typescript
type SessionScope =
  | { kind: "native"; id: string }
  | { kind: "unscoped" };
```

禁止在领域逻辑中用展示文案 `No session recorded` 作为身份主键。

### 5.2 分组规则

- 相同 Host、Tool、Native Session ID 的记录属于同一 Session timeline。
- 相同 Host、Tool 下所有空 Session 记录属于同一个 `unscoped` timeline。
- 不同 Host 或不同 Tool 的 `unscoped` timeline 必须彼此隔离。
- 不同 Tool 的相同 Native Session ID 不视为同一会话。
- Subagent 默认继承父 harness 会话身份；内部 Agent ID 不产生新的 Threadline Session。

示例：

| Host | Tool | 输入 `session_id` | 有效身份 |
| --- | --- | --- | --- |
| `laptop` | `codex` | `thr_123` | `laptop/codex/native:thr_123` |
| `laptop` | `codex` | 空 | `laptop/codex/unscoped` |
| `laptop` | `claude-code` | 空 | `laptop/claude-code/unscoped` |
| `vps` | `codex` | `thr_123` | `vps/codex/native:thr_123` |

### 5.3 空值规范化

以下输入都视为未提供 Session：

- `undefined`
- `null`
- `""`
- 仅包含空白字符的字符串

规范化发生两次：

1. CLI 构造 Actor Context 时，把空字符串和纯空白变为未定义。
2. Store 写入 Submission 或 Audit Event 时再次防御性规范化为 SQL `NULL`。

数据库不保存 `unscoped`、`unknown`、`default` 或 `No session recorded` 等哨兵字符串。

### 5.4 Session 解析优先级

CLI 按以下顺序解析 Session，取第一个非空值：

1. 当前命令的 `--session <id>`。
2. `THREADLINE_SESSION_ID`。
3. 当前 harness adapter 暴露的原生 ID。
4. 用户显式持久化的 legacy attached session。
5. 空值，进入 `unscoped`。

规则：

- Integration adapter 不得写入全局 attached session。
- Attached session 仅作为手工兼容能力，优先级低于当前进程的原生 ID。
- 当 attached session 被使用时，CLI 应在非 JSON 输出中提示它是持久化 fallback，不适合并发 harness。
- `--dry-run` 不调用 Gateway，不创建或持久化任何 Session 状态。

## 6. Integration Adapter

### 6.1 通用契约

Adapter 是安装到 harness 配置或插件系统中的薄层，不修改 harness 本体。

Adapter 应满足：

- 从 harness 官方上下文读取原生会话 ID。
- 在当前 Agent 执行 Threadline CLI 时提供 `THREADLINE_SESSION_ID`。
- 提供规范化的 `THREADLINE_TOOL`。
- 不读取、复制、打印或持久化 `THREADLINE_TOKEN`。
- 不创建 Threadline Session ID。
- 缺少原生 ID 时保持变量未设置，让 CLI 使用 `unscoped`。
- 安装操作幂等；重复安装不得产生重复 hook 或 plugin 配置。
- 删除操作只移除 Threadline 自己管理的配置，不覆盖用户的其他 hook/plugin。

建议 CLI：

```text
threadline integration install <codex|claude-code|opencode|openclaw>
threadline integration status [harness]
threadline integration remove <harness>
```

所有修改配置的命令支持 `--dry-run`。安装前显示目标文件和将要增加的配置；无法安全合并时停止并给出错误，不整体重写用户配置。

### 6.2 Codex

数据来源：

- 当前 Codex 进程继承给命令的 `CODEX_THREAD_ID`。
- 为兼容旧环境，可继续读取 `CODEX_SESSION_ID`，但它不是首选名称。
- Codex 官方 hook JSON 中的 `session_id` 可作为后续稳定 transport；本阶段不依赖解析 transcript 文件。

CLI 解析：

```text
THREADLINE_SESSION_ID > CODEX_THREAD_ID > CODEX_SESSION_ID
```

`THREADLINE_TOOL` 缺失且检测到 Codex 原生变量时，自动使用 `codex`。

`integration install codex` 的首期职责是检查可用变量、安装或更新 Threadline Skill，并报告当前 Codex 版本是否能自动传递 ID。检测失败不阻止 Agent 使用 `unscoped`。

### 6.3 Claude Code

Claude Code command hook 通过 stdin JSON 提供 `session_id`。`SessionStart` hook 可通过 `CLAUDE_ENV_FILE` 为后续 Bash 命令持久化当前会话变量。

Adapter 行为：

1. 安装一个由 Threadline 管理的 `SessionStart` command hook。
2. Hook 读取 stdin JSON 的 `session_id`。
3. 向 `CLAUDE_ENV_FILE` 追加安全转义后的：

```text
THREADLINE_SESSION_ID=<session_id>
THREADLINE_TOOL=claude-code
```

4. Hook 覆盖新建、resume、clear 和 compact 后触发的 SessionStart，以刷新当前值。
5. Hook 失败时不得阻止 Claude Code 启动；Threadline 提交退化到 `unscoped`。

禁止把 transcript 文件名或当前目录当作 Session ID。

### 6.4 OpenCode

OpenCode custom tool 和 plugin hook context 提供 `sessionID`。Adapter 使用 plugin 的 `shell.env` hook：

```typescript
"shell.env": async (input, output) => {
  if (input.sessionID) {
    output.env.THREADLINE_SESSION_ID = input.sessionID;
  }
  output.env.THREADLINE_TOOL = "opencode";
}
```

要求：

- 只在 `input.sessionID` 存在时设置 Session。
- 对用户手动打开、没有 session context 的 terminal 不设置 Session。
- 并发 OpenCode 会话分别收到自己的 `sessionID`，不得使用全局缓存。

### 6.5 OpenClaw

OpenClaw internal hook 事件都携带 `sessionKey`；typed plugin context 可提供 `ctx.sessionKey` 和 `ctx.sessionId`。两者语义不同：

- `sessionKey` 是路由键，可能在 `/new`、`/reset` 或定时 reset 后继续复用。
- `sessionId` 是 OpenClaw 当前原生会话 ID，reset 后变化。

Threadline 必须使用 `ctx.sessionId` 作为 `session_id`，不得用 `sessionKey` 替代。

Adapter 使用 OpenClaw typed plugin 的 `resolve_exec_env`：

```typescript
api.on("resolve_exec_env", (_event, ctx) => ({
  ...(ctx.sessionId ? { THREADLINE_SESSION_ID: ctx.sessionId } : {}),
  THREADLINE_TOOL: "openclaw",
}));
```

要求：

- Plugin 安装在 OpenClaw Gateway，不修改 Agent workspace 的构建方式。
- `sessionId` 缺失时退化到 `unscoped`，不使用 `sessionKey` 猜测。
- OpenClaw 调用 Codex、Claude Code 或 ACP Agent 时，Tool 仍为 `openclaw`；底层实现可记录在 `runtime`。
- OpenClaw 子会话若拥有独立 `sessionId`，按其原生语义形成独立 timeline。

## 7. Protocol、Store 与 API

### 7.1 Protocol

- `ActorContext.session_id` 继续为 optional/nullable string。
- 非空值沿用当前最大长度限制。
- 不增加 Session resource schema。
- 空白字符串可通过边界校验进入兼容流程，但必须在 Store 写入前规范化为 `NULL`。

### 7.2 Store

Submission 和 Audit Event 写入共享同一个 session 规范化函数。

建议增加幂等 migration：

```sql
UPDATE submissions
SET session_id = NULL
WHERE session_id IS NOT NULL AND trim(session_id) = '';

UPDATE audit_events
SET session_id = NULL
WHERE session_id IS NOT NULL AND trim(session_id) = '';
```

不增加外键、唯一索引或 Session 表。现有 `(host, tool, session_id, created_at)` 查询索引保留。

### 7.3 API

- Submission 创建继续允许 `session_id` 缺失或为 `null`。
- 空字符串和纯空白最终以响应中的 `session_id: null` 返回。
- 现有 `host`、`tool`、`session_id` 筛选保持兼容。
- 本阶段不新增 unscoped 专用查询参数；Agent 页面基于已加载 records 在前端聚合。

## 8. Agent 页面

### 8.1 信息结构

左侧树保持三级结构：

```text
Host
  Tool
    Native Session
    Unscoped
```

Host、Tool 和 Session 都是可选择的 timeline scope：

- 选择 Host：显示该 Host 下全部 Tool、Native Session 和 Unscoped records。
- 选择 Tool：显示该 Host/Tool 下全部 Native Session 和 Unscoped records。
- 选择 Native Session：显示完全匹配该 Host/Tool/Session ID 的 records。
- 选择 Unscoped：显示该 Host/Tool 下 `session_id == null` 的 records。

所有层级按 `created_at` 降序展示，稳定次排序使用 record ID，避免相同时间导致列表跳动。

### 8.2 树交互

- Host/Tool 行的展开按钮与选择动作分离。
- Chevron 只控制展开/收起；名称或行主体选择 timeline scope。
- 当前选中层级有明确 active 状态。
- 节点显示其 scope 下的 record count。
- Unscoped 使用本地化展示名称，英文默认为 `No session recorded`。
- 长 Host、Tool 和 Session ID 必须截断显示并提供完整值 tooltip/copy action。

### 8.3 详情头部

详情区域根据 scope 显示：

| Scope | 标题 | 辅助信息 |
| --- | --- | --- |
| Host | Host 名称 | Tool 数、Session 数、record 数 |
| Tool | Tool 名称 | Host、Session 数、record 数 |
| Native Session | Session ID | Host、Tool、record 数 |
| Unscoped | `No session recorded` | Host、Tool、record 数 |

Host/Tool 聚合 timeline 不引入额外卡片层级，复用现有 timeline row。

### 8.4 路由

采用带 scope 类型的路由，避免把展示哨兵与真实 Session ID 混淆：

```text
#agents/host/<encoded-host>
#agents/tool/<encoded-host>/<encoded-tool>
#agents/session/<encoded-host>/<encoded-tool>/<encoded-session-id>
#agents/unscoped/<encoded-host>/<encoded-tool>
```

要求：

- 所有动态段使用 `encodeURIComponent`/安全 decode。
- malformed percent encoding 不得导致页面崩溃，应回退到 Agents 根页面。
- 现有 legacy 三段 Session URL 在一个兼容周期内继续解析，并导航到相同 scope。
- 当 URL 指向不存在的 scope 时显示空状态，不自动选择其他 Session。

## 9. Skill 与文档行为

`skills/threadline-gateway/` 必须更新：

- 不再要求 Agent 必须提供非空 Session ID。
- 明确禁止 Agent 自行生成、猜测或按时间创建 Session ID。
- 有 `THREADLINE_SESSION_ID` 时原样使用。
- 无 ID 时正常提交，让记录进入 `unscoped`。
- 不把缺少 Session 视为 delivery/decision 提交的阻塞条件。
- 文档解释 `threadline integration` 是增强归属精度的可选安装步骤，不是使用 Gateway 的前置条件。

README 和 CLI reference 应列出四个支持的 adapter、安装命令、降级行为和 precedence。

## 10. 兼容与迁移

### 10.1 旧数据

- 已有非空 Session ID 原样保留。
- 已有 `NULL` Session 自动显示在对应 Host/Tool 的 Unscoped timeline。
- 已有空字符串或纯空白通过 migration 归一化为 `NULL`。
- 不尝试识别旧 ID 是否来自 harness，也不重命名。

### 10.2 旧客户端

- 未传 `session_id` 的旧客户端继续成功。
- 传任意非空字符串的旧客户端继续成功。
- API 响应 schema 不移除或重命名字段。
- Legacy attached session 暂时保留，但不由任何 adapter 写入。

### 10.3 渐进适配

同一 Agent 在安装 adapter 前后的记录允许自然分开：

```text
安装前 -> unscoped
安装后 -> native session timeline
```

系统不自动合并两者。未来若需要归并，应设计显式、可审计的独立功能。

## 11. 安全与可靠性

- Native Session ID 是关联标识，不当作认证凭据。
- Session ID 不得出现在 Token 配置、日志脱敏例外或 shell command 拼接中。
- Adapter 写配置时必须安全转义 ID 和路径。
- Integration install/remove 应使用原子文件替换或目标平台提供的结构化配置 API。
- 不解析 transcript 内容获取 ID；transcript 格式不是稳定接口，也可能包含敏感内容。
- Adapter 失败不得阻断 harness 启动或 Threadline unscoped 提交。
- Integration status 不输出 Threadline Token 或完整私有配置。

## 12. 测试要求

### 12.1 CLI

- `--session` 覆盖所有环境变量。
- `THREADLINE_SESSION_ID` 覆盖 harness 原生变量。
- Codex 使用 `CODEX_THREAD_ID`，并兼容 `CODEX_SESSION_ID`。
- 空字符串和纯空白解析为 absent。
- 无 Session 时提交成功且发送空值。
- 原生 ID 优先于 persisted attached session。
- `--dry-run` 不访问 Gateway、不修改 integration 配置。

### 12.2 Store/API

- `undefined`、`null`、空字符串和纯空白最终存为 SQL `NULL`。
- 非空原生 ID 原样 round-trip。
- Migration 将历史 blank 值归一化且可重复执行。
- Host/Tool/Session 现有 filters 不回归。
- Submission 和 Audit Event 的 session 规范化一致。

### 12.3 Adapter

- 每个 adapter 使用官方 payload fixture 测试 ID 提取。
- 重复 install 不生成重复配置。
- remove 仅删除 Threadline 管理的配置。
- 同一 Host 上两个相同 harness 并发会话得到不同环境 ID。
- 缺少 ID 时 adapter 不写伪造值。
- 配置文件 malformed 时 install 安全失败并保持原文件不变。

### 12.4 Web

- 相同 Host/Tool 的空 Session 合并为一个 Unscoped 节点。
- 不同 Host 或 Tool 的 Unscoped 节点隔离。
- Host scope 包含全部后代 records。
- Tool scope 包含全部 Session 与 Unscoped records。
- Native Session 与 Unscoped scope 精确过滤。
- 所有 timeline 降序稳定排列。
- 四种 typed route 均能 round-trip。
- Legacy route 兼容。
- malformed route 不导致 render crash。
- Host/Tool 的展开和选择动作互不干扰。

## 13. 验收标准

1. 未安装任何 adapter 的 Agent 可以用空 Session 成功提交，记录出现在正确 Host/Tool 的 Unscoped timeline。
2. Codex、Claude Code、OpenCode 和 OpenClaw 安装对应 adapter 后，提交自动携带当前 harness 的原生 ID。
3. 同一主机上并发运行两个相同 harness 会话时，具备原生 ID 的记录不会串线。
4. Threadline 不创建、映射或维护第二层 Session UUID。
5. Host、Tool、Native Session 和 Unscoped 四种 scope 均可选择并直接通过 URL 访问。
6. Host/Tool 聚合数量与 timeline records 精确匹配，排序稳定。
7. 旧的 NULL、非空 Session 和 legacy URL 继续可用。
8. Skill 不再要求 Agent 发明 Session ID，也不会因为缺少 ID 阻塞有价值的提交。
9. Adapter 安装、状态检查和移除均幂等，不破坏用户已有 harness 配置。
10. Protocol、Store、API、CLI、adapter 和 Web 的上述关键行为都有自动化测试。

## 14. 建议实施顺序

### 阶段 A：身份语义和页面

- 统一 blank-to-null 规范化。
- 将前端 Session identity 改为 native/unscoped 判别类型。
- 增加 Host/Tool/Unscoped selection、聚合 timeline 和 typed routes。
- 更新 Skill 对空 Session 的规则。

### 阶段 B：原生 ID 采集

- CLI 支持 Codex `CODEX_THREAD_ID`。
- 实现 integration 命令与共享安装框架。
- 实现 Claude Code、OpenCode、OpenClaw adapter。
- 增加 integration status 与安全 remove。

### 阶段 C：兼容验证

- 执行 blank 数据 migration。
- 验证 legacy attached session 与 legacy URL。
- 在每种 harness 中完成一个新会话、resume 和并发会话的真实 smoke test。

## 15. 参考

- Codex Hooks: <https://developers.openai.com/codex/hooks>
- Claude Code Hooks: <https://code.claude.com/docs/en/hooks>
- OpenCode Custom Tools: <https://opencode.ai/docs/custom-tools/>
- OpenCode Plugins: <https://opencode.ai/docs/plugins/>
- OpenClaw Hooks: <https://docs.openclaw.ai/automation/hooks>
- OpenClaw Plugin Hooks: <https://docs.openclaw.ai/plugins/hooks>
- OpenClaw Session Management: <https://docs.openclaw.ai/concepts/session.md>
