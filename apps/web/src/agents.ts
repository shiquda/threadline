import type { Submission } from "@threadline/protocol";

export const UNKNOWN_HOST = "Unknown host";
export const UNKNOWN_TOOL = "Unknown tool";
export const UNKNOWN_SESSION = "No session recorded";

export type SessionScope =
  | { kind: "native"; id: string }
  | { kind: "unscoped" };

export type AgentScope =
  | { kind: "host"; host: string }
  | { kind: "tool"; host: string; tool: string }
  | { kind: "session"; host: string; tool: string; session: string }
  | { kind: "unscoped"; host: string; tool: string };

export type AgentSession = {
  scope: SessionScope;
  submissions: Submission[];
};

export type AgentTool = {
  tool: string;
  sessions: AgentSession[];
};

export type AgentHost = {
  host: string;
  tools: AgentTool[];
};

function canonicalHost(submission: Submission): string {
  return submission.host ?? UNKNOWN_HOST;
}

function canonicalTool(submission: Submission): string {
  return submission.tool ?? UNKNOWN_TOOL;
}

export function sessionScope(submission: Submission): SessionScope {
  const id = submission.session_id?.trim();
  return id ? { kind: "native", id: submission.session_id! } : { kind: "unscoped" };
}

export function sessionLabel(scope: SessionScope): string {
  return scope.kind === "native" ? scope.id : UNKNOWN_SESSION;
}

function compareSubmission(a: Submission, b: Submission): number {
  return b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
}

function latestCreatedAt(submissions: Submission[]): string {
  return submissions[0]?.created_at ?? "";
}

function compareKnownThenName(a: string, b: string): number {
  const aUnknown = a === UNKNOWN_HOST || a === UNKNOWN_TOOL;
  const bUnknown = b === UNKNOWN_HOST || b === UNKNOWN_TOOL;
  if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
  return a.localeCompare(b);
}

function compareSessions(a: AgentSession, b: AgentSession): number {
  if (a.scope.kind !== b.scope.kind) return a.scope.kind === "unscoped" ? 1 : -1;
  return latestCreatedAt(b.submissions).localeCompare(latestCreatedAt(a.submissions))
    || (a.scope.kind === "native" && b.scope.kind === "native" ? a.scope.id.localeCompare(b.scope.id) : 0);
}

/** Groups submissions by the full Host + Tool + native/unscoped identity. */
export function groupSubmissionsByIdentity(submissions: Submission[]): AgentHost[] {
  const tree = new Map<string, Map<string, Map<string, AgentSession>>>();

  for (const submission of submissions) {
    const host = canonicalHost(submission);
    const tool = canonicalTool(submission);
    const scope = sessionScope(submission);
    const key = scope.kind === "native" ? `native\0${scope.id}` : "unscoped";
    const byTool = tree.get(host) ?? new Map<string, Map<string, AgentSession>>();
    const bySession = byTool.get(tool) ?? new Map<string, AgentSession>();
    const entry = bySession.get(key) ?? { scope, submissions: [] };
    entry.submissions.push(submission);
    bySession.set(key, entry);
    byTool.set(tool, bySession);
    tree.set(host, byTool);
  }

  return [...tree.entries()]
    .map(([host, byTool]) => ({
      host,
      tools: [...byTool.entries()]
        .map(([tool, bySession]) => ({
          tool,
          sessions: [...bySession.values()]
            .map((entry) => ({ ...entry, submissions: entry.submissions.sort(compareSubmission) }))
            .sort(compareSessions),
        }))
        .sort((a, b) => compareKnownThenName(a.tool, b.tool)),
    }))
    .sort((a, b) => compareKnownThenName(a.host, b.host));
}

export function scopeRecords(groups: AgentHost[], scope: AgentScope): Submission[] | undefined {
  const host = groups.find((entry) => entry.host === scope.host);
  if (!host) return undefined;
  if (scope.kind === "host") return host.tools.flatMap((tool) => tool.sessions.flatMap((session) => session.submissions)).sort(compareSubmission);
  const tool = host.tools.find((entry) => entry.tool === scope.tool);
  if (!tool) return undefined;
  if (scope.kind === "tool") return tool.sessions.flatMap((session) => session.submissions).sort(compareSubmission);
  const target = tool.sessions.find((entry) =>
    scope.kind === "unscoped"
      ? entry.scope.kind === "unscoped"
      : entry.scope.kind === "native" && entry.scope.id === scope.session,
  );
  return target?.submissions;
}

export function makeAgentsHostRoute(host: string): string {
  return `agents/host/${encodeURIComponent(host)}`;
}

export function makeAgentsToolRoute(host: string, tool: string): string {
  return `agents/tool/${encodeURIComponent(host)}/${encodeURIComponent(tool)}`;
}

export function makeAgentsSessionRoute(host: string, tool: string, session: string): string {
  return `agents/session/${encodeURIComponent(host)}/${encodeURIComponent(tool)}/${encodeURIComponent(session)}`;
}

export function makeAgentsUnscopedRoute(host: string, tool: string): string {
  return `agents/unscoped/${encodeURIComponent(host)}/${encodeURIComponent(tool)}`;
}

function decode(parts: string[]): string[] | null {
  try {
    return parts.map(decodeURIComponent);
  } catch {
    return null;
  }
}

export function parseAgentsRoute(id: string): AgentScope | null {
  const raw = id.split("/");
  const parts = decode(raw);
  if (!parts) return null;
  if (parts[0] === "host" && parts.length === 2) return { kind: "host", host: parts[1]! };
  if (parts[0] === "tool" && parts.length === 3) return { kind: "tool", host: parts[1]!, tool: parts[2]! };
  if (parts[0] === "session" && parts.length === 4) return { kind: "session", host: parts[1]!, tool: parts[2]!, session: parts[3]! };
  if (parts[0] === "unscoped" && parts.length === 3) return { kind: "unscoped", host: parts[1]!, tool: parts[2]! };
  // Legacy #agents/<host>/<tool>/<session> URLs remain native-session routes.
  if (parts.length === 3) return { kind: "session", host: parts[0]!, tool: parts[1]!, session: parts[2]! };
  return null;
}
