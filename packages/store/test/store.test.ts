import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
