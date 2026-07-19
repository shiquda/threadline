import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive, Check, ChevronRight, ClipboardList, Clock3, Copy, Inbox,
  LayoutDashboard, Menu, Network, Plus, RefreshCw, Scale, Settings2, X,
} from "lucide-react";
import type { AuditEvent, Decision, InboxItem, Initiative, InitiativeStatus, Submission, Task, Workboard } from "@threadline/protocol";
import { ThreadlineApi, readConnection, writeConnection, type Connection } from "./api.js";
import { formatDate, formatExactDate, humanize, I18nProvider, supportedLocales, useI18n, type Locale } from "./i18n.js";
import { initiativeRecord, normalizeWorkboard, type InitiativeRecord } from "./workboard.js";
import {
  groupSubmissionsByIdentity,
  makeAgentsSessionRoute,
  parseAgentsSessionRoute,
  selectedSessionRecords,
  UNKNOWN_HOST,
  UNKNOWN_SESSION,
  UNKNOWN_TOOL,
} from "./agents.js";
import "./styles.css";

type Page = "overview" | "inbox" | "workboard" | "decisions" | "agents" | "initiative" | "decision" | "submission" | "task";
type Route = { page: Page; id?: string };
type LoadState<T> = { value: T | null; loading: boolean; error: string | null; refreshing: boolean; refreshError: string | null };
type LoadResult<T> = LoadState<T> & { reload: () => void; mutate: (updater: (value: T) => T) => void };
type Translate = ReturnType<typeof useI18n>["t"];

function routeFromHash(): Route {
  const [page, ...rest] = window.location.hash.replace(/^#\/?/, "").split("/");
  if (page === "initiative" && rest[0]) return { page: "initiative", id: rest[0] };
  if (page === "decision" && rest[0]) return { page: "decision", id: rest[0] };
  if (page === "submission" && rest[0]) return { page: "submission", id: rest[0] };
  if (page === "task" && rest[0]) return { page: "task", id: rest[0] };
  if (page === "agents" && rest.length === 3) {
    return { page: "agents", id: rest.join("/") };
  }
  if (page && ["inbox", "workboard", "decisions", "agents"].includes(page)) return { page: page as Page };
  return { page: "overview" };
}

function navigate(route: string): void { window.location.hash = route; }

type CacheEntry = { value: unknown; at: number };
const loadCache = new WeakMap<ThreadlineApi, Map<string, CacheEntry>>();

function cacheKey(name: string, restKeys: unknown[]): string {
  return `${name}:${restKeys.map((key) => (key === null || key === undefined ? "" : String(key))).join(":")}`;
}

function readCache<T>(api: ThreadlineApi, name: string, restKeys: unknown[]): T | undefined {
  const namespace = loadCache.get(api);
  if (!namespace) return undefined;
  const entry = namespace.get(cacheKey(name, restKeys)) as CacheEntry | undefined;
  return entry ? (entry.value as T) : undefined;
}

function writeCache<T>(api: ThreadlineApi, name: string, restKeys: unknown[], value: T): void {
  let namespace = loadCache.get(api);
  if (!namespace) {
    namespace = new Map<string, CacheEntry>();
    loadCache.set(api, namespace);
  }
  namespace.set(cacheKey(name, restKeys), { value, at: Date.now() });
}

function useLoad<T>(name: string, load: (signal: AbortSignal) => Promise<T>, keys: unknown[]): LoadResult<T> {
  const api = keys[0] as ThreadlineApi;
  const restKeys = keys.slice(1);
  const loadRef = useRef(load);
  loadRef.current = load;
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const [state, setState] = useState<LoadState<T>>(() => {
    const cached = readCache<T>(api, name, restKeys);
    return { value: cached ?? null, loading: cached === undefined, error: null, refreshing: cached !== undefined, refreshError: null };
  });

  const stableKey = useMemo(() => cacheKey(name, restKeys), [name, ...restKeys]);

  const runRequest = useCallback((isReload: boolean) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    const cached = readCache<T>(api, name, restKeys);

    const apply = (updater: (last: LoadState<T>) => LoadState<T>) => {
      setState((last) => (generation === generationRef.current ? updater(last) : last));
    };

    if (!isReload) {
      setState((last) => ({
        ...last,
        value: cached ?? null,
        loading: cached === undefined,
        error: null,
        refreshing: cached !== undefined,
        refreshError: null,
      }));
    } else {
      setState((last) => ({ ...last, refreshing: last.value !== null, refreshError: null }));
    }

    loadRef.current(controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      writeCache(api, name, restKeys, value);
      apply(() => ({ value, loading: false, error: null, refreshing: false, refreshError: null }));
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const message = error instanceof Error ? error.message : "Something went wrong.";
      apply((last) => ({
        ...last,
        loading: last.value === null,
        error: last.value === null ? message : null,
        refreshing: false,
        refreshError: last.value !== null ? message : null,
      }));
    }).finally(() => {
      if (controllerRef.current === controller) controllerRef.current = null;
    });
  }, [api, name, stableKey]);

  useEffect(() => {
    runRequest(false);
    return () => { controllerRef.current?.abort(); controllerRef.current = null; };
  }, [runRequest]);

  const reload = useCallback(() => { runRequest(true); }, [runRequest]);

  const mutate = useCallback((updater: (value: T) => T) => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    ++generationRef.current;
    setState((last) => {
      if (last.value === null) return last;
      const next = updater(last.value);
      writeCache(api, name, restKeys, next);
      return { ...last, value: next, refreshing: false, refreshError: null };
    });
  }, [api, name, ...restKeys]);

  return { ...state, reload, mutate };
}

function localizedValue(t: Translate, value: string): string { return t(humanize(value)); }
function displayStatus(t: Translate, value: string): string { return value === "waiting_for_jim" ? t("Waiting for you") : localizedValue(t, value); }
function localizedError(t: Translate, error: string): string {
  const gatewayError = /^Gateway returned (\d+)\.$/.exec(error);
  if (gatewayError) return t("Gateway returned {status}.", { status: gatewayError[1] ?? "" });
  const connectionError = /^Could not reach (.+)\. Check the Gateway URL\.$/.exec(error);
  if (connectionError) return t("Could not reach {url}. Check the Gateway URL.", { url: connectionError[1] ?? "" });
  return t(error);
}

function badgeClass(value: string): string {
  if (["high", "interrupt", "alert"].includes(value)) return "urgent";
  if (["medium", "waiting_for_jim", "open"].includes(value)) return "warn";
  if (["resolved", "completed", "active"].includes(value)) return "success";
  if (["decision_request", "decision"].includes(value)) return "decision";
  return "info";
}

function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${badgeClass(tone ?? String(children))}`}>{children}</span>;
}

function StateBox({ title, children, retry }: { title: string; children: ReactNode; retry?: () => void }) {
  const { t } = useI18n();
  return <div className="state-box"><Network aria-hidden="true" /><div><div className="state-title">{title}</div><p>{children}</p></div>{retry && <button className="btn btn-secondary btn-sm" onClick={retry}><RefreshCw size={15} />{t("Try again")}</button>}</div>;
}

function SkeletonBlock({ className, width, height }: { className?: string; width?: string; height?: string }) {
  return <span className={`skeleton ${className ?? ""}`} aria-hidden="true" style={{ width, height }} />;
}

function SkeletonMetrics() {
  return <div className="overview-metrics" aria-label="loading">{[1, 2, 3].map((index) => <div className="metric skeleton-metric" key={index}><SkeletonBlock width="40%" height="16px" /><SkeletonBlock width="55%" height="22px" /></div>)}</div>;
}

function SkeletonMiniList() {
  return <div className="mini-list" aria-label="loading">{[1, 2, 3].map((index) => <div className="mini-inbox skeleton-row" key={index}><SkeletonBlock width="76px" height="20px" /><div className="skeleton-stack"><SkeletonBlock width="60%" height="16px" /><SkeletonBlock width="40%" height="13px" /></div></div>)}</div>;
}

function OverviewSkeleton() {
  return <>
    <SkeletonMetrics />
    <section className="overview-section"><div className="section-heading"><h2><SkeletonBlock width="140px" height="20px" /></h2></div><SkeletonMiniList /></section>
  </>;
}

function InboxSkeleton() {
  return <div className="inbox-list" aria-label="loading">{[1, 2, 3, 4].map((index) => <div className="inbox-item skeleton-row" key={index}><SkeletonBlock width="68px" height="20px" /><div className="skeleton-stack"><SkeletonBlock width="55%" height="16px" /><SkeletonBlock width="80%" height="13px" /><SkeletonBlock width="45%" height="12px" /></div><div className="item-actions skeleton-actions"><SkeletonBlock width="28px" height="28px" /><SkeletonBlock width="28px" height="28px" /><SkeletonBlock width="28px" height="28px" /></div></div>)}</div>;
}

function WorkboardSkeleton() {
  return <div className="board" aria-label="loading">{[1, 2, 3, 4].map((index) => <section className="lane" key={index}><header className="lane-header"><SkeletonBlock width="100px" height="13px" /><SkeletonBlock width="24px" height="18px" /></header><div className="lane-body">{[1, 2].map((card) => <div className="work-card skeleton-card" key={card}><SkeletonBlock width="70%" height="16px" /><div className="skeleton-stack"><SkeletonBlock width="90%" height="13px" /><SkeletonBlock width="60%" height="13px" /></div><div className="skeleton-footer"><SkeletonBlock width="80px" height="20px" /><SkeletonBlock width="80px" height="12px" /></div></div>)}</div></section>)}</div>;
}

function DecisionsSkeleton() {
  return <div className="table-wrap" aria-label="loading"><table className="data-table"><thead><tr>{["Question", "Options", "Risk", "Initiative", "Status", ""].map((label, index) => <th key={index}><SkeletonBlock width={label ? `${Math.max(40, label.length * 8)}px` : "28px"} height="11px" /></th>)}</tr></thead><tbody>{[1, 2, 3, 4].map((row) => <tr key={row}><td><SkeletonBlock width="85%" height="15px" /></td><td><SkeletonBlock width="70%" height="13px" /></td><td><SkeletonBlock width="60px" height="20px" /></td><td><SkeletonBlock width="60%" height="13px" /></td><td><SkeletonBlock width="70px" height="20px" /></td><td><SkeletonBlock width="56px" height="26px" /></td></tr>)}</tbody></table></div>;
}

function DetailSkeleton() {
  return <div className="detail-grid" aria-label="loading"><section className="panel"><div className="panel-body">{[1, 2, 3, 4].map((section) => <div className="panel-section skeleton-section" key={section}><h2><SkeletonBlock width="100px" height="12px" /></h2><SkeletonBlock width="100%" height="14px" /><SkeletonBlock width="92%" height="14px" /><SkeletonBlock width="60%" height="14px" /></div>)}</div></section><aside className="panel"><div className="panel-header"><h2><SkeletonBlock width="90px" height="18px" /></h2></div><div className="panel-body">{[1, 2, 3, 4, 5, 6].map((row) => <div className="skeleton-property" key={row}><SkeletonBlock width="80px" height="13px" /><SkeletonBlock width="65%" height="14px" /></div>)}</div></aside></div>;
}

function RefreshIndicator({ refreshing, error, retry }: { refreshing: boolean; error: string | null; retry?: () => void }) {
  const { t } = useI18n();
  if (!refreshing && !error) return null;
  return <div className="refresh-indicator" role="status" aria-live="polite">
    {refreshing && <span className="refresh-spin"><RefreshCw size={14} /></span>}
    {refreshing && <span>{t("Refreshing")}</span>}
    {!refreshing && error && <span className="refresh-error">{localizedError(t, error)}</span>}
    {!refreshing && error && retry && <button className="btn btn-ghost btn-sm" onClick={retry}>{t("Retry")}</button>}
  </div>;
}

function CopyValue({ value }: { value: string | null }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  if (!value) return <span>-</span>;
  return <button className="copy-value" title={t("Copy session ID")} onClick={() => void navigator.clipboard.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1400); })}>{copied ? t("Copied") : value}<Copy size={13} /></button>;
}

function LanguageSelector() {
  const { locale, setLocale, t } = useI18n();
  const labels: Record<Locale, { label: string; action: string }> = {
    en: { label: "EN", action: "Switch to English" },
    "zh-CN": { label: "中文", action: "Switch to Chinese" },
  };
  return <div className="language-selector" role="group" aria-label={t("Language")}>
    {supportedLocales.map((option) => <button key={option} className={locale === option ? "active" : ""} aria-pressed={locale === option} title={t(labels[option].action)} onClick={() => setLocale(option)}>{labels[option].label}</button>)}
  </div>;
}

function App() {
  const { t } = useI18n();
  const [route, setRoute] = useState(routeFromHash());
  const [connection, setConnection] = useState(readConnection);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [showNewInitiative, setShowNewInitiative] = useState(false);
  const api = useMemo(() => new ThreadlineApi(connection), [connection]);

  useEffect(() => {
    const update = () => { setRoute(routeFromHash()); setMobileMenu(false); };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  const pageTitle = route.page === "overview" ? t("Overview") : route.page === "initiative" ? t("Initiative detail") : route.page === "decision" ? t("Decision detail") : route.page === "submission" ? t("Submission detail") : route.page === "task" ? t("Task") : route.page === "agents" ? t("Agents") : localizedValue(t, route.page);
  const saveConnection = (next: Connection) => { writeConnection(next); setConnection(next); setShowConnection(false); };

  return <div className="app-shell">
    <Sidebar route={route} open={mobileMenu} close={() => setMobileMenu(false)} />
    <header className="topbar">
      <button className="btn-icon mobile-menu-btn" title={t("Open menu")} aria-label={t("Open menu")} onClick={() => setMobileMenu((open) => !open)}><Menu /></button>
      <div className="topbar-title">{pageTitle}</div>
      <div className="topbar-actions">
        <button className="btn btn-secondary btn-sm desktop-only" onClick={() => setShowNewInitiative(true)}><Plus size={16} />{t("New initiative")}</button>
        <LanguageSelector />
        <button className="btn-icon" title={t("Gateway connection")} aria-label={t("Gateway connection")} onClick={() => setShowConnection(true)}><Settings2 /></button>
        <div className="user-chip"><span className="avatar">Y</span>{t("You")}</div>
      </div>
    </header>
    <main className="main">
      {route.page === "overview" && <Overview api={api} onNew={() => setShowNewInitiative(true)} />}
      {route.page === "inbox" && <InboxPage api={api} />}
      {route.page === "workboard" && <WorkboardPage api={api} />}
      {route.page === "decisions" && <DecisionsPage api={api} />}
      {route.page === "agents" && <AgentsPage api={api} />}
      {route.page === "initiative" && route.id && <InitiativeDetail api={api} id={route.id} />}
      {route.page === "decision" && route.id && <DecisionDetail api={api} id={route.id} />}
      {route.page === "submission" && route.id && <SubmissionDetail api={api} id={route.id} />}
      {route.page === "task" && route.id && <TaskDetail api={api} id={route.id} />}
    </main>
    {showConnection && <ConnectionDialog current={connection} onClose={() => setShowConnection(false)} onSave={saveConnection} />}
    {showNewInitiative && <NewInitiativeDialog api={api} onClose={() => setShowNewInitiative(false)} />}
  </div>;
}

function Sidebar({ route, open, close }: { route: Route; open: boolean; close: () => void }) {
  const { t } = useI18n();
  const links = [
    ["overview", t("Overview"), LayoutDashboard], ["inbox", t("Inbox"), Inbox], ["workboard", t("Workboard"), ClipboardList], ["decisions", t("Decisions"), Scale], ["agents", t("Agents"), Network],
  ] as const;
  return <aside className={`sidebar ${open ? "open" : ""}`}>
    <div className="wordmark"><span className="wordmark-dot" />Threadline</div>
    <nav aria-label={t("Primary navigation")}><ul className="nav-list">{links.map(([page, label, Icon]) => <li key={page}><a className={`nav-link ${route.page === page ? "active" : ""}`} href={`#${page}`} onClick={close}><Icon size={18} />{label}</a></li>)}</ul></nav>
    <div className="sidebar-note">{t("Shared work context for humans and agents.")}</div>
  </aside>;
}

function Overview({ api, onNew }: { api: ThreadlineApi; onNew: () => void }) {
  const { t } = useI18n();
  const data = useLoad("overview", (signal) => Promise.all([api.inbox(signal), api.workboard(signal), api.decisions(signal)]), [api]);
  const [inbox, board, decisions] = data.value ?? [[], null, []] as [InboxItem[], Workboard | null, Decision[]];
  const initiatives = board ? Object.values(board).flat().length : 0;
  const open = decisions.filter((decision) => ["open", "seen"].includes(decision.status)).length;
  return <PageHeader title="Threadline" subtitle={t("Human-Agent Gateway workbench - your shared source of attention and decisions.")} action={<button className="btn btn-primary" onClick={onNew}><Plus size={17} />{t("New initiative")}</button>}>
    {data.loading && !data.value ? <OverviewSkeleton /> : data.error && !data.value ? <StateBox title={t("Could not load workspace")} retry={data.reload}>{localizedError(t, data.error)}</StateBox> : <>
      <RefreshIndicator refreshing={data.refreshing} error={data.refreshError} retry={data.reload} />
      <section className="overview-metrics" aria-label={t("Workspace summary")}>
        <Metric label={t("Active notifications")} value={t("{count} need attention", { count: inbox.length })} href="#inbox" />
        <Metric label={t("Running initiatives")} value={t("{count} on the Workboard", { count: initiatives })} href="#workboard" />
        <Metric label={t("Open decisions")} value={t("{count} waiting to close", { count: open })} href="#decisions" />
      </section>
      <section className="overview-section"><div className="section-heading"><h2>{t("Needs attention")}</h2><a href="#inbox">{t("Open Inbox")} <ChevronRight size={16} /></a></div>{inbox.length ? <div className="mini-list">{inbox.slice(0, 3).map((item) => <MiniInboxItem item={item} key={item.notification.id} />)}</div> : <StateBox title={t("Inbox is clear")}>{t("New decisions, deliveries, and alerts will appear here.")}</StateBox>}</section>
    </>}
  </PageHeader>;
}

function Metric({ label, value, href }: { label: string; value: string; href: string }) { return <a className="metric" href={href}><span>{label}</span><strong>{value}</strong><ChevronRight size={18} /></a>; }
function inboxItemHref(item: InboxItem): string { return item.decision ? `#decision/${item.decision.id}` : `#submission/${item.submission.id}`; }

function MiniInboxItem({ item }: { item: InboxItem }) {
  const { locale, t } = useI18n();
  const identity = executionIdentity(item.submission);
  return <a className="mini-inbox" href={inboxItemHref(item)}><Badge tone={item.decision ? "decision" : item.submission.kind}>{localizedValue(t, item.decision ? "decision" : item.submission.kind)}</Badge><div><strong>{item.submission.title}</strong><span>{identity.host} · {identity.tool} · {formatDate(locale, item.submission.created_at)}</span></div><ChevronRight size={17} /></a>;
}

function InboxPage({ api }: { api: ThreadlineApi }) {
  const { locale, t } = useI18n();
  const data = useLoad("inbox", (signal) => api.inbox(signal), [api]);
  const [scope, setScope] = useState<"unread" | "all">("unread");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const applyActionLocal = (id: string, action: "read" | "snooze" | "archive") => {
    data.mutate((items) => items.map((item) => {
      if (item.notification.id !== id) return item;
      const base = { ...item, notification: { ...item.notification } };
      if (action === "read") base.notification.status = "read";
      else if (action === "snooze") {
        base.notification.status = "snoozed";
        base.notification.snoozed_until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      } else base.notification.status = "archived";
      return base;
    }));
  };

  const handleAction = async (item: InboxItem, action: "read" | "snooze" | "archive") => {
    const key = `${item.notification.id}:${action}`;
    setPending(key);
    setActionError(null);
    const snapshot = data.value;
    applyActionLocal(item.notification.id, action);
    try {
      await api.updateNotification(item.notification.id, action);
    } catch (error: unknown) {
      if (snapshot !== null) data.mutate(() => snapshot);
      setActionError(error instanceof Error ? error.message : t("Something went wrong."));
    } finally {
      setPending((current) => (current === key ? null : current));
    }
  };

  const markAllRead = async () => {
    const active = (data.value ?? []).filter((item) => item.notification.status === "active");
    if (!active.length) return;
    setActionError(null);
    const snapshot = data.value;
    data.mutate((items) => items.map((item) => (item.notification.status === "active" ? { ...item, notification: { ...item.notification, status: "read" } } : item)));
    try {
      await Promise.all(active.map((item) => api.updateNotification(item.notification.id, "read")));
    } catch (error: unknown) {
      if (snapshot !== null) data.mutate(() => snapshot);
      setActionError(error instanceof Error ? error.message : t("Something went wrong."));
    }
  };

  const visible = (data.value ?? []).filter((item) => {
    const kind = item.decision ? "decision" : item.submission.kind;
    const matchesScope = scope === "all" || item.notification.status === "active";
    const matchesFilter = filter === "all" || kind === filter;
    const identity = executionIdentity(item.submission);
    const haystack = `${item.submission.title} ${item.submission.summary} ${identity.host} ${identity.tool} ${identity.session}`.toLowerCase();
    return matchesScope && matchesFilter && haystack.includes(query.toLowerCase());
  });
  const unread = (data.value ?? []).filter((item) => item.notification.status === "active");
  const hasActiveFilter = query || filter !== "all";
  return <PageHeader title={t("Inbox")} subtitle={scope === "unread" ? t("Only things that need your attention right now.") : t("All inbox messages, including those already read.")} action={<button className="btn btn-secondary btn-sm" disabled={!unread.length} onClick={() => void markAllRead()}>{t("Mark all read")}</button>}>
    <div className="toolbar"><input className="search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search host, tool, session...")} aria-label={t("Search inbox")} /><div className="filter-groups"><div className="filter-group" role="group" aria-label={t("Message scope")}>{(["unread", "all"] as const).map((value) => <button key={value} className={`btn btn-sm ${scope === value ? "btn-secondary" : "btn-ghost"}`} onClick={() => setScope(value)}>{t(value === "unread" ? "Unread" : "All messages")}</button>)}</div><div className="filter-group" role="group" aria-label={t("Message type")}>{["all", "decision", "delivery", "alert"].map((value) => <button key={value} className={`btn btn-sm ${filter === value ? "btn-secondary" : "btn-ghost"}`} onClick={() => setFilter(value)}>{localizedValue(t, value)}</button>)}</div></div></div>
    {actionError && <div className="action-error" role="alert">{localizedError(t, actionError)}</div>}
    <RefreshIndicator refreshing={data.refreshing} error={data.refreshError} retry={data.reload} />
    {data.loading && !data.value ? <InboxSkeleton /> : data.error && !data.value ? <StateBox title={t("Could not load Inbox")} retry={data.reload}>{localizedError(t, data.error)}</StateBox> : !visible.length ? <StateBox title={hasActiveFilter ? t("No matching notifications") : scope === "all" ? t("No messages yet") : t("Inbox is clear")}>{hasActiveFilter ? t("Try a different search or filter.") : scope === "all" ? t("Messages you receive will appear here.") : t("New attention-worthy work will appear here.")}</StateBox> : <div className="inbox-list">{visible.map((item) => { const identity = executionIdentity(item.submission); return <article className={`inbox-item ${item.notification.status === "active" ? "unread" : ""}`} key={item.notification.id}><div className="item-kind"><Badge tone={item.decision ? "decision" : item.submission.kind}>{localizedValue(t, item.decision ? "decision" : item.submission.kind)}</Badge></div><div className="item-main"><div className="item-title">{item.submission.title}</div><div className="item-summary">{item.submission.summary}</div><div className="item-meta-row">{item.decision && <Badge tone={item.decision.risk_level}>{item.decision.status === "resolved" ? t("Resolved") : t("decision needed")}</Badge>}<span>{t("Host")}: <strong>{identity.host}</strong></span><span>{t("Tool")}: <strong>{identity.tool}</strong></span><CopyValue value={item.submission.session_id} />{item.initiative && <a href={`#initiative/${item.initiative.id}`}>{t("Initiative")}: <strong>{item.initiative.title}</strong></a>}<span>{formatDate(locale, item.submission.created_at)}</span></div></div><div className="item-actions">{item.notification.status === "active" && <IconAction label={t("Mark read")} disabled={pending === `${item.notification.id}:read`} onClick={() => void handleAction(item, "read")}><Check /></IconAction>}<IconAction label={t("Snooze one day")} disabled={pending === `${item.notification.id}:snooze`} onClick={() => void handleAction(item, "snooze")}><Clock3 /></IconAction><IconAction label={t("Archive")} disabled={pending === `${item.notification.id}:archive`} onClick={() => void handleAction(item, "archive")}><Archive /></IconAction><a className="btn btn-secondary btn-sm" href={inboxItemHref(item)}>{item.decision ? t("Decide") : t("View")}</a></div></article>; })}</div>}
  </PageHeader>;
}

function IconAction({ label, children, ...props }: { label: string; children: ReactNode; disabled?: boolean; onClick: () => void }) { return <button className="btn-icon" title={label} aria-label={label} {...props}>{children}</button>; }

function WorkboardPage({ api }: { api: ThreadlineApi }) {
  const { t } = useI18n();
  const data = useLoad("workboard", (signal) => api.workboard(signal), [api]);
  const board = normalizeWorkboard(data.value);
  const lanes: Array<[string, InitiativeRecord[]]> = [[t("Ready"), board.ready], [t("Waiting"), board.waiting], [t("Done"), board.done]];
  return <PageHeader title={t("Workboard")} subtitle={t("Initiatives grouped by their next state.")}>
    {data.loading && !data.value ? <WorkboardSkeleton /> : data.error && !data.value ? <StateBox title={t("Could not load Workboard")} retry={data.reload}>{localizedError(t, data.error)}</StateBox> : <>
      <RefreshIndicator refreshing={data.refreshing} error={data.refreshError} retry={data.reload} />
      <div className="board">{lanes.map(([label, initiatives]) => <section className="lane" key={label}><header className="lane-header"><h2>{label}</h2><span>{initiatives.length}</span></header><div className="lane-body">{initiatives.length ? initiatives.map((initiative, index) => <InitiativeCard initiative={initiative} key={initiative.id ?? `${label}-${index}`} />) : <div className="lane-empty">{t("No initiatives")}</div>}</div></section>)}</div>
    </>}
  </PageHeader>;
}

function InitiativeCard({ initiative }: { initiative: InitiativeRecord }) {
  const { locale, t } = useI18n();
  const record = initiativeRecord(initiative);
  const title = initiative.title || t("Untitled initiative");
  const status = initiative.status || "info";
  return <a className="work-card" href={initiative.id ? `#initiative/${initiative.id}` : "#workboard"}><h3>{title}</h3><p><span>{t("Intent")}</span>{initiative.intent || t("Not recorded")}</p><dl className="work-card-context"><div><dt>{t("Owner")}</dt><dd>{record.owner ?? t("Not recorded")}</dd></div><div><dt>{t("Next action")}</dt><dd>{record.nextAction ?? t("Not recorded")}</dd></div><div><dt>{t("Blocker")}</dt><dd>{record.blocker ?? t("No blocker recorded")}</dd></div><div><dt>{t("Recent fact")}</dt><dd>{record.recentFact ?? t("No recent fact recorded")}</dd></div><div><dt>{t("Record language")}</dt><dd>{record.recordLanguage ?? t("Not recorded")}</dd></div></dl><footer><Badge tone={status}>{displayStatus(t, status)}</Badge><span>{formatDate(locale, initiative.last_activity_at ?? null)}</span></footer></a>;
}

function DecisionsPage({ api }: { api: ThreadlineApi }) {
  const { t } = useI18n();
  const data = useLoad("decisions", (signal) => Promise.all([api.decisions(signal), api.initiatives(signal)]), [api]);
  const [filter, setFilter] = useState("open");
  const [decisions, initiatives] = data.value ?? [[], []] as [Decision[], Initiative[]];
  const initiativeNames = new Map(initiatives.map((item) => [item.id, item.title]));
  const visible = decisions.filter((decision) => filter === "all" || (filter === "open" ? ["open", "seen"].includes(decision.status) : decision.status === "resolved"));
  return <PageHeader title={t("Decision Registry")} subtitle={t("Open and closed decisions with risk, source session, and resolution.")}>
    <div className="toolbar"><div className="filter-group">{["all", "open", "resolved"].map((value) => <button key={value} className={`btn btn-sm ${filter === value ? "btn-primary" : "btn-secondary"}`} onClick={() => setFilter(value)}>{localizedValue(t, value)}</button>)}</div></div>
    {data.loading && !data.value ? <DecisionsSkeleton /> : data.error && !data.value ? <StateBox title={t("Could not load decisions")} retry={data.reload}>{localizedError(t, data.error)}</StateBox> : <>
      <RefreshIndicator refreshing={data.refreshing} error={data.refreshError} retry={data.reload} />
      {!visible.length ? <StateBox title={t("No decisions here")}>{filter === "open" ? t("There are no decisions waiting to close.") : t("Decisions created by Agents will appear here.")}</StateBox> : <div className="table-wrap"><table className="data-table"><caption className="sr-only">{t("Decision Registry")}</caption><thead><tr><th>{t("Question")}</th><th>{t("Options")}</th><th>{t("Risk")}</th><th>{t("Initiative")}</th><th>{t("Status")}</th><th /></tr></thead><tbody>{visible.map((decision) => <tr key={decision.id}><td className="cell-primary">{decision.question}</td><td className="cell-secondary">{decision.options?.join(" / ") ?? "-"}</td><td><Badge tone={decision.risk_level}>{localizedValue(t, decision.risk_level)}</Badge></td><td className="cell-secondary">{decision.initiative_id ? initiativeNames.get(decision.initiative_id) ?? decision.initiative_id : "-"}</td><td><Badge tone={decision.status}>{localizedValue(t, decision.status)}</Badge></td><td><a className="btn btn-secondary btn-sm" href={`#decision/${decision.id}`}>{decision.status === "resolved" ? t("View") : t("Decide")}</a></td></tr>)}</tbody></table></div>}
    </>}
  </PageHeader>;
}

function executionIdentity(submission: Submission): { host: string; tool: string; session: string } {
  return {
    host: submission.host ?? "Unknown host",
    tool: submission.tool ?? "Unknown tool",
    session: submission.session_id ?? "No session recorded",
  };
}

function AgentsPage({ api }: { api: ThreadlineApi }) {
  const { t } = useI18n();
  const route = routeFromHash();
  const data = useLoad("agents", (signal) => api.submissions(undefined, signal), [api]);
  const [query, setQuery] = useState("");
  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set());
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const visible = (data.value ?? []).filter((submission) => {
      const identity = executionIdentity(submission);
      return `${identity.host} ${identity.tool} ${identity.session}`.toLowerCase().includes(query.trim().toLowerCase());
    });
    return groupSubmissionsByIdentity(visible);
  }, [data.value, query]);

  const selected = useMemo(() => {
    if (!route.id) return null;
    const parsed = parseAgentsSessionRoute(route.id);
    if (!parsed) return null;
    const records = selectedSessionRecords(groups, parsed.host, parsed.tool, parsed.session);
    if (!records) return null;
    return { ...parsed, records };
  }, [route.id, groups]);

  useEffect(() => {
    if (!selected) return;
    setExpandedHosts((prev) => new Set([...prev, selected.host]));
    setExpandedTools((prev) => new Set([...prev, toolKey(selected.host, selected.tool)]));
  }, [selected?.host, selected?.tool, selected?.session]);

  const toggleHost = (host: string) => {
    setExpandedHosts((prev) => {
      const next = new Set(prev);
      if (next.has(host)) next.delete(host);
      else next.add(host);
      return next;
    });
  };

  const toggleTool = (host: string, tool: string) => {
    const key = toolKey(host, tool);
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectSession = (host: string, tool: string, session: string) => {
    navigate(`#${makeAgentsSessionRoute(host, tool, session)}`);
  };

  const totalHosts = groups.length;
  const isHostExpanded = (host: string) => expandedHosts.has(host);
  const isToolExpanded = (host: string, tool: string) => expandedTools.has(toolKey(host, tool));

  return <PageHeader title={t("Agents")} subtitle={t("Browse work by execution host, tool, and session.")}>
    <div className="toolbar"><input className="search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search host, tool, session...")} aria-label={t("Search agents")} /></div>
    {data.loading && !data.value ? <SkeletonMiniList /> : data.error && !data.value ? <StateBox title={t("Could not load agents")} retry={data.reload}>{localizedError(t, data.error)}</StateBox> : !totalHosts ? <StateBox title={t("No matching agents")}>{t("Agent work will appear here.")}</StateBox> : <>
      <RefreshIndicator refreshing={data.refreshing} error={data.refreshError} retry={data.reload} />
      <div className="agents-layout">
        <section className="agents-index" aria-label={t("Agents")}>
          <header className="agents-index-header"><h2>{t("Host / Tool / Session")}</h2><span className="text-muted">{t("{count} hosts", { count: totalHosts })}</span></header>
          <div className="agents-tree" role="tree">
            {groups.map((hostNode) => (
              <div className="agents-host" key={hostNode.host}>
                <button className={`agents-host-row ${hostNode.host === UNKNOWN_HOST ? "unknown" : ""}`} aria-expanded={isHostExpanded(hostNode.host)} onClick={() => toggleHost(hostNode.host)}>
                  <ChevronRight size={16} className="chevron" />
                  <span>{hostNode.host}</span>
                  <span className="count"><Badge tone="info">{hostNode.tools.reduce((sum, tool) => sum + tool.sessions.reduce((s, session) => s + session.submissions.length, 0), 0)}</Badge></span>
                </button>
                {isHostExpanded(hostNode.host) && (
                  <div className="agents-tool-list" role="group">
                    {hostNode.tools.map((toolNode) => (
                      <div className="agents-tool" key={toolNode.tool}>
                        <button className={`agents-tool-row ${toolNode.tool === UNKNOWN_TOOL ? "unknown" : ""}`} aria-expanded={isToolExpanded(hostNode.host, toolNode.tool)} onClick={() => toggleTool(hostNode.host, toolNode.tool)}>
                          <ChevronRight size={16} className="chevron" />
                          <span>{toolNode.tool}</span>
                          <span className="count"><Badge tone="info">{toolNode.sessions.reduce((sum, session) => sum + session.submissions.length, 0)}</Badge></span>
                        </button>
                        {isToolExpanded(hostNode.host, toolNode.tool) && (
                          <div className="agents-session-list" role="group">
                            {toolNode.sessions.map((sessionNode) => {
                              const isSelected = selected?.host === hostNode.host && selected?.tool === toolNode.tool && selected?.session === sessionNode.session;
                              return <button key={sessionNode.session} className={`agents-session-row ${isSelected ? "selected" : ""} ${sessionNode.session === UNKNOWN_SESSION ? "unknown" : ""}`} aria-current={isSelected ? "true" : undefined} onClick={() => selectSession(hostNode.host, toolNode.tool, sessionNode.session)}>
                                <span className="session-label">{sessionNode.session}</span>
                                <span className="session-meta">{t("{count} records", { count: sessionNode.submissions.length })}</span>
                              </button>;
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="agents-detail" aria-label={t("Session records")}>
          {!selected ? <div className="state-box agents-detail-empty"><Network aria-hidden="true" /><div><div className="state-title">{t("No session selected")}</div><p>{t("Select a session to view its records.")}</p></div></div> : <>
            <div className="agents-session-header">
              <div>
                <h2>{t("Session records")}</h2>
                <div className="session-path"><span>{selected.host}</span><span>·</span><span>{selected.tool}</span><span>·</span><CopyValue value={selected.session} /></div>
              </div>
              <Badge tone="info">{t("{count} records", { count: selected.records.length })}</Badge>
            </div>
            <div className="panel"><div className="panel-body"><ol className="submission-timeline">{selected.records.map((submission) => <SubmissionRow key={submission.id} submission={submission} />)}</ol></div></div>
          </>}
        </section>
      </div>
    </>}
  </PageHeader>;
}

function toolKey(host: string, tool: string): string { return `${host}\0${tool}`; }

function InitiativeDetail({ api, id }: { api: ThreadlineApi; id: string }) {
  const { locale, t } = useI18n();
  const data = useLoad("initiative", (signal) => Promise.all([api.initiative(id, signal), api.submissions(id, signal), api.tasks(id, signal), api.decisions(signal), api.events("initiative", id, signal)]), [api, id]);
  const [saving, setSaving] = useState(false);
  if (data.loading && !data.value) return <DetailSkeleton />;
  if (data.error && !data.value) return <StateBox title={t("Could not load initiative")} retry={data.reload}>{localizedError(t, data.error)}</StateBox>;
  if (!data.value) return null;
  const [initiative, submissions, tasks, allDecisions, events] = data.value;
  const decisions = allDecisions.filter((decision) => decision.initiative_id === id);
  const updateStatus = async (status: InitiativeStatus) => { setSaving(true); try { await api.updateInitiative(id, { status }); data.reload(); } finally { setSaving(false); } };
  return <PageHeader title={initiative.title} subtitle={`${t("Initiative")} · ${displayStatus(t, initiative.status)}`} action={<a className="btn btn-secondary btn-sm" href="#workboard">{t("Back to Workboard")}</a>}>
    <RefreshIndicator refreshing={data.refreshing} error={data.refreshError} retry={data.reload} />
    <div className="detail-grid"><section className="panel"><div className="panel-body"><DetailSection title={t("Intent")}><p className="detail-copy">{initiative.intent}</p></DetailSection><DetailSection title={t("Next step")}><p className="detail-copy">{initiative.next_step ?? t("No next step recorded")}</p></DetailSection><TaskList api={api} initiativeId={id} tasks={tasks} reload={data.reload} /><DetailSection title={t("Submissions")}>{submissions.length ? <ol className="submission-timeline">{submissions.map((submission) => <SubmissionRow key={submission.id} submission={submission} />)}</ol> : <p className="text-muted">{t("No submissions are linked yet.")}</p>}</DetailSection><DetailSection title={t("Decisions")}>{decisions.length ? <div className="linked-list">{decisions.map((decision) => <a href={`#decision/${decision.id}`} className="linked-row" key={decision.id}><div><strong>{decision.question}</strong><span>{decision.resolution ?? t("Awaiting a decision")}</span></div><Badge tone={decision.status}>{localizedValue(t, decision.status)}</Badge></a>)}</div> : <p className="text-muted">{t("No decisions are linked yet.")}</p>}</DetailSection><DetailSection title={t("Activity")}><Timeline events={events} /></DetailSection></div></section><aside className="panel"><div className="panel-header"><h2>{t("Properties")}</h2></div><div className="panel-body"><div className="field"><label htmlFor="initiative-status">{t("Status")}</label><select id="initiative-status" value={initiative.status} disabled={saving} onChange={(event) => void updateStatus(event.target.value as InitiativeStatus)}>{["active", "waiting_for_jim", "waiting_for_agent", "paused", "completed", "cancelled"].map((value) => <option value={value} key={value}>{displayStatus(t, value)}</option>)}</select></div><Properties rows={[[t("ID"), initiative.id], [t("Created by"), initiative.created_by], [t("Last activity"), formatDate(locale, initiative.last_activity_at)], [t("Created"), formatDate(locale, initiative.created_at)]]} /></div></aside></div>
  </PageHeader>;
}

function TaskList({ api, initiativeId, tasks, reload }: { api: ThreadlineApi; initiativeId: string; tasks: Task[]; reload: () => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try { await api.createTask({ initiative_id: initiativeId, title: title.trim() }); setTitle(""); reload(); } finally { setSaving(false); }
  };
  return <DetailSection title={t("Tasks")}>
    <form className="resolve-form" onSubmit={create}><label htmlFor="task-title">{t("New task")}</label><div className="toolbar"><input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} required /><button className="btn btn-primary btn-sm" disabled={saving}>{t("Add")}</button></div></form>
    {tasks.length ? <div className="linked-list">{tasks.map((task) => <div className="linked-row" key={task.id}><a href={`#task/${task.id}`}><strong>{task.title}</strong><span>{task.detail ?? t("No additional detail was provided.")}</span></a><div className="item-actions"><Badge tone={task.status}>{localizedValue(t, task.status)}</Badge><button className="btn btn-secondary btn-sm" onClick={() => void api.updateTask(task.id, { status: task.status === "completed" ? "open" : "completed" }).then(reload)}>{task.status === "completed" ? t("Reopen") : t("Complete")}</button></div></div>)}</div> : <p className="text-muted">{t("No tasks are linked yet.")}</p>}
  </DetailSection>;
}

function TaskDetail({ api, id }: { api: ThreadlineApi; id: string }) {
  const { t } = useI18n();
  const data = useLoad("task", async (signal) => {
    const task = await api.task(id, signal);
    const [linked, submissions] = await Promise.all([api.taskSubmissions(id, signal), api.submissions(task.initiative_id, signal)]);
    return { task, linked, submissions };
  }, [api, id]);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data.value) { setTitle(data.value.task.title); setDetail(data.value.task.detail ?? ""); } }, [data.value]);
  if (data.loading && !data.value) return <DetailSkeleton />;
  if (data.error && !data.value) return <StateBox title={t("Could not load task")} retry={data.reload}>{localizedError(t, data.error)}</StateBox>;
  const value = data.value;
  if (!value) return null;
  const { task, linked, submissions } = value;
  const unlinked = submissions.filter((submission) => !linked.some((item) => item.id === submission.id));
  const save = async (event: FormEvent) => { event.preventDefault(); setSaving(true); try { await api.updateTask(id, { title: title.trim(), detail: detail.trim() || null }); data.reload(); } finally { setSaving(false); } };
  return <PageHeader title={task.title} subtitle={`${t("Task")} · ${localizedValue(t, task.status)}`} action={<a className="btn btn-secondary btn-sm" href={`#initiative/${task.initiative_id}`}>{t("Back to initiative")}</a>}>
    <div className="detail-grid"><section className="panel"><div className="panel-body"><DetailSection title={t("Task")}> <form className="resolve-form" onSubmit={save}><label htmlFor="task-detail-title">{t("Title")}</label><input id="task-detail-title" value={title} onChange={(event) => setTitle(event.target.value)} required /><label htmlFor="task-detail">{t("Details")}</label><textarea id="task-detail" rows={5} value={detail} onChange={(event) => setDetail(event.target.value)} /><button className="btn btn-primary" disabled={saving}>{t("Save")}</button></form></DetailSection><DetailSection title={t("Linked submissions")}>{linked.length ? <div className="linked-list">{linked.map((submission) => <div className="linked-row" key={submission.id}><a href={`#submission/${submission.id}`}><strong>{submission.title}</strong><span>{submission.summary}</span></a><button className="btn btn-secondary btn-sm" onClick={() => void api.unlinkTaskSubmission(id, submission.id).then(data.reload)}>{t("Remove")}</button></div>)}</div> : <p className="text-muted">{t("No submissions are linked yet.")}</p>}{unlinked.length ? <div className="linked-list">{unlinked.map((submission) => <div className="linked-row" key={submission.id}><div><strong>{submission.title}</strong><span>{submission.summary}</span></div><button className="btn btn-secondary btn-sm" onClick={() => void api.linkTaskSubmission(id, submission.id).then(data.reload)}>{t("Link")}</button></div>)}</div> : null}</DetailSection></div></section><aside className="panel"><div className="panel-header"><h2>{t("Properties")}</h2></div><div className="panel-body"><button className="btn btn-secondary" onClick={() => void api.updateTask(id, { status: task.status === "completed" ? "open" : "completed" }).then(data.reload)}>{task.status === "completed" ? t("Reopen") : t("Complete")}</button><Properties rows={[[t("Status"), <Badge tone={task.status}>{localizedValue(t, task.status)}</Badge>], [t("Initiative"), <a href={`#initiative/${task.initiative_id}`}>{t("View")}</a>], [t("Created by"), task.created_by]]} /></div></aside></div>
  </PageHeader>;
}

function DecisionDetail({ api, id }: { api: ThreadlineApi; id: string }) {
  const { locale, t } = useI18n();
  const data = useLoad("decision", (signal) => Promise.all([api.decision(id, signal), api.submissions(undefined, signal), api.initiatives(signal), api.events("decision", id, signal)]), [api, id]);
  const [outcome, setOutcome] = useState("");
  const [saving, setSaving] = useState(false);
  if (data.loading && !data.value) return <DetailSkeleton />;
  if (data.error && !data.value) return <StateBox title={t("Could not load decision")} retry={data.reload}>{localizedError(t, data.error)}</StateBox>;
  if (!data.value) return null;
  const [decision, submissions, initiatives, events] = data.value;
  const submission = submissions.find((item) => item.id === decision.submission_id);
  const initiative = initiatives.find((item) => item.id === decision.initiative_id);
  const resolve = async (event: FormEvent) => { event.preventDefault(); if (!outcome.trim()) return; setSaving(true); try { await api.resolveDecision(id, outcome.trim()); data.reload(); } finally { setSaving(false); } };
  const identity = submission ? executionIdentity(submission) : null;
  return <PageHeader title={decision.question} subtitle={`${t("Decision")} · ${localizedValue(t, decision.status)} · ${t("{status} risk", { status: localizedValue(t, decision.risk_level) })}`} action={<a className="btn btn-secondary btn-sm" href="#decisions">{t("Back to registry")}</a>}>
    <RefreshIndicator refreshing={data.refreshing} error={data.refreshError} retry={data.reload} />
    <div className="detail-grid"><section className="panel"><div className="panel-body"><DetailSection title={t("Question")}><p className="detail-copy">{decision.question}</p></DetailSection><DetailSection title={t("Options")}>{decision.options?.length ? <ul className="option-list">{decision.options.map((option) => <li key={option}>{option}</li>)}</ul> : <p className="text-muted">{t("No preset options were provided.")}</p>}</DetailSection>{decision.status !== "resolved" ? <DetailSection title={t("Close decision")}><form onSubmit={resolve} className="resolve-form"><label htmlFor="outcome">{t("Outcome")}</label><textarea id="outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} rows={4} placeholder={t("Record the decision and the reason for it.")} required /><p>{t("Closing this writes the same semantic event an Agent would produce via the CLI. The linked Inbox item will disappear.")}</p><button className="btn btn-primary" disabled={saving}>{saving ? t("Resolving...") : t("Close decision")}</button></form></DetailSection> : <DetailSection title={t("Resolution")}><p className="resolution">{decision.resolution}</p><p className="text-muted">{t("Resolved by {name} via {via} · {date}", { name: decision.resolved_by ?? "-", via: decision.resolved_via ?? "-", date: formatDate(locale, decision.resolved_at) })}</p></DetailSection>}<DetailSection title={t("Audit trail")}><Timeline events={events} /></DetailSection></div></section><aside className="panel"><div className="panel-header"><h2>{t("Properties")}</h2></div><div className="panel-body"><Properties rows={[[t("ID"), decision.id], [t("Status"), <Badge tone={decision.status}>{localizedValue(t, decision.status)}</Badge>], [t("Risk"), <Badge tone={decision.risk_level}>{localizedValue(t, decision.risk_level)}</Badge>], [t("Host"), identity?.host ?? "-"], [t("Tool"), identity?.tool ?? "-"], [t("Session"), <CopyValue value={submission?.session_id ?? null} />], [t("Initiative"), initiative ? <a href={`#initiative/${initiative.id}`}>{initiative.title}</a> : "-"], [t("Created"), formatDate(locale, decision.created_at)]]} /></div></aside></div>
  </PageHeader>;
}

function SubmissionDetail({ api, id }: { api: ThreadlineApi; id: string }) {
  const { locale, t } = useI18n();
  const data = useLoad("submission", (signal) => Promise.all([api.submission(id, signal), api.events("submission", id, signal)]), [api, id]);
  if (data.loading && !data.value) return <DetailSkeleton />;
  if (data.error && !data.value) return <StateBox title={t("Could not load submission")} retry={data.reload}>{localizedError(t, data.error)}</StateBox>;
  if (!data.value) return null;
  const [submission, events] = data.value;
  const identity = executionIdentity(submission);
  return <PageHeader title={submission.title} subtitle={`${localizedValue(t, submission.kind)} · ${localizedValue(t, submission.attention_policy)}`} action={<a className="btn btn-secondary btn-sm" href="#inbox">{t("Back to Inbox")}</a>}>
    <RefreshIndicator refreshing={data.refreshing} error={data.refreshError} retry={data.reload} />
    <div className="detail-grid"><section className="panel"><div className="panel-body"><DetailSection title={t("Summary")}><p className="detail-copy">{submission.summary}</p></DetailSection><DetailSection title={t("Details")}>{submission.detail ? <p className="detail-copy submission-detail">{submission.detail}</p> : <p className="text-muted">{t("No additional detail was provided.")}</p>}</DetailSection>{submission.detail_ref && <DetailSection title={t("Reference")}><a href={submission.detail_ref} target="_blank" rel="noreferrer">{t("Open submitted reference")}</a></DetailSection>}<DetailSection title={t("Audit trail")}><Timeline events={events} /></DetailSection></div></section><aside className="panel"><div className="panel-header"><h2>{t("Properties")}</h2></div><div className="panel-body"><Properties rows={[[t("ID"), submission.id], [t("Kind"), <Badge tone={submission.kind}>{localizedValue(t, submission.kind)}</Badge>], [t("Attention"), localizedValue(t, submission.attention_policy)], [t("Host"), identity.host], [t("Tool"), identity.tool], [t("Session"), <CopyValue value={submission.session_id} />], [t("Initiative"), submission.initiative_id ? <a href={`#initiative/${submission.initiative_id}`}>{t("View")}</a> : "-"], [t("Observed"), formatDate(locale, submission.observed_at)], [t("Created"), formatDate(locale, submission.created_at)]]} /></div></aside></div>
  </PageHeader>;
}

function SubmissionRow({ submission }: { submission: Submission }) {
  const { locale, t } = useI18n();
  const timestamp = formatExactDate(submission.created_at);
  return <li><a className="submission-timeline-item" href={`#submission/${submission.id}`}><time dateTime={submission.created_at} title={timestamp}><span>{formatDate(locale, submission.created_at)}</span><span>{timestamp}</span></time><div className="submission-timeline-content"><div><strong>{submission.title}</strong><span>{submission.summary}</span></div><Badge tone={submission.kind}>{localizedValue(t, submission.kind)}</Badge></div></a></li>;
}

function Timeline({ events }: { events: AuditEvent[] }) {
  const { locale, t } = useI18n();
  return events.length ? <ol className="timeline">{events.map((event, index) => <li className={index === events.length - 1 ? "active" : ""} key={event.id}><time>{formatDate(locale, event.created_at)}</time><strong>{localizedValue(t, event.event_type.replace(".", " "))}</strong><span>{event.host ?? t("Unknown host")} · {event.tool ?? t("Unknown tool")}{event.session_id ? ` · ${event.session_id}` : ""}</span></li>)}</ol> : <p className="text-muted">{t("No activity has been recorded yet.")}</p>;
}

function Properties({ rows }: { rows: Array<[string, ReactNode]> }) { return <dl className="properties">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>; }
function DetailSection({ title, children }: { title: string; children: ReactNode }) { return <section className="panel-section"><h2>{title}</h2>{children}</section>; }
function PageHeader({ title, subtitle, action, children }: { title: string; subtitle: string; action?: ReactNode; children: ReactNode }) { return <><div className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div><div className="content">{children}</div></>; }

function ConnectionDialog({ current, onClose, onSave }: { current: Connection; onClose: () => void; onSave: (connection: Connection) => void }) {
  const { t } = useI18n();
  const [url, setUrl] = useState(current.url);
  const [token, setToken] = useState(current.token);
  return <Dialog title={t("Gateway connection")} onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); onSave({ url: url.trim(), token: token.trim() }); }}><div className="modal-body"><div className="field"><label htmlFor="gateway-url">{t("Gateway URL")}</label><input id="gateway-url" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://gateway.example.com" /></div><div className="field"><label htmlFor="gateway-token">{t("Instance token")}</label><input id="gateway-token" type="password" required value={token} onChange={(event) => setToken(event.target.value)} placeholder={t("Bearer token")} /><p className="field-help">{t("Stored only in this browser on this device.")}</p></div></div><div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={onClose}>{t("Cancel")}</button><button className="btn btn-primary">{t("Save connection")}</button></div></form></Dialog>;
}

function NewInitiativeDialog({ api, onClose }: { api: ThreadlineApi; onClose: () => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [intent, setIntent] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); try { const initiative = await api.createInitiative({ title, intent, status: "active", next_step: nextStep || null }); onClose(); navigate(`initiative/${initiative.id}`); } finally { setSaving(false); } };
  return <Dialog title={t("New initiative")} onClose={onClose}><form onSubmit={submit}><div className="modal-body"><div className="field"><label htmlFor="initiative-title">{t("Title")}</label><input id="initiative-title" required value={title} onChange={(event) => setTitle(event.target.value)} /></div><div className="field"><label htmlFor="initiative-intent">{t("Intent")}</label><textarea id="initiative-intent" rows={4} required value={intent} onChange={(event) => setIntent(event.target.value)} /></div><div className="field"><label htmlFor="initiative-next">{t("Next step")}</label><input id="initiative-next" value={nextStep} onChange={(event) => setNextStep(event.target.value)} /></div></div><div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={onClose}>{t("Cancel")}</button><button className="btn btn-primary" disabled={saving}>{saving ? t("Creating...") : t("Create initiative")}</button></div></form></Dialog>;
}

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const { t } = useI18n();
  return <div className="modal-backdrop open" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><h2>{title}</h2><button className="btn-icon" title={t("Close")} aria-label={t("Close")} onClick={onClose}><X /></button></header>{children}</section></div>;
}

createRoot(document.getElementById("root")!).render(<I18nProvider><App /></I18nProvider>);
