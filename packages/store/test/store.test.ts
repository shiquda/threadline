import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThreadlineStore } from "../src/index.js";

const actor = { actor_type: "agent" as const, actor_name: "builder" };

describe("ThreadlineStore core initiative projection", () => {
  let store: ThreadlineStore;

  beforeEach(() => {
    store = new ThreadlineStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("maps legacy status and semantic initiative updates to durable core state", () => {
    const initiative = store.createInitiative({
      title: "Release Threadline",
      intent: "Make state explicit for agents and humans.",
      status: "waiting_for_jim",
      next_step: "Choose the release owner",
      actor,
    });

    expect(initiative).toMatchObject({
      status: "waiting_for_jim",
      lifecycle: "open",
      blocker: "human",
      owner: "human",
      next_action: "Choose the release owner",
    });

    const completed = store.updateInitiative(initiative.id, {
      lifecycle: "done",
      blocker: "none",
      owner: "none",
      next_action: "Archive the release evidence",
      actor,
    });
    expect(completed).toMatchObject({
      status: "completed",
      lifecycle: "done",
      blocker: "none",
      owner: "none",
      next_step: "Archive the release evidence",
      next_action: "Archive the release evidence",
    });
    expect(store.getWorkboard().done).toMatchObject([{ id: initiative.id }]);
  });

  it("stores idempotent, evidence-bearing submissions and projects waiting work", () => {
    const initiative = store.createInitiative({
      title: "Recover external dependency",
      intent: "Keep the workboard precise.",
      actor,
    });
    const submission = {
      kind: "progress_update" as const,
      title: "Dependency is unavailable",
      summary: "Awaiting an upstream response.",
      content_language: "en-US",
      evidence_refs: ["https://status.example.test/incident/7", "log:retry-3"],
      initiative_id: initiative.id,
      initiative_update: {
        blocker: "external" as const,
        owner: "none" as const,
        next_action: "Retry after the upstream incident closes",
      },
      attention_policy: "record_only" as const,
      actor,
    };

    const first = store.createSubmissionWithOutcome(submission, "upstream-incident-7");
    const retry = store.createSubmissionWithOutcome(submission, "upstream-incident-7");

    expect(first.created).toBe(true);
    expect(retry).toEqual({ result: first.result, created: false });
    expect(first.result.submission).toMatchObject({
      content_language: "en-US",
      evidence_refs: submission.evidence_refs,
    });
    expect(store.getInitiative(initiative.id)).toMatchObject({
      lifecycle: "open",
      blocker: "external",
      owner: "none",
      next_action: "Retry after the upstream incident closes",
    });
    expect(store.getWorkboard().waiting).toMatchObject([{ id: initiative.id }]);
  });

  it("manages project Tasks and links only same-project Submissions", () => {
    const initiative = store.createInitiative({ title: "Project", intent: "Task scope", actor });
    const other = store.createInitiative({ title: "Other", intent: "Other scope", actor });
    const task = store.createTask({ initiative_id: initiative.id, title: "Ship API", actor }, "task-create");
    expect(store.createTask({ initiative_id: initiative.id, title: "Ship API", actor }, "task-create")).toEqual(task);

    const completed = store.updateTask(task.id, { status: "completed", actor });
    expect(completed).toMatchObject({ status: "completed", completed_by: "builder" });
    expect(store.updateTask(task.id, { status: "open", actor })).toMatchObject({ status: "open", completed_at: null });

    const submission = store.createSubmission({
      kind: "delivery", title: "API shipped", summary: "Complete", initiative_id: initiative.id,
      attention_policy: "record_only", actor,
    }).submission;
    store.linkTaskSubmission(task.id, submission.id, actor);
    store.linkTaskSubmission(task.id, submission.id, actor);
    expect(store.listTaskSubmissions(task.id)).toMatchObject([{ id: submission.id }]);

    const unrelated = store.createSubmission({
      kind: "delivery", title: "Elsewhere", summary: "Other", initiative_id: other.id,
      attention_policy: "record_only", actor,
    }).submission;
    expect(() => store.linkTaskSubmission(task.id, unrelated.id, actor)).toThrow("same Initiative");
  });
});

describe("ThreadlineStore execution identity", () => {
  it("backfills tool from legacy runtime without inventing a host", async () => {
    const directory = await mkdtemp(join(tmpdir(), "threadline-migration-"));
    const filename = join(directory, "legacy.sqlite");
    const database = new Database(filename);
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (1, '2026-07-19T00:00:00.000Z');
      INSERT INTO schema_migrations VALUES (2, '2026-07-19T00:00:00.000Z');
      CREATE TABLE submissions (runtime TEXT, session_id TEXT, created_at TEXT);
      CREATE TABLE audit_events (runtime TEXT);
      INSERT INTO submissions(runtime) VALUES ('codex');
      INSERT INTO audit_events VALUES ('claude-code');
    `);
    database.close();

    const store = new ThreadlineStore(filename);
    store.close();

    const migrated = new Database(filename, { readonly: true });
    expect(migrated.prepare("SELECT host, tool FROM submissions").get()).toEqual({ host: null, tool: "codex" });
    expect(migrated.prepare("SELECT host, tool FROM audit_events").get()).toEqual({ host: null, tool: "claude-code" });
    migrated.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("stores and filters canonical host, tool, and session identity", () => {
    const store = new ThreadlineStore(":memory:");
    const canonicalActor = {
      actor_type: "agent" as const,
      actor_name: "builder",
      host: "wdc-vps",
      tool: "codex",
      session_id: "session-a",
    };
    const otherActor = { ...canonicalActor, host: "laptop", tool: "claude-code", session_id: "session-b" };
    const canonical = store.createSubmission({
      kind: "delivery",
      title: "Canonical identity",
      summary: "Stored with host, tool, and session.",
      attention_policy: "record_only",
      actor: canonicalActor,
    }).submission;
    store.createSubmission({
      kind: "delivery",
      title: "Other identity",
      summary: "Must not match the canonical filter.",
      attention_policy: "record_only",
      actor: otherActor,
    });

    expect(canonical).toMatchObject({ host: "wdc-vps", tool: "codex", session_id: "session-a" });
    expect(store.listSubmissions({ host: "wdc-vps", tool: "codex", session_id: "session-a" }))
      .toMatchObject([{ id: canonical.id }]);
    expect(store.listEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ host: "laptop", tool: "claude-code", session_id: "session-b" }),
      expect.objectContaining({ host: "wdc-vps", tool: "codex", session_id: "session-a" }),
    ]));
    store.close();
  });
});
