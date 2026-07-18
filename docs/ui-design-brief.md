# Threadline Web UI 设计 brief

以下内容可直接交给负责 UI/UX 的设计 Agent。

---

请为一个名为 **Threadline** 的自托管 Web 工具设计响应式操作界面，并产出可供工程实现的高保真方案或交互原型。

Threadline 是一个 Human-Agent Gateway。它不是聊天软件、Todo 工具或 Agent 运行监控平台，而是一个让单个用户与多个 Agent 共享工作事实、注意力和决定的工作台。目标用户会频繁扫描信息、定位 Agent session、查看事项为何开始，并确认某个决定是否已经闭环。

## 产品板块

### 1. Inbox

- 展示当前真正需要用户关注的内容，而不是完整时间线。
- 内容类型包括交付、建议、决策请求、风险提醒和摘要。
- 每项需要突出一句结论、需要采取的动作、关联事项、Agent/runtime 名称和 session ID。
- 支持已读、稍后处理、归档和进入详情。

### 2. Workboard

- 展示持续推进的“事项”。
- 建议按进行中、等待 Jim、等待 Agent、暂停/完成分组。
- 每项展示原始意图、当前状态、最后活动、正在等谁和下一步。
- 重点是快速扫描 3–4 个 Agent 并行工作的整体情况，不要做成传统任务看板。

### 3. Decision Registry

- 集中查看待决定和已关闭的 Decision。
- 显示问题、可选方案、风险等级、来源 Agent/session、当前状态和最终结果。
- 用户可以进入详情，并在 Web 中直接关闭尚未完成的 Decision。

### 4. 事项与内容详情

- 事项详情展示意图、状态、下一步，以及关联的 Submission、Decision 和状态事件。
- Submission 详情展示完整内容、来源、注意力策略和关联对象。
- 需要提供创建/编辑事项与提交标准内容的基础表单。

## 核心交互场景

1. Agent 从某个 session 发起 Decision，用户在 Inbox 看到 Agent/runtime、session ID 和摘要。
2. 用户自行切换到该 Agent session 告知决定；Decision 随后由 Agent 关闭，Inbox 中对应项目自动消失。
3. 用户从 Workboard 快速判断每个事项为什么存在、当前在等谁、下一步是什么。
4. 用户在 Decision Registry 查看已关闭决定的结果和来源记录。

## 设计方向

- 这是面向高频工作的安静、克制、信息密度适中的操作工具，不是营销网站。
- 第一屏直接进入产品，不要 landing page、hero、宣传文案或装饰性数据图表。
- 优先支持桌面端，同时保证窄屏可用。
- 信息层级、状态可读性和扫描效率高于装饰性。
- 不使用大面积渐变、漂浮卡片、过度圆角、嵌套卡片或无意义图标。
- 为紧急、等待决定、普通信息、已关闭和被抑制建立明确但克制的语义视觉。
- 图标优先使用 Lucide 等成熟图标库；图标按钮应提供 tooltip。
- 覆盖 loading、empty、error、hover、focus、disabled 和内容较长等关键状态。
- 文案以英文产品界面为主，但结构应允许未来本地化。

## 期望交付

- 简洁的信息架构与导航方案。
- Inbox、Workboard、Decision Registry、事项详情和 Decision 详情的关键桌面页面。
- 至少补充 Inbox 或 Workboard 的窄屏方案。
- 主要组件及状态说明。
- 一套明确的颜色、字体、间距、圆角和交互反馈规则。
- 用真实业务语义的示例内容展示布局，不使用无意义占位数据。
- 说明最重要的设计取舍，便于工程 Agent 准确实现。

不要设计 Telegram、聊天界面、Agent 在线状态、运行日志、Runtime 控制台或多用户权限管理。

---

