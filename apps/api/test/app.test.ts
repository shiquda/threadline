import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThreadlineStore } from "@threadline/store";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const token = "test-token";
const authorization = { authorization: `Bearer ${token}` };
const actor = {
  actor_type: "agent" as const,
  actor_name: "builder",
  source: "codex",
  runtime: "codex",
  agent: "builder",
  session_id: "session-42",
};

describe("Threadline API decision loop", () => {
  let store: ThreadlineStore;
  let app: FastifyInstance;

  beforeEach(async () => {
    store = new ThreadlineStore(":memory:");
    app = await buildApp({ store, token });
  });

  afterEach(async () => {
    await app.close();
    store.close();
  });

  it("requires authentication for domain data", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/inbox" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "unauthorized" });
  });

  it("creates and idempotently resolves a decision while closing Inbox attention", async () => {
    const initiativeResponse = await app.inject({
      method: "POST",
      url: "/api/v1/initiatives",
      headers: authorization,
      payload: {
        title: "Ship the MVP",
        intent: "Validate durable decisions across sessions",
        status: "waiting_for_jim",
        next_step: "Choose the deployment region",
        actor,
      },
    });
    expect(initiativeResponse.statusCode).toBe(201);
    const initiative = initiativeResponse.json<{ id: string }>();

    const decisionRequest = {
      kind: "decision_request",
      title: "Choose a deployment region",
      summary: "Provisioning is blocked on a region choice.",
      initiative_id: initiative.id,
      attention_policy: "inbox",
      decision: {
        question: "Which region should host Threadline?",
        options: ["Singapore", "Tokyo"],
        risk_level: "medium",
      },
      actor,
    };
    const submissionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/submissions",
      headers: { ...authorization, "idempotency-key": "region-decision" },
      payload: decisionRequest,
    });
    expect(submissionResponse.statusCode).toBe(201);
    const result = submissionResponse.json<{
      decision: { id: string };
      notification: { id: string; status: string };
    }>();
    expect(result.notification.status).toBe("active");

    const submissionRetry = await app.inject({
      method: "POST",
      url: "/api/v1/submissions",
      headers: { ...authorization, "idempotency-key": "region-decision" },
      payload: decisionRequest,
    });
    expect(submissionRetry.statusCode).toBe(201);
    expect(submissionRetry.json()).toEqual(submissionResponse.json());

    const inboxBefore = await app.inject({
      method: "GET",
      url: "/api/v1/inbox",
      headers: authorization,
    });
    expect(inboxBefore.json()).toMatchObject([
      {
        submission: { runtime: "codex", agent: "builder", session_id: "session-42" },
        decision: { id: result.decision.id, status: "open" },
      },
    ]);
    const workboardBefore = await app.inject({
      method: "GET",
      url: "/api/v1/workboard",
      headers: authorization,
    });
    expect(workboardBefore.json()).toMatchObject({
      waiting_for_jim: [{ id: initiative.id }],
    });

    const resolvePayload = {
      outcome: "Use Singapore",
      resolved_via: "agent_session",
      actor,
    };
    const resolved = await app.inject({
      method: "POST",
      url: `/api/v1/decisions/${result.decision.id}/resolve`,
      headers: authorization,
      payload: resolvePayload,
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({
      status: "resolved",
      resolution: "Use Singapore",
      resolved_via: "agent_session",
      resolved_by: "builder",
    });

    const retry = await app.inject({
      method: "POST",
      url: `/api/v1/decisions/${result.decision.id}/resolve`,
      headers: authorization,
      payload: resolvePayload,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(resolved.json());

    const conflict = await app.inject({
      method: "POST",
      url: `/api/v1/decisions/${result.decision.id}/resolve`,
      headers: authorization,
      payload: { ...resolvePayload, outcome: "Use Tokyo" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "conflict" });

    const inboxAfter = await app.inject({
      method: "GET",
      url: "/api/v1/inbox",
      headers: authorization,
    });
    expect(inboxAfter.json()).toEqual([]);
    const workboardAfter = await app.inject({
      method: "GET",
      url: "/api/v1/workboard",
      headers: authorization,
    });
    expect(workboardAfter.json()).toMatchObject({
      waiting_for_agent: [{ id: initiative.id }],
    });
  });

  it("records observed content without creating Active Inbox attention", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/submissions",
      headers: authorization,
      payload: {
        kind: "delivery",
        title: "Result already reviewed",
        summary: "Jim saw this delivery in the current session.",
        attention_policy: "inbox",
        observed: true,
        actor,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      submission: { observed_at: expect.any(String) },
      notification: { status: "suppressed", suppression_reason: "observed" },
    });

    const submissions = await app.inject({
      method: "GET",
      url: "/api/v1/submissions",
      headers: authorization,
    });
    expect(submissions.json()).toHaveLength(1);

    const inbox = await app.inject({
      method: "GET",
      url: "/api/v1/inbox",
      headers: authorization,
    });
    expect(inbox.json()).toEqual([]);
  });
});
