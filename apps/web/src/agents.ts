import type { Submission } from "@threadline/protocol";

export const UNKNOWN_HOST = "Unknown host";
export const UNKNOWN_TOOL = "Unknown tool";
export const UNKNOWN_SESSION = "No session recorded";

export type AgentSession = {
  session: string;
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

function canonicalSession(submission: Submission): string {
  return submission.session_id ?? UNKNOWN_SESSION;
}

function isUnknown(label: string): boolean {
  return label === UNKNOWN_HOST || label === UNKNOWN_TOOL || label === UNKNOWN_SESSION;
}

function latestCreatedAt(submissions: Submission[]): string {
  return submissions
    .map((submission) => submission.created_at)
    .sort((a, b) => b.localeCompare(a))[0] ?? "";
}

function compareByKnownThenName(a: string, b: string): number {
  const aUnknown = isUnknown(a) ? 1 : 0;
  const bUnknown = isUnknown(b) ? 1 : 0;
  if (aUnknown !== bUnknown) return aUnknown - bUnknown;
  return a.localeCompare(b);
}

function compareSessions(a: AgentSession, b: AgentSession): number {
  const aUnknown = isUnknown(a.session) ? 1 : 0;
  const bUnknown = isUnknown(b.session) ? 1 : 0;
  if (aUnknown !== bUnknown) return aUnknown - bUnknown;
  return latestCreatedAt(b.submissions).localeCompare(latestCreatedAt(a.submissions));
}

function compareTools(a: AgentTool, b: AgentTool): number {
  const aUnknown = isUnknown(a.tool) ? 1 : 0;
  const bUnknown = isUnknown(b.tool) ? 1 : 0;
  if (aUnknown !== bUnknown) return aUnknown - bUnknown;
  return a.tool.localeCompare(b.tool);
}

function compareHosts(a: AgentHost, b: AgentHost): number {
  const aUnknown = isUnknown(a.host) ? 1 : 0;
  const bUnknown = isUnknown(b.host) ? 1 : 0;
  if (aUnknown !== bUnknown) return aUnknown - bUnknown;
  return a.host.localeCompare(b.host);
}

/**
 * Group submissions by their canonical host/tool/session identity.
 *
 * The resulting tree is sorted so that known identities appear before unknown
 * ones, making operational scanning easier. Sessions are ordered by recency.
 */
export function groupSubmissionsByIdentity(submissions: Submission[]): AgentHost[] {
  const tree = new Map<string, Map<string, Map<string, Submission[]>>>();

  for (const submission of submissions) {
    const host = canonicalHost(submission);
    const tool = canonicalTool(submission);
    const session = canonicalSession(submission);

    const byTool = tree.get(host) ?? new Map<string, Map<string, Submission[]>>();
    const bySession = byTool.get(tool) ?? new Map<string, Submission[]>();
    bySession.set(session, [...(bySession.get(session) ?? []), submission]);
    byTool.set(tool, bySession);
    tree.set(host, byTool);
  }

  return [...tree.entries()]
    .map(([host, byTool]) => ({
      host,
      tools: [...byTool.entries()]
        .map(([tool, bySession]) => ({
          tool,
          sessions: [...bySession.entries()]
            .map(([session, items]) => ({ session, submissions: items.sort((a, b) => b.created_at.localeCompare(a.created_at)) }))
            .sort(compareSessions),
        }))
        .sort(compareTools),
    }))
    .sort(compareHosts);
}

export function selectedSessionRecords(
  groups: AgentHost[],
  host: string,
  tool: string,
  session: string,
): Submission[] | undefined {
  for (const hostNode of groups) {
    if (hostNode.host !== host) continue;
    for (const toolNode of hostNode.tools) {
      if (toolNode.tool !== tool) continue;
      for (const sessionNode of toolNode.sessions) {
        if (sessionNode.session === session) return sessionNode.submissions;
      }
    }
  }
  return undefined;
}

export function makeAgentsSessionRoute(host: string, tool: string, session: string): string {
  return `agents/${[host, tool, session].map(encodeURIComponent).join("/")}`;
}

export function parseAgentsSessionRoute(id: string): { host: string; tool: string; session: string } | null {
  const parts = id.split("/");
  if (parts.length !== 3) return null;
  return {
    host: decodeURIComponent(parts[0]!),
    tool: decodeURIComponent(parts[1]!),
    session: decodeURIComponent(parts[2]!),
  };
}
