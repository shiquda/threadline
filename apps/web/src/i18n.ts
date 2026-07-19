import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export const supportedLocales = ["en", "zh-CN"] as const;
export type Locale = typeof supportedLocales[number];
type Values = Record<string, string | number>;

const storageKey = "threadline.locale";

const zhCN: Record<string, string> = {
  "Overview": "概览",
  "Inbox": "收件箱",
  "Workboard": "工作看板",
  "Decisions": "决策",
  "Initiative detail": "项目详情",
  "Decision detail": "决策详情",
  "Submission detail": "提交详情",
  "Open menu": "打开菜单",
  "Primary navigation": "主导航",
  "New initiative": "新建项目",
  "Gateway connection": "网关连接",
  "You": "你",
  "Language": "语言",
  "Switch to English": "切换为英语",
  "Switch to Chinese": "切换为中文",
  "Shared work context for humans and agents.": "面向人类与智能体的共享工作上下文。",
  "Human-Agent Gateway workbench - your shared source of attention and decisions.": "人机协作网关工作台，集中管理关注事项和决策。",
  "Loading workspace": "正在加载工作区",
  "Fetching the current work context.": "正在获取当前工作上下文。",
  "Could not load workspace": "无法加载工作区",
  "Try again": "重试",
  "Active notifications": "活动通知",
  "Workspace summary": "工作区摘要",
  "Running initiatives": "进行中的项目",
  "Open decisions": "待处理决策",
  "{count} need attention": "{count} 项需要关注",
  "{count} on the Workboard": "看板上有 {count} 项",
  "{count} waiting to close": "{count} 项等待处理",
  "Needs attention": "需要关注",
  "Open Inbox": "打开收件箱",
  "Inbox is clear": "收件箱已清空",
  "New decisions, deliveries, and alerts will appear here.": "新的决策、交付和提醒会显示在这里。",
  "Copy session ID": "复制会话 ID",
  "Copied": "已复制",
  "Only things that need your attention right now.": "仅显示当前需要你关注的事项。",
  "Mark all read": "全部标为已读",
  "Search runtime, agent, session...": "搜索运行时、智能体、会话...",
  "Search inbox": "搜索收件箱",
  "All": "全部",
  "Decision": "决策",
  "Delivery": "交付",
  "Alert": "提醒",
  "Loading Inbox": "正在加载收件箱",
  "Fetching current notifications.": "正在获取当前通知。",
  "Could not load Inbox": "无法加载收件箱",
  "No matching notifications": "没有匹配的通知",
  "Try a different search or filter.": "请尝试其他搜索词或筛选条件。",
  "New attention-worthy work will appear here.": "需要关注的新工作会显示在这里。",
  "decision needed": "需要决策",
  "Runtime": "运行时",
  "Agent": "智能体",
  "Initiative": "项目",
  "Mark read": "标为已读",
  "Snooze one day": "稍后一天",
  "Archive": "归档",
  "Decide": "决策",
  "View": "查看",
  "Running initiatives grouped by who they are waiting on.": "按当前等待对象分组显示进行中的项目。",
  "In progress": "进行中",
  "Waiting for you": "等待你处理",
  "Waiting for Agent": "等待智能体",
  "Paused / done": "已暂停 / 已完成",
  "Loading Workboard": "正在加载工作看板",
  "Fetching current initiative states.": "正在获取当前项目状态。",
  "Could not load Workboard": "无法加载工作看板",
  "No initiatives": "没有项目",
  "Intent": "目标",
  "Next": "下一步",
  "No next step recorded": "未记录下一步",
  "Decision Registry": "决策登记册",
  "Open and closed decisions with risk, source session, and resolution.": "查看决策的风险、来源会话与处理结果。",
  "Loading decisions": "正在加载决策",
  "Fetching the registry.": "正在获取登记册。",
  "Could not load decisions": "无法加载决策",
  "No decisions here": "没有决策",
  "There are no decisions waiting to close.": "没有等待处理的决策。",
  "Decisions created by Agents will appear here.": "智能体创建的决策会显示在这里。",
  "Question": "问题",
  "Options": "选项",
  "Risk": "风险",
  "Status": "状态",
  "Loading initiative": "正在加载项目",
  "Fetching related work context.": "正在获取相关工作上下文。",
  "Could not load initiative": "无法加载项目",
  "Back to Workboard": "返回工作看板",
  "Next step": "下一步",
  "Submissions": "提交记录",
  "No submissions are linked yet.": "尚未关联提交记录。",
  "Awaiting a decision": "等待决策",
  "No decisions are linked yet.": "尚未关联决策。",
  "Activity": "活动",
  "Properties": "属性",
  "ID": "ID",
  "Created by": "创建者",
  "Last activity": "最后活动",
  "Created": "创建时间",
  "Loading decision": "正在加载决策",
  "Fetching the decision and its audit trail.": "正在获取决策及其审计记录。",
  "Could not load decision": "无法加载决策",
  "Back to registry": "返回登记册",
  "{status} risk": "{status}风险",
  "No preset options were provided.": "未提供预设选项。",
  "Close decision": "结束决策",
  "Outcome": "结果",
  "Record the decision and the reason for it.": "记录决策及其原因。",
  "Closing this writes the same semantic event an Agent would produce via the CLI. The linked Inbox item will disappear.": "关闭后会写入与智能体 CLI 相同的语义事件，关联的收件箱项目将消失。",
  "Resolving...": "正在处理...",
  "Resolution": "处理结果",
  "Resolved by {name} via {via} · {date}": "由 {name} 通过 {via} 处理 · {date}",
  "Audit trail": "审计记录",
  "Session": "会话",
  "Loading submission": "正在加载提交记录",
  "Fetching the submitted work.": "正在获取已提交的工作。",
  "Could not load submission": "无法加载提交记录",
  "Back to Inbox": "返回收件箱",
  "Summary": "摘要",
  "Details": "详情",
  "No additional detail was provided.": "未提供其他详情。",
  "Reference": "参考",
  "Open submitted reference": "打开提交的参考链接",
  "Kind": "类型",
  "Attention": "关注策略",
  "Source": "来源",
  "Observed": "已观察",
  "No activity has been recorded yet.": "尚未记录活动。",
  "Gateway URL": "网关 URL",
  "Instance token": "实例令牌",
  "Bearer token": "Bearer 令牌",
  "Stored only in this browser on this device.": "仅存储在此设备的浏览器中。",
  "Cancel": "取消",
  "Save connection": "保存连接",
  "Title": "标题",
  "Creating...": "正在创建...",
  "Create initiative": "创建项目",
  "Close": "关闭",
  "Something went wrong.": "发生错误。",
  "Gateway returned {status}.": "网关返回了 {status}。",
  "Could not reach {url}. Check the Gateway URL.": "无法连接到 {url}。请检查网关 URL。",
  "just now": "刚刚",
  "{count} min ago": "{count} 分钟前",
  "{count} h ago": "{count} 小时前",
  "Active": "活动中",
  "Waiting for agent": "等待智能体",
  "Paused": "已暂停",
  "Completed": "已完成",
  "Cancelled": "已取消",
  "Open": "待处理",
  "Seen": "已查看",
  "Resolved": "已解决",
  "Expired": "已过期",
  "Superseded": "已替代",
  "Low": "低",
  "Medium": "中",
  "High": "高",
  "Recommendation": "建议",
  "Decision request": "决策请求",
  "Digest": "摘要汇总",
  "Progress update": "进度更新",
  "Interrupt": "立即提醒",
  "Record only": "仅记录",
  "Read": "已读",
  "Snoozed": "已延后",
  "Archived": "已归档",
  "initiative created": "项目已创建",
  "initiative updated": "项目已更新",
  "submission created": "提交记录已创建",
  "decision created": "决策已创建",
  "decision resolved": "决策已解决",
  "notification updated": "通知已更新",
};

const zhCNCaseInsensitive = Object.fromEntries(Object.entries(zhCN).map(([key, value]) => [key.toLowerCase(), value]));

export function resolveLocale(value: string | null | undefined): Locale | null {
  if (value === "en" || value === "zh-CN") return value;
  return null;
}

export function detectLocale(languages: readonly string[] = []): Locale {
  return languages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh-CN" : "en";
}

function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readLocale(): Locale {
  const saved = resolveLocale(getStorage()?.getItem(storageKey));
  if (saved) return saved;
  return typeof navigator === "undefined" ? "en" : detectLocale(navigator.languages);
}

export function writeLocale(locale: Locale): void {
  try {
    getStorage()?.setItem(storageKey, locale);
  } catch {
    // The page remains usable when browser storage is unavailable.
  }
}

export function translate(locale: Locale, source: string, values: Values = {}): string {
  const template = locale === "zh-CN" ? zhCN[source] ?? zhCNCaseInsensitive[source.toLowerCase()] ?? source : source;
  return template.replace(/\{(\w+)\}/g, (token, key: string) => values[key] === undefined ? token : String(values[key]));
}

export function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatDate(locale: Locale, value: string | null, now = Date.now()): string {
  if (!value) return "-";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "-";
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return translate(locale, "just now");
  if (minutes < 60) return translate(locale, "{count} min ago", { count: minutes });
  if (minutes < 1440) return translate(locale, "{count} h ago", { count: Math.floor(minutes / 60) });
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

type I18n = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (source: string, values?: Values) => string;
};

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readLocale);
  const setLocale = useCallback((next: Locale) => {
    writeLocale(next);
    setLocaleState(next);
  }, []);
  const t = useCallback((source: string, values?: Values) => translate(locale, source, values), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
