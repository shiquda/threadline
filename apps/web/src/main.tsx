import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive, Check, ChevronRight, CircleAlert, ClipboardList, Clock3, Copy, Inbox,
  LayoutDashboard, Menu, Network, Plus, RefreshCw, Scale, Settings2, X,
} from "lucide-react";
import type { AuditEvent, Decision, InboxItem, Initiative, InitiativeStatus, Submission, Workboard } from "@threadline/protocol";
import { ApiError, ThreadlineApi, readConnection, writeConnection, type Connection } from "./api.js";
import "./styles.css";

type Page = "overview" | "inbox" | "workboard" | "decisions" | "initiative" | "decision" | "submission";
type Route = { page: Page; id?: string };
type LoadState<T> = { value: T | null; loading: boolean; error: string | null };

function routeFromHash(): Route {
  const [page, id] = window.location.hash.replace(/^#\/?/, "").split("/");
  if (page === "initiative" && id) return { page: "initiative", id };
  if (page === "decision" && id) return { page: "decision", id };
  if (page === "submission" && id) return { page: "submission", id };
  if (page && ["inbox", "workboard", "decisions"].includes(page)) return { page: page as Page };
  return { page: "overview" };
}

function navigate(route: string): void { window.location.hash = route; }

function useLoad<T>(load: () => Promise<T>, keys: unknown[]): LoadState<T> & { reload: () => void } {
  const [state, setState] = useState<LoadState<T>>({ value: null, loading: true, error: null });
  const reload = useCallback(() => {
    setState((last) => ({ ...last, loading: true, error: null }));
    void load().then((value) => setState({ value, loading: false, error: null })).catch((error: unknown) => {
      setState({ value: null, loading: false, error: error instanceof Error ? error.message : "Something went wrong." });
    });
  // The caller owns the stable dependency list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, keys);
  useEffect(reload, [reload]);
  return { ...state, reload };
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const time = new Date(value).getTime();
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function titleCase(value: string): string { return value.replaceAll("_", " "); }

function displayStatus(value: string): string {
  return value === "waiting_for_jim" ? "Waiting for you" : titleCase(value);
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
  return <div className="state-box"><Network aria-hidden="true" /><div><div className="state-title">{title}</div><p>{children}</p></div>{retry && <button className="btn btn-secondary btn-sm" onClick={retry}><RefreshCw size={15} />Try again</button>}</div>;
}

function CopyValue({ value }: { value: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span>-</span>;
  return <button className="copy-value" title="Copy session ID" onClick={() => void navigator.clipboard.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1400); })}>{copied ? "Copied" : value}<Copy size={13} /></button>;
}

function App() {
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

  const pageTitle = route.page === "overview" ? "Overview" : route.page === "initiative" ? "Initiative detail" : route.page === "decision" ? "Decision detail" : route.page === "submission" ? "Submission detail" : titleCase(route.page);
  const saveConnection = (next: Connection) => { writeConnection(next); setConnection(next); setShowConnection(false); };

  return <div className="app-shell">
    <Sidebar route={route} open={mobileMenu} close={() => setMobileMenu(false)} />
    <header className="topbar">
      <button className="btn-icon mobile-menu-btn" title="Open menu" onClick={() => setMobileMenu((open) => !open)}><Menu /></button>
      <div className="topbar-title">{pageTitle}</div>
      <div className="topbar-actions">
        <button className="btn btn-secondary btn-sm desktop-only" onClick={() => setShowNewInitiative(true)}><Plus size={16} />New initiative</button>
        <button className="btn-icon" title="Gateway connection" onClick={() => setShowConnection(true)}><Settings2 /></button>
        <div className="user-chip"><span className="avatar">Y</span>You</div>
      </div>
    </header>
    <main className="main">
      {route.page === "overview" && <Overview api={api} onNew={() => setShowNewInitiative(true)} />}
      {route.page === "inbox" && <InboxPage api={api} />}
      {route.page === "workboard" && <WorkboardPage api={api} />}
      {route.page === "decisions" && <DecisionsPage api={api} />}
      {route.page === "initiative" && route.id && <InitiativeDetail api={api} id={route.id} />}
      {route.page === "decision" && route.id && <DecisionDetail api={api} id={route.id} />}
      {route.page === "submission" && route.id && <SubmissionDetail api={api} id={route.id} />}
    </main>
    {showConnection && <ConnectionDialog current={connection} onClose={() => setShowConnection(false)} onSave={saveConnection} />}
    {showNewInitiative && <NewInitiativeDialog api={api} onClose={() => setShowNewInitiative(false)} />}
  </div>;
}

function Sidebar({ route, open, close }: { route: Route; open: boolean; close: () => void }) {
  const links = [
    ["overview", "Overview", LayoutDashboard], ["inbox", "Inbox", Inbox], ["workboard", "Workboard", ClipboardList], ["decisions", "Decisions", Scale],
  ] as const;
  return <aside className={`sidebar ${open ? "open" : ""}`}>
    <div className="wordmark"><span className="wordmark-dot" />Threadline</div>
    <nav aria-label="Primary"><ul className="nav-list">{links.map(([page, label, Icon]) => <li key={page}><a className={`nav-link ${route.page === page ? "active" : ""}`} href={`#${page}`} onClick={close}><Icon size={18} />{label}</a></li>)}</ul></nav>
    <div className="sidebar-note">Shared work context<br />for humans and agents.</div>
  </aside>;
}

function Overview({ api, onNew }: { api: ThreadlineApi; onNew: () => void }) {
  const data = useLoad(() => Promise.all([api.inbox(), api.workboard(), api.decisions()]), [api]);
  const [inbox, board, decisions] = data.value ?? [[], null, []] as [InboxItem[], Workboard | null, Decision[]];
  const initiatives = board ? Object.values(board).flat().length : 0;
  const open = decisions.filter((decision) => ["open", "seen"].includes(decision.status)).length;
  return <PageHeader title="Threadline" subtitle="Human-Agent Gateway workbench - your shared source of attention and decisions." action={<button className="btn btn-primary" onClick={onNew}><Plus size={17} />New initiative</button>}>
    {data.loading ? <StateBox title="Loading workspace">Fetching the current work context.</StateBox> : data.error ? <StateBox title="Could not load workspace" retry={data.reload}>{data.error}</StateBox> : <>
      <section className="overview-metrics" aria-label="Workspace summary">
        <Metric label="Active notifications" value={`${inbox.length} need attention`} href="#inbox" />
        <Metric label="Running initiatives" value={`${initiatives} on the Workboard`} href="#workboard" />
        <Metric label="Open decisions" value={`${open} waiting to close`} href="#decisions" />
      </section>
      <section className="overview-section"><div className="section-heading"><h2>Needs attention</h2><a href="#inbox">Open Inbox <ChevronRight size={16} /></a></div>{inbox.length ? <div className="mini-list">{inbox.slice(0, 3).map((item) => <MiniInboxItem item={item} key={item.notification.id} />)}</div> : <StateBox title="Inbox is clear">New decisions, deliveries, and alerts will appear here.</StateBox>}</section>
    </>}
  </PageHeader>;
}

function Metric({ label, value, href }: { label: string; value: string; href: string }) { return <a className="metric" href={href}><span>{label}</span><strong>{value}</strong><ChevronRight size={18} /></a>; }

function inboxItemHref(item: InboxItem): string { return item.decision ? `#decision/${item.decision.id}` : `#submission/${item.submission.id}`; }

function MiniInboxItem({ item }: { item: InboxItem }) { return <a className="mini-inbox" href={inboxItemHref(item)}><Badge tone={item.decision ? "decision" : item.submission.kind}>{titleCase(item.decision ? "decision" : item.submission.kind)}</Badge><div><strong>{item.submission.title}</strong><span>{item.submission.runtime ?? item.submission.source} · {formatDate(item.submission.created_at)}</span></div><ChevronRight size={17} /></a>; }

function InboxPage({ api }: { api: ThreadlineApi }) {
  const data = useLoad(() => api.inbox(), [api]);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const handleAction = async (item: InboxItem, action: "read" | "snooze" | "archive") => { setPending(`${item.notification.id}:${action}`); try { await api.updateNotification(item.notification.id, action); data.reload(); } finally { setPending(null); } };
  const visible = (data.value ?? []).filter((item) => {
    const kind = item.decision ? "decision" : item.submission.kind;
    const matchFilter = filter === "all" || kind === filter;
    const haystack = `${item.submission.title} ${item.submission.summary} ${item.submission.runtime ?? ""} ${item.submission.agent ?? ""} ${item.submission.session_id ?? ""}`.toLowerCase();
    return matchFilter && haystack.includes(query.toLowerCase());
  });
  return <PageHeader title="Inbox" subtitle="Only things that need your attention right now." action={<button className="btn btn-secondary btn-sm" disabled={!data.value?.length} onClick={() => Promise.all((data.value ?? []).map((item) => api.updateNotification(item.notification.id, "read"))).then(data.reload)}>Mark all read</button>}>
    <div className="toolbar"><input className="search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search runtime, agent, session..." aria-label="Search inbox" /><div className="filter-group">{["all", "decision", "delivery", "alert"].map((value) => <button key={value} className={`btn btn-sm ${filter === value ? "btn-secondary" : "btn-ghost"}`} onClick={() => setFilter(value)}>{titleCase(value)}</button>)}</div></div>
    {data.loading ? <StateBox title="Loading Inbox">Fetching current notifications.</StateBox> : data.error ? <StateBox title="Could not load Inbox" retry={data.reload}>{data.error}</StateBox> : !visible.length ? <StateBox title={query || filter !== "all" ? "No matching notifications" : "Inbox is clear"}>{query || filter !== "all" ? "Try a different search or filter." : "New attention-worthy work will appear here."}</StateBox> : <div className="inbox-list">{visible.map((item) => <article className={`inbox-item ${item.notification.status === "active" ? "unread" : ""}`} key={item.notification.id}><div className="item-kind"><Badge tone={item.decision ? "decision" : item.submission.kind}>{titleCase(item.decision ? "decision" : item.submission.kind)}</Badge></div><div className="item-main"><div className="item-title">{item.submission.title}</div><div className="item-summary">{item.submission.summary}</div><div className="item-meta-row">{item.decision && <Badge tone={item.decision.risk_level}>{item.decision.status === "resolved" ? "resolved" : "decision needed"}</Badge>}<span>Runtime: <strong>{item.submission.runtime ?? item.submission.source}</strong></span>{item.submission.agent && <span>Agent: <strong>{item.submission.agent}</strong></span>}<CopyValue value={item.submission.session_id} />{item.initiative && <a href={`#initiative/${item.initiative.id}`}>Initiative: <strong>{item.initiative.title}</strong></a>}<span>{formatDate(item.submission.created_at)}</span></div></div><div className="item-actions"><IconAction label="Mark read" disabled={pending === `${item.notification.id}:read`} onClick={() => void handleAction(item, "read")}><Check /></IconAction><IconAction label="Snooze one day" disabled={pending === `${item.notification.id}:snooze`} onClick={() => void handleAction(item, "snooze")}><Clock3 /></IconAction><IconAction label="Archive" disabled={pending === `${item.notification.id}:archive`} onClick={() => void handleAction(item, "archive")}><Archive /></IconAction><a className="btn btn-secondary btn-sm" href={inboxItemHref(item)}>{item.decision ? "Decide" : "View"}</a></div></article>)}</div>}
  </PageHeader>;
}

function IconAction({ label, children, ...props }: { label: string; children: ReactNode; disabled?: boolean; onClick: () => void }) { return <button className="btn-icon" title={label} aria-label={label} {...props}>{children}</button>; }

function WorkboardPage({ api }: { api: ThreadlineApi }) {
  const data = useLoad(() => api.workboard(), [api]);
  const lanes: Array<[string, Initiative[]]> = data.value ? [["In progress", data.value.active], ["Waiting for you", data.value.waiting_for_jim], ["Waiting for Agent", data.value.waiting_for_agent], ["Paused / done", data.value.paused_or_done]] : [];
  return <PageHeader title="Workboard" subtitle="Running initiatives grouped by who they are waiting on.">{data.loading ? <StateBox title="Loading Workboard">Fetching current initiative states.</StateBox> : data.error ? <StateBox title="Could not load Workboard" retry={data.reload}>{data.error}</StateBox> : <div className="board">{lanes.map(([label, initiatives]) => <section className="lane" key={label}><header className="lane-header"><h2>{label}</h2><span>{initiatives.length}</span></header><div className="lane-body">{initiatives.length ? initiatives.map((initiative) => <InitiativeCard initiative={initiative} key={initiative.id} />) : <div className="lane-empty">No initiatives</div>}</div></section>)}</div>}</PageHeader>;
}

function InitiativeCard({ initiative }: { initiative: Initiative }) { return <a className="work-card" href={`#initiative/${initiative.id}`}><h3>{initiative.title}</h3><p><span>Intent</span>{initiative.intent}</p><p><span>Next</span>{initiative.next_step ?? "No next step recorded"}</p><footer><Badge tone={initiative.status}>{displayStatus(initiative.status)}</Badge><span>{formatDate(initiative.last_activity_at)}</span></footer></a>; }

function DecisionsPage({ api }: { api: ThreadlineApi }) {
  const data = useLoad(() => Promise.all([api.decisions(), api.initiatives()]), [api]);
  const [filter, setFilter] = useState("all");
  const [decisions, initiatives] = data.value ?? [[], []] as [Decision[], Initiative[]];
  const initiativeNames = new Map(initiatives.map((item) => [item.id, item.title]));
  const visible = decisions.filter((decision) => filter === "all" || (filter === "open" ? ["open", "seen"].includes(decision.status) : decision.status === "resolved"));
  return <PageHeader title="Decision Registry" subtitle="Open and closed decisions with risk, source session, and resolution."><div className="toolbar"><div className="filter-group">{["all", "open", "resolved"].map((value) => <button key={value} className={`btn btn-sm ${filter === value ? "btn-primary" : "btn-secondary"}`} onClick={() => setFilter(value)}>{titleCase(value)}</button>)}</div></div>{data.loading ? <StateBox title="Loading decisions">Fetching the registry.</StateBox> : data.error ? <StateBox title="Could not load decisions" retry={data.reload}>{data.error}</StateBox> : !visible.length ? <StateBox title="No decisions here">{filter === "open" ? "There are no decisions waiting to close." : "Decisions created by Agents will appear here."}</StateBox> : <div className="table-wrap"><table className="data-table"><caption className="sr-only">Decision Registry</caption><thead><tr><th>Question</th><th>Options</th><th>Risk</th><th>Initiative</th><th>Status</th><th /></tr></thead><tbody>{visible.map((decision) => <tr key={decision.id}><td className="cell-primary">{decision.question}</td><td className="cell-secondary">{decision.options?.join(" / ") ?? "-"}</td><td><Badge tone={decision.risk_level}>{decision.risk_level}</Badge></td><td className="cell-secondary">{decision.initiative_id ? initiativeNames.get(decision.initiative_id) ?? decision.initiative_id : "-"}</td><td><Badge tone={decision.status}>{decision.status}</Badge></td><td><a className="btn btn-secondary btn-sm" href={`#decision/${decision.id}`}>{decision.status === "resolved" ? "View" : "Decide"}</a></td></tr>)}</tbody></table></div>}</PageHeader>;
}

function InitiativeDetail({ api, id }: { api: ThreadlineApi; id: string }) {
  const data = useLoad(() => Promise.all([api.initiative(id), api.submissions(id), api.decisions(), api.events("initiative", id)]), [api, id]);
  const [saving, setSaving] = useState(false);
  if (data.loading) return <StateBox title="Loading initiative">Fetching related work context.</StateBox>;
  if (data.error || !data.value) return <StateBox title="Could not load initiative" retry={data.reload}>{data.error}</StateBox>;
  const [initiative, submissions, allDecisions, events] = data.value;
  const decisions = allDecisions.filter((decision) => decision.initiative_id === id);
  const updateStatus = async (status: InitiativeStatus) => { setSaving(true); try { await api.updateInitiative(id, { status }); data.reload(); } finally { setSaving(false); } };
  return <PageHeader title={initiative.title} subtitle={`Initiative · ${displayStatus(initiative.status)}`} action={<a className="btn btn-secondary btn-sm" href="#workboard">Back to Workboard</a>}><div className="detail-grid"><section className="panel"><div className="panel-body"><DetailSection title="Intent"><p className="detail-copy">{initiative.intent}</p></DetailSection><DetailSection title="Next step"><p className="detail-copy">{initiative.next_step ?? "No next step recorded."}</p></DetailSection><DetailSection title="Submissions">{submissions.length ? <div className="linked-list">{submissions.map((submission) => <SubmissionRow key={submission.id} submission={submission} />)}</div> : <p className="text-muted">No submissions are linked yet.</p>}</DetailSection><DetailSection title="Decisions">{decisions.length ? <div className="linked-list">{decisions.map((decision) => <a href={`#decision/${decision.id}`} className="linked-row" key={decision.id}><div><strong>{decision.question}</strong><span>{decision.resolution ?? "Awaiting a decision"}</span></div><Badge tone={decision.status}>{decision.status}</Badge></a>)}</div> : <p className="text-muted">No decisions are linked yet.</p>}</DetailSection><DetailSection title="Activity"><Timeline events={events} /></DetailSection></div></section><aside className="panel"><div className="panel-header"><h2>Properties</h2></div><div className="panel-body"><div className="field"><label htmlFor="initiative-status">Status</label><select id="initiative-status" value={initiative.status} disabled={saving} onChange={(event) => void updateStatus(event.target.value as InitiativeStatus)}>{["active", "waiting_for_jim", "waiting_for_agent", "paused", "completed", "cancelled"].map((value) => <option value={value} key={value}>{displayStatus(value)}</option>)}</select></div><Properties rows={[["ID", initiative.id], ["Created by", initiative.created_by], ["Last activity", formatDate(initiative.last_activity_at)], ["Created", formatDate(initiative.created_at)]]} /></div></aside></div></PageHeader>;
}

function DecisionDetail({ api, id }: { api: ThreadlineApi; id: string }) {
  const data = useLoad(() => Promise.all([api.decision(id), api.submissions(), api.initiatives(), api.events("decision", id)]), [api, id]);
  const [outcome, setOutcome] = useState("");
  const [saving, setSaving] = useState(false);
  if (data.loading) return <StateBox title="Loading decision">Fetching the decision and its audit trail.</StateBox>;
  if (data.error || !data.value) return <StateBox title="Could not load decision" retry={data.reload}>{data.error}</StateBox>;
  const [decision, submissions, initiatives, events] = data.value;
  const submission = submissions.find((item) => item.id === decision.submission_id);
  const initiative = initiatives.find((item) => item.id === decision.initiative_id);
  const resolve = async (event: FormEvent) => { event.preventDefault(); if (!outcome.trim()) return; setSaving(true); try { await api.resolveDecision(id, outcome.trim()); data.reload(); } finally { setSaving(false); } };
  return <PageHeader title={decision.question} subtitle={`Decision · ${titleCase(decision.status)} · ${titleCase(decision.risk_level)} risk`} action={<a className="btn btn-secondary btn-sm" href="#decisions">Back to registry</a>}><div className="detail-grid"><section className="panel"><div className="panel-body"><DetailSection title="Question"><p className="detail-copy">{decision.question}</p></DetailSection><DetailSection title="Options">{decision.options?.length ? <ul className="option-list">{decision.options.map((option) => <li key={option}>{option}</li>)}</ul> : <p className="text-muted">No preset options were provided.</p>}</DetailSection>{decision.status !== "resolved" ? <DetailSection title="Close decision"><form onSubmit={resolve} className="resolve-form"><label htmlFor="outcome">Outcome</label><textarea id="outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} rows={4} placeholder="Record the decision and the reason for it." required /><p>Closing this writes the same semantic event an Agent would produce via the CLI. The linked Inbox item will disappear.</p><button className="btn btn-primary" disabled={saving}>{saving ? "Resolving..." : "Close decision"}</button></form></DetailSection> : <DetailSection title="Resolution"><p className="resolution">{decision.resolution}</p><p className="text-muted">Resolved by {decision.resolved_by ?? "-"} via {decision.resolved_via ?? "-"} · {formatDate(decision.resolved_at)}</p></DetailSection>}<DetailSection title="Audit trail"><Timeline events={events} /></DetailSection></div></section><aside className="panel"><div className="panel-header"><h2>Properties</h2></div><div className="panel-body"><Properties rows={[["ID", decision.id], ["Status", <Badge tone={decision.status}>{decision.status}</Badge>], ["Risk", <Badge tone={decision.risk_level}>{decision.risk_level}</Badge>], ["Runtime", submission?.runtime ?? submission?.source ?? "-"], ["Agent", submission?.agent ?? "-"], ["Session", <CopyValue value={submission?.session_id ?? null} />], ["Initiative", initiative ? <a href={`#initiative/${initiative.id}`}>{initiative.title}</a> : "-"], ["Created", formatDate(decision.created_at)]]} /></div></aside></div></PageHeader>;
}

function SubmissionDetail({ api, id }: { api: ThreadlineApi; id: string }) {
  const data = useLoad(() => Promise.all([api.submission(id), api.events("submission", id)]), [api, id]);
  if (data.loading) return <StateBox title="Loading submission">Fetching the submitted work.</StateBox>;
  if (data.error || !data.value) return <StateBox title="Could not load submission" retry={data.reload}>{data.error}</StateBox>;
  const [submission, events] = data.value;
  return <PageHeader title={submission.title} subtitle={`${titleCase(submission.kind)} · ${titleCase(submission.attention_policy)}`} action={<a className="btn btn-secondary btn-sm" href="#inbox">Back to Inbox</a>}><div className="detail-grid"><section className="panel"><div className="panel-body"><DetailSection title="Summary"><p className="detail-copy">{submission.summary}</p></DetailSection><DetailSection title="Details">{submission.detail ? <p className="detail-copy submission-detail">{submission.detail}</p> : <p className="text-muted">No additional detail was provided.</p>}</DetailSection>{submission.detail_ref && <DetailSection title="Reference"><a href={submission.detail_ref} target="_blank" rel="noreferrer">Open submitted reference</a></DetailSection>}<DetailSection title="Audit trail"><Timeline events={events} /></DetailSection></div></section><aside className="panel"><div className="panel-header"><h2>Properties</h2></div><div className="panel-body"><Properties rows={[["ID", submission.id], ["Kind", <Badge tone={submission.kind}>{titleCase(submission.kind)}</Badge>], ["Attention", titleCase(submission.attention_policy)], ["Source", submission.source], ["Runtime", submission.runtime ?? "-"], ["Agent", submission.agent ?? "-"], ["Session", <CopyValue value={submission.session_id} />], ["Initiative", submission.initiative_id ? <a href={`#initiative/${submission.initiative_id}`}>View linked initiative</a> : "-"], ["Observed", formatDate(submission.observed_at)], ["Created", formatDate(submission.created_at)]]} /></div></aside></div></PageHeader>;
}

function SubmissionRow({ submission }: { submission: Submission }) { return <a className="linked-row" href={`#submission/${submission.id}`}><div><strong>{submission.title}</strong><span>{submission.summary}</span></div><Badge tone={submission.kind}>{titleCase(submission.kind)}</Badge></a>; }
function Timeline({ events }: { events: AuditEvent[] }) { return events.length ? <ol className="timeline">{events.map((event, index) => <li className={index === events.length - 1 ? "active" : ""} key={event.id}><time>{formatDate(event.created_at)}</time><strong>{titleCase(event.event_type.replace(".", " "))}</strong><span>{event.actor_name}{event.runtime ? ` · ${event.runtime}` : ""}{event.session_id ? ` · ${event.session_id}` : ""}</span></li>)}</ol> : <p className="text-muted">No activity has been recorded yet.</p>; }
function Properties({ rows }: { rows: Array<[string, ReactNode]> }) { return <dl className="properties">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>; }
function DetailSection({ title, children }: { title: string; children: ReactNode }) { return <section className="panel-section"><h2>{title}</h2>{children}</section>; }
function PageHeader({ title, subtitle, action, children }: { title: string; subtitle: string; action?: ReactNode; children: ReactNode }) { return <><div className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div><div className="content">{children}</div></>; }

function ConnectionDialog({ current, onClose, onSave }: { current: Connection; onClose: () => void; onSave: (connection: Connection) => void }) { const [url, setUrl] = useState(current.url); const [token, setToken] = useState(current.token); return <Dialog title="Gateway connection" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); onSave({ url: url.trim(), token: token.trim() }); }}><div className="field"><label htmlFor="gateway-url">Gateway URL</label><input id="gateway-url" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://gateway.example.com" /></div><div className="field"><label htmlFor="gateway-token">Instance token</label><input id="gateway-token" type="password" required value={token} onChange={(event) => setToken(event.target.value)} placeholder="Bearer token" /><p className="field-help">Stored only in this browser on this device.</p></div><div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary">Save connection</button></div></form></Dialog>; }
function NewInitiativeDialog({ api, onClose }: { api: ThreadlineApi; onClose: () => void }) { const [title, setTitle] = useState(""); const [intent, setIntent] = useState(""); const [nextStep, setNextStep] = useState(""); const [saving, setSaving] = useState(false); const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); try { const initiative = await api.createInitiative({ title, intent, status: "active", next_step: nextStep || null }); onClose(); navigate(`initiative/${initiative.id}`); } finally { setSaving(false); } }; return <Dialog title="New initiative" onClose={onClose}><form onSubmit={submit}><div className="modal-body"><div className="field"><label htmlFor="initiative-title">Title</label><input id="initiative-title" required value={title} onChange={(event) => setTitle(event.target.value)} /></div><div className="field"><label htmlFor="initiative-intent">Intent</label><textarea id="initiative-intent" rows={4} required value={intent} onChange={(event) => setIntent(event.target.value)} /></div><div className="field"><label htmlFor="initiative-next">Next step</label><input id="initiative-next" value={nextStep} onChange={(event) => setNextStep(event.target.value)} /></div></div><div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? "Creating..." : "Create initiative"}</button></div></form></Dialog>; }
function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) { return <div className="modal-backdrop open" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><h2>{title}</h2><button className="btn-icon" title="Close" onClick={onClose}><X /></button></header>{children}</section></div>; }

createRoot(document.getElementById("root")!).render(<App />);
