import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThreadlineStore } from "@threadline/store";
import type { FastifyInstance } from "fastify";
import type { NotificationEvent, NotificationPublisher } from "../src/notifier.js";
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
  let events: NotificationEvent[];
  let publisher: NotificationPublisher;

  beforeEach(async () => {
    store = new ThreadlineStore(":memory:");
    events = [];
    publisher = { publish: async (event) => void events.push(event) };
    app = await buildApp({ store, token, publisher });
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

  it("sets browser security headers and rejects request bodies above the configured limit", async () => {
    await app.close();
    store.close();
    store = new ThreadlineStore(":memory:");
    app = await buildApp({ store, token, bodyLimit: 128 });

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(health.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(health.headers["referrer-policy"]).toBe("no-referrer");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/submissions",
      headers: { ...authorization, "content-type": "application/json" },
      payload: JSON.stringify({ padding: "x".repeat(256) }),
    });
    expect(response.statusCode).toBe(413);
  });

  it("limits repeated API requests while allowing health checks", async () => {
    await app.close();
    store.close();
    store = new ThreadlineStore(":memory:");
    app = await buildApp({
      store,
      token,
      rateLimitMax: 1,
      rateLimitWindowMs: 60_000,
      rateLimitKeyGenerator: () => "test-client",
    });

    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    const repeatedRequest = {
      method: "GET" as const,
      url: "/api/v1/inbox",
    };
    expect((await app.inject(repeatedRequest)).statusCode).toBe(401);
    expect((await app.inject(repeatedRequest)).statusCode).toBe(429);
  });

  it("allows CORS preflight before API authentication", async () => {
    await app.close();
    store.close();
    store = new ThreadlineStore(":memory:");
    app = await buildApp({ store, token, corsOrigin: "http://127.0.0.1:3001" });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/workboard",
      headers: {
        origin: "http://127.0.0.1:3001",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3001");
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
    expect(events).toMatchObject([
      {
        type: "decision_created",
        decision: { id: result.decision.id, question: "Which region should host Threadline?" },
      },
    ]);

    const submissionRetry = await app.inject({
      method: "POST",
      url: "/api/v1/submissions",
      headers: { ...authorization, "idempotency-key": "region-decision" },
      payload: decisionRequest,
    });
    expect(submissionRetry.statusCode).toBe(201);
    expect(submissionRetry.json()).toEqual(submissionResponse.json());
    expect(events).toHaveLength(1);

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

  it("delivers alerts without allowing an outbound failure to change the API result", async () => {
    await app.close();
    store.close();
    store = new ThreadlineStore(":memory:");
    publisher = { publish: async () => Promise.reject(new Error("network unavailable")) };
    app = await buildApp({ store, token, publisher });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/submissions",
      headers: authorization,
      payload: {
        kind: "alert",
        title: "Deployment needs attention",
        summary: "The reverse proxy did not start.",
        attention_policy: "interrupt",
        actor,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ submission: { kind: "alert" } });
    await new Promise((resolve) => setImmediate(resolve));
    const saved = await app.inject({ method: "GET", url: "/api/v1/submissions", headers: authorization });
    expect(saved.json()).toMatchObject([{ kind: "alert" }]);
  });

  it("accepts additive core state and evidence payloads for CLI clients", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/initiatives",
      headers: authorization,
      payload: {
        title: "Reconcile external release state",
        intent: "Represent a deterministic workboard lane.",
        lifecycle: "open",
        blocker: "none",
        owner: "agent",
        next_action: "Collect verification evidence",
        actor,
      },
    });
    expect(created.statusCode).toBe(201);
    const initiative = created.json<{ id: string }>();
    expect(created.json()).toMatchObject({
      lifecycle: "open",
      blocker: "none",
      owner: "agent",
      next_action: "Collect verification evidence",
    });

    const submissionPayload = {
      kind: "progress_update",
      title: "External release is pending",
      summary: "A third-party verification must complete first.",
      content_language: "en-GB",
      evidence_refs: ["https://example.test/releases/42", "run:verification-42"],
      initiative_id: initiative.id,
      initiative_update: {
        blocker: "external",
        owner: "none",
        next_action: "Poll the release verification",
      },
      attention_policy: "record_only",
      actor,
    };
    const submitted = await app.inject({
      method: "POST",
      url: "/api/v1/submissions",
      headers: { ...authorization, "idempotency-key": "release-42" },
      payload: submissionPayload,
    });
    expect(submitted.statusCode).toBe(201);
    expect(submitted.json()).toMatchObject({
      submission: { content_language: "en-GB", evidence_refs: submissionPayload.evidence_refs },
    });

    const retry = await app.inject({
      method: "POST",
      url: "/api/v1/submissions",
      headers: { ...authorization, "idempotency-key": "release-42" },
      payload: submissionPayload,
    });
    expect(retry.json()).toEqual(submitted.json());

    const workboard = await app.inject({
      method: "GET",
      url: "/api/v1/workboard",
      headers: authorization,
    });
    expect(workboard.json()).toMatchObject({
      waiting: [{ id: initiative.id, blocker: "external", owner: "none" }],
      ready: [],
      done: [],
    });

    const invalidLanguage = await app.inject({
      method: "POST",
      url: "/api/v1/submissions",
      headers: authorization,
      payload: { ...submissionPayload, content_language: "en_US" },
    });
    expect(invalidLanguage.statusCode).toBe(400);
  });
});
