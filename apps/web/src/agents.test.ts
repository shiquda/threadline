import { describe, expect, it } from "vitest";
import {
  UNKNOWN_HOST,
  UNKNOWN_SESSION,
  UNKNOWN_TOOL,
  groupSubmissionsByIdentity,
  makeAgentsSessionRoute,
  parseAgentsSessionRoute,
  selectedSessionRecords,
} from "./agents.js";
import type { Submission } from "@threadline/protocol";

function submission(partial: Partial<Submission> & { id: string }): Submission {
  return {
    id: partial.id,
    kind: "delivery",
    title: partial.title ?? `Submission ${partial.id}`,
    summary: partial.summary ?? "summary",
    detail: null,
    detail_ref: null,
    content_language: "en",
    evidence_refs: [],
    initiative_id: null,
    attention_policy: "record_only",
    dedupe_key: null,
    host: partial.host ?? null,
    tool: partial.tool ?? null,
    source: "test",
    runtime: null,
    agent: null,
    session_id: partial.session_id ?? null,
    observed_at: null,
    created_at: partial.created_at ?? "2026-07-19T00:00:00.000Z",
    created_by: "test",
  };
}

describe("groupSubmissionsByIdentity", () => {
  it("groups by canonical host, tool, and session", () => {
    const groups = groupSubmissionsByIdentity([
      submission({ id: "a", host: "h1", tool: "t1", session_id: "s1" }),
      submission({ id: "b", host: "h1", tool: "t1", session_id: "s2" }),
      submission({ id: "c", host: "h1", tool: "t2", session_id: "s1" }),
      submission({ id: "d", host: "h2", tool: "t1", session_id: "s1" }),
    ]);

    expect(groups.map((h) => h.host)).toEqual(["h1", "h2"]);
    expect(groups[0]?.tools.map((t) => t.tool)).toEqual(["t1", "t2"]);
    expect(groups[0]?.tools[0]?.sessions.map((s) => s.session)).toEqual(["s1", "s2"]);
  });

  it("uses unknown labels for missing identity fields", () => {
    const groups = groupSubmissionsByIdentity([submission({ id: "a" })]);
    expect(groups[0]?.host).toBe(UNKNOWN_HOST);
    expect(groups[0]?.tools[0]?.tool).toBe(UNKNOWN_TOOL);
    expect(groups[0]?.tools[0]?.sessions[0]?.session).toBe(UNKNOWN_SESSION);
  });

  it("sorts unknown hosts after known hosts", () => {
    const groups = groupSubmissionsByIdentity([
      submission({ id: "a", host: UNKNOWN_HOST }),
      submission({ id: "b", host: "known" }),
    ]);
    expect(groups.map((h) => h.host)).toEqual(["known", UNKNOWN_HOST]);
  });

  it("sorts sessions by recency with unknown sessions last", () => {
    const groups = groupSubmissionsByIdentity([
      submission({ id: "old", host: "h", tool: "t", session_id: "old", created_at: "2026-07-01T00:00:00.000Z" }),
      submission({ id: "new", host: "h", tool: "t", session_id: "new", created_at: "2026-07-19T00:00:00.000Z" }),
      submission({ id: "unk", host: "h", tool: "t" }),
    ]);
    expect(groups[0]?.tools[0]?.sessions.map((s) => s.session)).toEqual(["new", "old", UNKNOWN_SESSION]);
  });
});

describe("selectedSessionRecords", () => {
  it("returns records for a selected session", () => {
    const s = submission({ id: "a", host: "h", tool: "t", session_id: "s" });
    const groups = groupSubmissionsByIdentity([s]);
    expect(selectedSessionRecords(groups, "h", "t", "s")).toEqual([s]);
  });

  it("returns undefined when the session is not present", () => {
    const groups = groupSubmissionsByIdentity([submission({ id: "a", host: "h", tool: "t", session_id: "s" })]);
    expect(selectedSessionRecords(groups, "h", "t", "missing")).toBeUndefined();
  });
});

describe("makeAgentsSessionRoute", () => {
  it("encodes each identity segment", () => {
    expect(makeAgentsSessionRoute("host/with/slashes", "tool name", "session id")).toBe(
      "agents/host%2Fwith%2Fslashes/tool%20name/session%20id",
    );
  });

  it("round-trips through parseAgentsSessionRoute", () => {
    const original = { host: "a/b", tool: "c d", session: "e" };
    const parsed = parseAgentsSessionRoute(makeAgentsSessionRoute(original.host, original.tool, original.session).replace("agents/", ""));
    expect(parsed).toEqual(original);
  });
});

describe("parseAgentsSessionRoute", () => {
  it("rejects malformed routes", () => {
    expect(parseAgentsSessionRoute("a/b")).toBeNull();
    expect(parseAgentsSessionRoute("a/b/c/d")).toBeNull();
  });
});
