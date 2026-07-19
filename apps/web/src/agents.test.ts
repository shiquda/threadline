import { describe, expect, it } from "vitest";
import {
  UNKNOWN_SESSION,
  groupSubmissionsByIdentity,
  makeAgentsHostRoute,
  makeAgentsSessionRoute,
  makeAgentsToolRoute,
  makeAgentsUnscopedRoute,
  parseAgentsRoute,
  scopeRecords,
} from "./agents.js";
import type { Submission } from "@threadline/protocol";

function submission(partial: Partial<Submission> & { id: string }): Submission {
  return {
    id: partial.id, kind: "delivery", title: partial.title ?? partial.id, summary: "summary", detail: null,
    detail_ref: null, content_language: "en", evidence_refs: [], initiative_id: null,
    attention_policy: "record_only", dedupe_key: null, host: partial.host ?? null, tool: partial.tool ?? null,
    source: "test", runtime: null, agent: null, session_id: partial.session_id ?? null, observed_at: null,
    created_at: partial.created_at ?? "2026-07-19T00:00:00.000Z", created_by: "test",
  };
}

describe("Agent identity grouping", () => {
  it("keeps native IDs distinct and groups blank IDs into one unscoped node per Host/Tool", () => {
    const groups = groupSubmissionsByIdentity([
      submission({ id: "native", host: "h", tool: "codex", session_id: "thr_1" }),
      submission({ id: "null", host: "h", tool: "codex" }),
      submission({ id: "blank", host: "h", tool: "codex", session_id: "  " }),
      submission({ id: "other-tool", host: "h", tool: "claude-code" }),
    ]);
    const codex = groups[0]!.tools.find((tool) => tool.tool === "codex")!;
    expect(codex.sessions.map((entry) => entry.scope.kind === "native" ? entry.scope.id : UNKNOWN_SESSION)).toEqual(["thr_1", UNKNOWN_SESSION]);
    expect(codex.sessions[1]?.submissions.map((entry) => entry.id)).toEqual(["null", "blank"]);
    expect(groups[0]!.tools.find((tool) => tool.tool === "claude-code")?.sessions).toHaveLength(1);
  });

  it("selects Host, Tool, native Session and unscoped scopes with a stable timeline", () => {
    const first = submission({ id: "a", host: "h", tool: "t", session_id: "s", created_at: "2026-07-19T00:00:00.000Z" });
    const second = submission({ id: "b", host: "h", tool: "t", created_at: "2026-07-19T00:00:00.000Z" });
    const third = submission({ id: "c", host: "h", tool: "other", session_id: "s" });
    const groups = groupSubmissionsByIdentity([first, second, third]);
    expect(scopeRecords(groups, { kind: "host", host: "h" })?.map((entry) => entry.id)).toEqual(["c", "b", "a"]);
    expect(scopeRecords(groups, { kind: "tool", host: "h", tool: "t" })?.map((entry) => entry.id)).toEqual(["b", "a"]);
    expect(scopeRecords(groups, { kind: "session", host: "h", tool: "t", session: "s" })).toEqual([first]);
    expect(scopeRecords(groups, { kind: "unscoped", host: "h", tool: "t" })).toEqual([second]);
  });
});

describe("Agent typed routes", () => {
  it("round-trips every scope and legacy session URLs", () => {
    expect(parseAgentsRoute(makeAgentsHostRoute("host/a").replace("agents/", ""))).toEqual({ kind: "host", host: "host/a" });
    expect(parseAgentsRoute(makeAgentsToolRoute("h", "tool a").replace("agents/", ""))).toEqual({ kind: "tool", host: "h", tool: "tool a" });
    expect(parseAgentsRoute(makeAgentsSessionRoute("h", "t", "s/a").replace("agents/", ""))).toEqual({ kind: "session", host: "h", tool: "t", session: "s/a" });
    expect(parseAgentsRoute(makeAgentsUnscopedRoute("h", "t").replace("agents/", ""))).toEqual({ kind: "unscoped", host: "h", tool: "t" });
    expect(parseAgentsRoute("h/t/s")).toEqual({ kind: "session", host: "h", tool: "t", session: "s" });
  });

  it("rejects malformed encoding and routes", () => {
    expect(parseAgentsRoute("session/h/t/%E0%A4%A")).toBeNull();
    expect(parseAgentsRoute("tool/h")).toBeNull();
  });
});
