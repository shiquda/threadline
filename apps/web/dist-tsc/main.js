import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Archive, Check, ChevronRight, ClipboardList, Clock3, Copy, Inbox, LayoutDashboard, Menu, Network, Plus, RefreshCw, Scale, Settings2, X, } from "lucide-react";
import { ThreadlineApi, readConnection, writeConnection } from "./api.js";
import "./styles.css";
function routeFromHash() {
    const [page, id] = window.location.hash.replace(/^#\/?/, "").split("/");
    if (page === "initiative" && id)
        return { page: "initiative", id };
    if (page === "decision" && id)
        return { page: "decision", id };
    if (page && ["inbox", "workboard", "decisions"].includes(page))
        return { page: page };
    return { page: "overview" };
}
function navigate(route) { window.location.hash = route; }
function useLoad(load, keys) {
    const [state, setState] = useState({ value: null, loading: true, error: null });
    const reload = useCallback(() => {
        setState((last) => ({ ...last, loading: true, error: null }));
        void load().then((value) => setState({ value, loading: false, error: null })).catch((error) => {
            setState({ value: null, loading: false, error: error instanceof Error ? error.message : "Something went wrong." });
        });
        // The caller owns the stable dependency list.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, keys);
    useEffect(reload, [reload]);
    return { ...state, reload };
}
function formatDate(value) {
    if (!value)
        return "-";
    const time = new Date(value).getTime();
    const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
    if (minutes < 1)
        return "just now";
    if (minutes < 60)
        return `${minutes} min ago`;
    if (minutes < 1440)
        return `${Math.floor(minutes / 60)} h ago`;
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function titleCase(value) { return value.replaceAll("_", " "); }
function badgeClass(value) {
    if (["high", "interrupt", "alert"].includes(value))
        return "urgent";
    if (["medium", "waiting_for_jim", "open"].includes(value))
        return "warn";
    if (["resolved", "completed", "active"].includes(value))
        return "success";
    if (["decision_request", "decision"].includes(value))
        return "decision";
    return "info";
}
function Badge({ children, tone }) {
    return _jsx("span", { className: `badge badge-${badgeClass(tone ?? String(children))}`, children: children });
}
function StateBox({ title, children, retry }) {
    return _jsxs("div", { className: "state-box", children: [_jsx(Network, { "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("div", { className: "state-title", children: title }), _jsx("p", { children: children })] }), retry && _jsxs("button", { className: "btn btn-secondary btn-sm", onClick: retry, children: [_jsx(RefreshCw, { size: 15 }), "Try again"] })] });
}
function CopyValue({ value }) {
    const [copied, setCopied] = useState(false);
    if (!value)
        return _jsx("span", { children: "-" });
    return _jsxs("button", { className: "copy-value", title: "Copy session ID", onClick: () => void navigator.clipboard.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1400); }), children: [copied ? "Copied" : value, _jsx(Copy, { size: 13 })] });
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
    const pageTitle = route.page === "overview" ? "Overview" : route.page === "initiative" ? "Initiative detail" : route.page === "decision" ? "Decision detail" : titleCase(route.page);
    const saveConnection = (next) => { writeConnection(next); setConnection(next); setShowConnection(false); };
    return _jsxs("div", { className: "app-shell", children: [_jsx(Sidebar, { route: route, open: mobileMenu, close: () => setMobileMenu(false) }), _jsxs("header", { className: "topbar", children: [_jsx("button", { className: "btn-icon mobile-menu-btn", title: "Open menu", onClick: () => setMobileMenu((open) => !open), children: _jsx(Menu, {}) }), _jsx("div", { className: "topbar-title", children: pageTitle }), _jsxs("div", { className: "topbar-actions", children: [_jsxs("button", { className: "btn btn-secondary btn-sm desktop-only", onClick: () => setShowNewInitiative(true), children: [_jsx(Plus, { size: 16 }), "New initiative"] }), _jsx("button", { className: "btn-icon", title: "Gateway connection", onClick: () => setShowConnection(true), children: _jsx(Settings2, {}) }), _jsxs("div", { className: "user-chip", children: [_jsx("span", { className: "avatar", children: "J" }), "Jim"] })] })] }), _jsxs("main", { className: "main", children: [route.page === "overview" && _jsx(Overview, { api: api, onNew: () => setShowNewInitiative(true) }), route.page === "inbox" && _jsx(InboxPage, { api: api }), route.page === "workboard" && _jsx(WorkboardPage, { api: api }), route.page === "decisions" && _jsx(DecisionsPage, { api: api }), route.page === "initiative" && route.id && _jsx(InitiativeDetail, { api: api, id: route.id }), route.page === "decision" && route.id && _jsx(DecisionDetail, { api: api, id: route.id })] }), showConnection && _jsx(ConnectionDialog, { current: connection, onClose: () => setShowConnection(false), onSave: saveConnection }), showNewInitiative && _jsx(NewInitiativeDialog, { api: api, onClose: () => setShowNewInitiative(false) })] });
}
function Sidebar({ route, open, close }) {
    const links = [
        ["overview", "Overview", LayoutDashboard], ["inbox", "Inbox", Inbox], ["workboard", "Workboard", ClipboardList], ["decisions", "Decisions", Scale],
    ];
    return _jsxs("aside", { className: `sidebar ${open ? "open" : ""}`, children: [_jsxs("div", { className: "wordmark", children: [_jsx("span", { className: "wordmark-dot" }), "Threadline"] }), _jsx("nav", { "aria-label": "Primary", children: _jsx("ul", { className: "nav-list", children: links.map(([page, label, Icon]) => _jsx("li", { children: _jsxs("a", { className: `nav-link ${route.page === page ? "active" : ""}`, href: `#${page}`, onClick: close, children: [_jsx(Icon, { size: 18 }), label] }) }, page)) }) }), _jsxs("div", { className: "sidebar-note", children: ["Shared work context", _jsx("br", {}), "for humans and agents."] })] });
}
function Overview({ api, onNew }) {
    const data = useLoad(() => Promise.all([api.inbox(), api.workboard(), api.decisions()]), [api]);
    const [inbox, board, decisions] = data.value ?? [[], null, []];
    const initiatives = board ? Object.values(board).flat().length : 0;
    const open = decisions.filter((decision) => ["open", "seen"].includes(decision.status)).length;
    return _jsx(PageHeader, { title: "Threadline", subtitle: "Human-Agent Gateway workbench - your shared source of attention and decisions.", action: _jsxs("button", { className: "btn btn-primary", onClick: onNew, children: [_jsx(Plus, { size: 17 }), "New initiative"] }), children: data.loading ? _jsx(StateBox, { title: "Loading workspace", children: "Fetching the current work context." }) : data.error ? _jsx(StateBox, { title: "Could not load workspace", retry: data.reload, children: data.error }) : _jsxs(_Fragment, { children: [_jsxs("section", { className: "overview-metrics", "aria-label": "Workspace summary", children: [_jsx(Metric, { label: "Active notifications", value: `${inbox.length} need attention`, href: "#inbox" }), _jsx(Metric, { label: "Running initiatives", value: `${initiatives} on the Workboard`, href: "#workboard" }), _jsx(Metric, { label: "Open decisions", value: `${open} waiting to close`, href: "#decisions" })] }), _jsxs("section", { className: "overview-section", children: [_jsxs("div", { className: "section-heading", children: [_jsx("h2", { children: "Needs attention" }), _jsxs("a", { href: "#inbox", children: ["Open Inbox ", _jsx(ChevronRight, { size: 16 })] })] }), inbox.length ? _jsx("div", { className: "mini-list", children: inbox.slice(0, 3).map((item) => _jsx(MiniInboxItem, { item: item }, item.notification.id)) }) : _jsx(StateBox, { title: "Inbox is clear", children: "New decisions, deliveries, and alerts will appear here." })] })] }) });
}
function Metric({ label, value, href }) { return _jsxs("a", { className: "metric", href: href, children: [_jsx("span", { children: label }), _jsx("strong", { children: value }), _jsx(ChevronRight, { size: 18 })] }); }
function MiniInboxItem({ item }) { return _jsxs("a", { className: "mini-inbox", href: item.decision ? `#decision/${item.decision.id}` : "#inbox", children: [_jsx(Badge, { tone: item.decision ? "decision" : item.submission.kind, children: titleCase(item.decision ? "decision" : item.submission.kind) }), _jsxs("div", { children: [_jsx("strong", { children: item.submission.title }), _jsxs("span", { children: [item.submission.runtime ?? item.submission.source, " \u00B7 ", formatDate(item.submission.created_at)] })] }), _jsx(ChevronRight, { size: 17 })] }); }
function InboxPage({ api }) {
    const data = useLoad(() => api.inbox(), [api]);
    const [filter, setFilter] = useState("all");
    const [query, setQuery] = useState("");
    const [pending, setPending] = useState(null);
    const handleAction = async (item, action) => { setPending(`${item.notification.id}:${action}`); try {
        await api.updateNotification(item.notification.id, action);
        data.reload();
    }
    finally {
        setPending(null);
    } };
    const visible = (data.value ?? []).filter((item) => {
        const kind = item.decision ? "decision" : item.submission.kind;
        const matchFilter = filter === "all" || kind === filter;
        const haystack = `${item.submission.title} ${item.submission.summary} ${item.submission.runtime ?? ""} ${item.submission.agent ?? ""} ${item.submission.session_id ?? ""}`.toLowerCase();
        return matchFilter && haystack.includes(query.toLowerCase());
    });
    return _jsxs(PageHeader, { title: "Inbox", subtitle: "Only things that need your attention right now.", action: _jsx("button", { className: "btn btn-secondary btn-sm", disabled: !data.value?.length, onClick: () => Promise.all((data.value ?? []).map((item) => api.updateNotification(item.notification.id, "read"))).then(data.reload), children: "Mark all read" }), children: [_jsxs("div", { className: "toolbar", children: [_jsx("input", { className: "search-input", type: "search", value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Search runtime, agent, session...", "aria-label": "Search inbox" }), _jsx("div", { className: "filter-group", children: ["all", "decision", "delivery", "alert"].map((value) => _jsx("button", { className: `btn btn-sm ${filter === value ? "btn-secondary" : "btn-ghost"}`, onClick: () => setFilter(value), children: titleCase(value) }, value)) })] }), data.loading ? _jsx(StateBox, { title: "Loading Inbox", children: "Fetching current notifications." }) : data.error ? _jsx(StateBox, { title: "Could not load Inbox", retry: data.reload, children: data.error }) : !visible.length ? _jsx(StateBox, { title: query || filter !== "all" ? "No matching notifications" : "Inbox is clear", children: query || filter !== "all" ? "Try a different search or filter." : "New attention-worthy work will appear here." }) : _jsx("div", { className: "inbox-list", children: visible.map((item) => _jsxs("article", { className: `inbox-item ${item.notification.status === "active" ? "unread" : ""}`, children: [_jsx("div", { className: "item-kind", children: _jsx(Badge, { tone: item.decision ? "decision" : item.submission.kind, children: titleCase(item.decision ? "decision" : item.submission.kind) }) }), _jsxs("div", { className: "item-main", children: [_jsx("div", { className: "item-title", children: item.submission.title }), _jsx("div", { className: "item-summary", children: item.submission.summary }), _jsxs("div", { className: "item-meta-row", children: [item.decision && _jsx(Badge, { tone: item.decision.risk_level, children: item.decision.status === "resolved" ? "resolved" : "decision needed" }), _jsxs("span", { children: ["Runtime: ", _jsx("strong", { children: item.submission.runtime ?? item.submission.source })] }), item.submission.agent && _jsxs("span", { children: ["Agent: ", _jsx("strong", { children: item.submission.agent })] }), _jsx(CopyValue, { value: item.submission.session_id }), item.initiative && _jsxs("a", { href: `#initiative/${item.initiative.id}`, children: ["Initiative: ", _jsx("strong", { children: item.initiative.title })] }), _jsx("span", { children: formatDate(item.submission.created_at) })] })] }), _jsxs("div", { className: "item-actions", children: [_jsx(IconAction, { label: "Mark read", disabled: pending === `${item.notification.id}:read`, onClick: () => void handleAction(item, "read"), children: _jsx(Check, {}) }), _jsx(IconAction, { label: "Snooze one day", disabled: pending === `${item.notification.id}:snooze`, onClick: () => void handleAction(item, "snooze"), children: _jsx(Clock3, {}) }), _jsx(IconAction, { label: "Archive", disabled: pending === `${item.notification.id}:archive`, onClick: () => void handleAction(item, "archive"), children: _jsx(Archive, {}) }), _jsx("a", { className: "btn btn-secondary btn-sm", href: item.decision ? `#decision/${item.decision.id}` : item.initiative ? `#initiative/${item.initiative.id}` : "#inbox", children: item.decision ? "Decide" : "View" })] })] }, item.notification.id)) })] });
}
function IconAction({ label, children, ...props }) { return _jsx("button", { className: "btn-icon", title: label, "aria-label": label, ...props, children: children }); }
function WorkboardPage({ api }) {
    const data = useLoad(() => api.workboard(), [api]);
    const lanes = data.value ? [["In progress", data.value.active], ["Waiting for Jim", data.value.waiting_for_jim], ["Waiting for Agent", data.value.waiting_for_agent], ["Paused / done", data.value.paused_or_done]] : [];
    return _jsx(PageHeader, { title: "Workboard", subtitle: "Running initiatives grouped by who they are waiting on.", children: data.loading ? _jsx(StateBox, { title: "Loading Workboard", children: "Fetching current initiative states." }) : data.error ? _jsx(StateBox, { title: "Could not load Workboard", retry: data.reload, children: data.error }) : _jsx("div", { className: "board", children: lanes.map(([label, initiatives]) => _jsxs("section", { className: "lane", children: [_jsxs("header", { className: "lane-header", children: [_jsx("h2", { children: label }), _jsx("span", { children: initiatives.length })] }), _jsx("div", { className: "lane-body", children: initiatives.length ? initiatives.map((initiative) => _jsx(InitiativeCard, { initiative: initiative }, initiative.id)) : _jsx("div", { className: "lane-empty", children: "No initiatives" }) })] }, label)) }) });
}
function InitiativeCard({ initiative }) { return _jsxs("a", { className: "work-card", href: `#initiative/${initiative.id}`, children: [_jsx("h3", { children: initiative.title }), _jsxs("p", { children: [_jsx("span", { children: "Intent" }), initiative.intent] }), _jsxs("p", { children: [_jsx("span", { children: "Next" }), initiative.next_step ?? "No next step recorded"] }), _jsxs("footer", { children: [_jsx(Badge, { tone: initiative.status, children: titleCase(initiative.status) }), _jsx("span", { children: formatDate(initiative.last_activity_at) })] })] }); }
function DecisionsPage({ api }) {
    const data = useLoad(() => Promise.all([api.decisions(), api.initiatives()]), [api]);
    const [filter, setFilter] = useState("all");
    const [decisions, initiatives] = data.value ?? [[], []];
    const initiativeNames = new Map(initiatives.map((item) => [item.id, item.title]));
    const visible = decisions.filter((decision) => filter === "all" || (filter === "open" ? ["open", "seen"].includes(decision.status) : decision.status === "resolved"));
    return _jsxs(PageHeader, { title: "Decision Registry", subtitle: "Open and closed decisions with risk, source session, and resolution.", children: [_jsx("div", { className: "toolbar", children: _jsx("div", { className: "filter-group", children: ["all", "open", "resolved"].map((value) => _jsx("button", { className: `btn btn-sm ${filter === value ? "btn-primary" : "btn-secondary"}`, onClick: () => setFilter(value), children: titleCase(value) }, value)) }) }), data.loading ? _jsx(StateBox, { title: "Loading decisions", children: "Fetching the registry." }) : data.error ? _jsx(StateBox, { title: "Could not load decisions", retry: data.reload, children: data.error }) : !visible.length ? _jsx(StateBox, { title: "No decisions here", children: filter === "open" ? "There are no decisions waiting to close." : "Decisions created by Agents will appear here." }) : _jsx("div", { className: "table-wrap", children: _jsxs("table", { className: "data-table", children: [_jsx("caption", { className: "sr-only", children: "Decision Registry" }), _jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Question" }), _jsx("th", { children: "Options" }), _jsx("th", { children: "Risk" }), _jsx("th", { children: "Initiative" }), _jsx("th", { children: "Status" }), _jsx("th", {})] }) }), _jsx("tbody", { children: visible.map((decision) => _jsxs("tr", { children: [_jsx("td", { className: "cell-primary", children: decision.question }), _jsx("td", { className: "cell-secondary", children: decision.options?.join(" / ") ?? "-" }), _jsx("td", { children: _jsx(Badge, { tone: decision.risk_level, children: decision.risk_level }) }), _jsx("td", { className: "cell-secondary", children: decision.initiative_id ? initiativeNames.get(decision.initiative_id) ?? decision.initiative_id : "-" }), _jsx("td", { children: _jsx(Badge, { tone: decision.status, children: decision.status }) }), _jsx("td", { children: _jsx("a", { className: "btn btn-secondary btn-sm", href: `#decision/${decision.id}`, children: decision.status === "resolved" ? "View" : "Decide" }) })] }, decision.id)) })] }) })] });
}
function InitiativeDetail({ api, id }) {
    const data = useLoad(() => Promise.all([api.initiative(id), api.submissions(id), api.decisions(), api.events("initiative", id)]), [api, id]);
    const [saving, setSaving] = useState(false);
    if (data.loading)
        return _jsx(StateBox, { title: "Loading initiative", children: "Fetching related work context." });
    if (data.error || !data.value)
        return _jsx(StateBox, { title: "Could not load initiative", retry: data.reload, children: data.error });
    const [initiative, submissions, allDecisions, events] = data.value;
    const decisions = allDecisions.filter((decision) => decision.initiative_id === id);
    const updateStatus = async (status) => { setSaving(true); try {
        await api.updateInitiative(id, { status });
        data.reload();
    }
    finally {
        setSaving(false);
    } };
    return _jsx(PageHeader, { title: initiative.title, subtitle: `Initiative · ${titleCase(initiative.status)}`, action: _jsx("a", { className: "btn btn-secondary btn-sm", href: "#workboard", children: "Back to Workboard" }), children: _jsxs("div", { className: "detail-grid", children: [_jsx("section", { className: "panel", children: _jsxs("div", { className: "panel-body", children: [_jsx(DetailSection, { title: "Intent", children: _jsx("p", { className: "detail-copy", children: initiative.intent }) }), _jsx(DetailSection, { title: "Next step", children: _jsx("p", { className: "detail-copy", children: initiative.next_step ?? "No next step recorded." }) }), _jsx(DetailSection, { title: "Submissions", children: submissions.length ? _jsx("div", { className: "linked-list", children: submissions.map((submission) => _jsx(SubmissionRow, { submission: submission }, submission.id)) }) : _jsx("p", { className: "text-muted", children: "No submissions are linked yet." }) }), _jsx(DetailSection, { title: "Decisions", children: decisions.length ? _jsx("div", { className: "linked-list", children: decisions.map((decision) => _jsxs("a", { href: `#decision/${decision.id}`, className: "linked-row", children: [_jsxs("div", { children: [_jsx("strong", { children: decision.question }), _jsx("span", { children: decision.resolution ?? "Awaiting a decision" })] }), _jsx(Badge, { tone: decision.status, children: decision.status })] }, decision.id)) }) : _jsx("p", { className: "text-muted", children: "No decisions are linked yet." }) }), _jsx(DetailSection, { title: "Activity", children: _jsx(Timeline, { events: events }) })] }) }), _jsxs("aside", { className: "panel", children: [_jsx("div", { className: "panel-header", children: _jsx("h2", { children: "Properties" }) }), _jsxs("div", { className: "panel-body", children: [_jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "initiative-status", children: "Status" }), _jsx("select", { id: "initiative-status", value: initiative.status, disabled: saving, onChange: (event) => void updateStatus(event.target.value), children: ["active", "waiting_for_jim", "waiting_for_agent", "paused", "completed", "cancelled"].map((value) => _jsx("option", { value: value, children: titleCase(value) }, value)) })] }), _jsx(Properties, { rows: [["ID", initiative.id], ["Created by", initiative.created_by], ["Last activity", formatDate(initiative.last_activity_at)], ["Created", formatDate(initiative.created_at)]] })] })] })] }) });
}
function DecisionDetail({ api, id }) {
    const data = useLoad(() => Promise.all([api.decision(id), api.submissions(), api.initiatives(), api.events("decision", id)]), [api, id]);
    const [outcome, setOutcome] = useState("");
    const [saving, setSaving] = useState(false);
    if (data.loading)
        return _jsx(StateBox, { title: "Loading decision", children: "Fetching the decision and its audit trail." });
    if (data.error || !data.value)
        return _jsx(StateBox, { title: "Could not load decision", retry: data.reload, children: data.error });
    const [decision, submissions, initiatives, events] = data.value;
    const submission = submissions.find((item) => item.id === decision.submission_id);
    const initiative = initiatives.find((item) => item.id === decision.initiative_id);
    const resolve = async (event) => { event.preventDefault(); if (!outcome.trim())
        return; setSaving(true); try {
        await api.resolveDecision(id, outcome.trim());
        data.reload();
    }
    finally {
        setSaving(false);
    } };
    return _jsx(PageHeader, { title: decision.question, subtitle: `Decision · ${titleCase(decision.status)} · ${titleCase(decision.risk_level)} risk`, action: _jsx("a", { className: "btn btn-secondary btn-sm", href: "#decisions", children: "Back to registry" }), children: _jsxs("div", { className: "detail-grid", children: [_jsx("section", { className: "panel", children: _jsxs("div", { className: "panel-body", children: [_jsx(DetailSection, { title: "Question", children: _jsx("p", { className: "detail-copy", children: decision.question }) }), _jsx(DetailSection, { title: "Options", children: decision.options?.length ? _jsx("ul", { className: "option-list", children: decision.options.map((option) => _jsx("li", { children: option }, option)) }) : _jsx("p", { className: "text-muted", children: "No preset options were provided." }) }), decision.status !== "resolved" ? _jsx(DetailSection, { title: "Close decision", children: _jsxs("form", { onSubmit: resolve, className: "resolve-form", children: [_jsx("label", { htmlFor: "outcome", children: "Outcome" }), _jsx("textarea", { id: "outcome", value: outcome, onChange: (event) => setOutcome(event.target.value), rows: 4, placeholder: "Record the decision and the reason for it.", required: true }), _jsx("p", { children: "Closing this writes the same semantic event an Agent would produce via the CLI. The linked Inbox item will disappear." }), _jsx("button", { className: "btn btn-primary", disabled: saving, children: saving ? "Resolving..." : "Close decision" })] }) }) : _jsxs(DetailSection, { title: "Resolution", children: [_jsx("p", { className: "resolution", children: decision.resolution }), _jsxs("p", { className: "text-muted", children: ["Resolved by ", decision.resolved_by ?? "-", " via ", decision.resolved_via ?? "-", " \u00B7 ", formatDate(decision.resolved_at)] })] }), _jsx(DetailSection, { title: "Audit trail", children: _jsx(Timeline, { events: events }) })] }) }), _jsxs("aside", { className: "panel", children: [_jsx("div", { className: "panel-header", children: _jsx("h2", { children: "Properties" }) }), _jsx("div", { className: "panel-body", children: _jsx(Properties, { rows: [["ID", decision.id], ["Status", _jsx(Badge, { tone: decision.status, children: decision.status })], ["Risk", _jsx(Badge, { tone: decision.risk_level, children: decision.risk_level })], ["Runtime", submission?.runtime ?? submission?.source ?? "-"], ["Agent", submission?.agent ?? "-"], ["Session", _jsx(CopyValue, { value: submission?.session_id ?? null })], ["Initiative", initiative ? _jsx("a", { href: `#initiative/${initiative.id}`, children: initiative.title }) : "-"], ["Created", formatDate(decision.created_at)]] }) })] })] }) });
}
function SubmissionRow({ submission }) { return _jsxs("div", { className: "linked-row", children: [_jsxs("div", { children: [_jsx("strong", { children: submission.title }), _jsx("span", { children: submission.summary })] }), _jsx(Badge, { tone: submission.kind, children: titleCase(submission.kind) })] }); }
function Timeline({ events }) { return events.length ? _jsx("ol", { className: "timeline", children: events.map((event, index) => _jsxs("li", { className: index === events.length - 1 ? "active" : "", children: [_jsx("time", { children: formatDate(event.created_at) }), _jsx("strong", { children: titleCase(event.event_type.replace(".", " ")) }), _jsxs("span", { children: [event.actor_name, event.runtime ? ` · ${event.runtime}` : "", event.session_id ? ` · ${event.session_id}` : ""] })] }, event.id)) }) : _jsx("p", { className: "text-muted", children: "No activity has been recorded yet." }); }
function Properties({ rows }) { return _jsx("dl", { className: "properties", children: rows.map(([label, value]) => _jsxs("div", { children: [_jsx("dt", { children: label }), _jsx("dd", { children: value })] }, label)) }); }
function DetailSection({ title, children }) { return _jsxs("section", { className: "panel-section", children: [_jsx("h2", { children: title }), children] }); }
function PageHeader({ title, subtitle, action, children }) { return _jsxs(_Fragment, { children: [_jsxs("div", { className: "page-header", children: [_jsxs("div", { children: [_jsx("h1", { children: title }), _jsx("p", { children: subtitle })] }), action] }), _jsx("div", { className: "content", children: children })] }); }
function ConnectionDialog({ current, onClose, onSave }) { const [url, setUrl] = useState(current.url); const [token, setToken] = useState(current.token); return _jsx(Dialog, { title: "Gateway connection", onClose: onClose, children: _jsxs("form", { onSubmit: (event) => { event.preventDefault(); onSave({ url: url.trim(), token: token.trim() }); }, children: [_jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "gateway-url", children: "Gateway URL" }), _jsx("input", { id: "gateway-url", type: "url", required: true, value: url, onChange: (event) => setUrl(event.target.value), placeholder: "https://gateway.example.com" })] }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "gateway-token", children: "Instance token" }), _jsx("input", { id: "gateway-token", type: "password", required: true, value: token, onChange: (event) => setToken(event.target.value), placeholder: "Bearer token" }), _jsx("p", { className: "field-help", children: "Stored only in this browser on this device." })] }), _jsxs("div", { className: "modal-footer", children: [_jsx("button", { type: "button", className: "btn btn-secondary", onClick: onClose, children: "Cancel" }), _jsx("button", { className: "btn btn-primary", children: "Save connection" })] })] }) }); }
function NewInitiativeDialog({ api, onClose }) { const [title, setTitle] = useState(""); const [intent, setIntent] = useState(""); const [nextStep, setNextStep] = useState(""); const [saving, setSaving] = useState(false); const submit = async (event) => { event.preventDefault(); setSaving(true); try {
    const initiative = await api.createInitiative({ title, intent, status: "active", next_step: nextStep || null });
    onClose();
    navigate(`initiative/${initiative.id}`);
}
finally {
    setSaving(false);
} }; return _jsx(Dialog, { title: "New initiative", onClose: onClose, children: _jsxs("form", { onSubmit: submit, children: [_jsxs("div", { className: "modal-body", children: [_jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "initiative-title", children: "Title" }), _jsx("input", { id: "initiative-title", required: true, value: title, onChange: (event) => setTitle(event.target.value) })] }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "initiative-intent", children: "Intent" }), _jsx("textarea", { id: "initiative-intent", rows: 4, required: true, value: intent, onChange: (event) => setIntent(event.target.value) })] }), _jsxs("div", { className: "field", children: [_jsx("label", { htmlFor: "initiative-next", children: "Next step" }), _jsx("input", { id: "initiative-next", value: nextStep, onChange: (event) => setNextStep(event.target.value) })] })] }), _jsxs("div", { className: "modal-footer", children: [_jsx("button", { type: "button", className: "btn btn-secondary", onClick: onClose, children: "Cancel" }), _jsx("button", { className: "btn btn-primary", disabled: saving, children: saving ? "Creating..." : "Create initiative" })] })] }) }); }
function Dialog({ title, children, onClose }) { return _jsx("div", { className: "modal-backdrop open", role: "presentation", onMouseDown: (event) => { if (event.currentTarget === event.target)
        onClose(); }, children: _jsxs("section", { className: "modal", role: "dialog", "aria-modal": "true", "aria-label": title, children: [_jsxs("header", { className: "modal-header", children: [_jsx("h2", { children: title }), _jsx("button", { className: "btn-icon", title: "Close", onClick: onClose, children: _jsx(X, {}) })] }), children] }) }); }
createRoot(document.getElementById("root")).render(_jsx(App, {}));
//# sourceMappingURL=main.js.map