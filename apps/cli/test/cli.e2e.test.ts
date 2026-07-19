import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { ThreadlineStore } from "@threadline/store";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../api/src/app.js";

const execFileAsync = promisify(execFile);
const token = "cli-test-token";
const cli = resolve("apps/cli/dist/main.js");

describe("Threadline CLI", () => {
  let app: FastifyInstance;
  let store: ThreadlineStore;
  let url: string;
  let configDirectory: string;

  beforeAll(async () => {
    store = new ThreadlineStore(":memory:");
    app = await buildApp({ store, token });
    url = await app.listen({ host: "127.0.0.1", port: 0 });
    configDirectory = await mkdtemp(resolve(tmpdir(), "threadline-cli-test-"));
  });

  afterAll(async () => {
    await app.close();
    store.close();
    await rm(configDirectory, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await rm(resolve(configDirectory, "config.json"), { force: true });
  });

  async function run(
    args: string[],
    useRuntimeEnvironment = true,
    environment: NodeJS.ProcessEnv = {},
  ): Promise<unknown> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      THREADLINE_URL: url,
      THREADLINE_TOKEN: token,
      THREADLINE_CONFIG: resolve(configDirectory, "config.json"),
      THREADLINE_ACTOR_TYPE: "agent",
      THREADLINE_ACTOR_NAME: "cli-agent",
    };
    if (useRuntimeEnvironment) {
      env.THREADLINE_RUNTIME = "codex";
      env.THREADLINE_ACTOR_HOST = "cli-host";
      env.THREADLINE_TOOL = "codex";
      env.THREADLINE_AGENT = "cli-agent";
      env.THREADLINE_SESSION_ID = "cli-session";
    } else {
      delete env.THREADLINE_RUNTIME;
      delete env.THREADLINE_ACTOR_HOST;
      delete env.THREADLINE_TOOL;
      delete env.THREADLINE_AGENT;
      delete env.THREADLINE_SESSION_ID;
    }
    // The test runner can itself be inside a Codex harness. Native variables
    // must be opt-in per test so they do not leak into unscoped assertions.
    delete env.CODEX_THREAD_ID;
    delete env.CODEX_SESSION_ID;
    const result = await execFileAsync(process.execPath, [cli, "--json", ...args], {
      env: { ...env, ...environment },
    });
    return JSON.parse(result.stdout.trim()) as unknown;
  }

  async function runExpectingExitCode(args: string[], exitCode: number): Promise<unknown> {
    try {
      await run(args);
      throw new Error(`Expected command to exit with code ${exitCode}.`);
    } catch (error) {
      const result = error as NodeJS.ErrnoException & { code?: number | string; stdout?: string };
      expect(result.code).toBe(exitCode);
      return JSON.parse(result.stdout?.trim() ?? "") as unknown;
    }
  }

  it("runs the decision workflow against a configurable Gateway", async () => {
    expect(await run(["status"])).toEqual({ status: "ok" });

    const initiative = (await run([
      "initiative",
      "create",
      "--title",
      "CLI workflow",
      "--intent",
      "Prove Agent and Web API semantics are shared",
    ])) as { id: string };

    const submission = (await run([
      "submission",
      "create",
      "--kind",
      "decision_request",
      "--title",
      "Choose an option",
      "--summary",
      "The CLI test needs a decision.",
      "--initiative",
      initiative.id,
      "--question",
      "Proceed?",
      "--options",
      "Approve,Reject",
    ])) as { decision: { id: string } };

    const inbox = (await run(["inbox", "list"])) as Array<{
      submission: { host: string; tool: string; session_id: string };
    }>;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.submission).toMatchObject({ host: "cli-host", tool: "codex", session_id: "cli-session" });

    const resolved = (await run([
      "decision",
      "resolve",
      submission.decision.id,
      "--outcome",
      "Approve",
    ])) as { status: string; resolution: string };
    expect(resolved).toMatchObject({ status: "resolved", resolution: "Approve" });
    expect(await run(["inbox", "list"])).toEqual([]);
  });

  it("persists attach context and applies it to later submissions", async () => {
    const initiative = (await run([
      "initiative",
      "create",
      "--title",
      "Attached initiative",
      "--intent",
      "Keep context between commands",
    ], false)) as { id: string };

    expect(
      await run([
        "attach",
        "--runtime",
        "codex",
        "--agent",
        "attached-agent",
        "--session",
        "attached-session",
        "--initiative",
        initiative.id,
      ], false),
    ).toMatchObject({ context: { runtime: "codex", agent: "attached-agent", sessionId: "attached-session", initiativeId: initiative.id } });

    const created = (await run([
      "submission",
      "create",
      "--kind",
      "progress_update",
      "--title",
      "Attached progress",
      "--summary",
      "The attached defaults are used.",
    ], false)) as { submission: { runtime: string; agent: string; session_id: string; initiative_id: string } };
    expect(created.submission).toMatchObject({
      tool: "codex",
      runtime: "codex",
      agent: "attached-agent",
      session_id: "attached-session",
      initiative_id: initiative.id,
    });

    await run(["config", "language", "set", "interaction", "de-DE"], false);
    await run(["config", "language", "set", "fixed", "fr-FR"], false);
    await run([
      "config",
      "language",
      "set",
      "initiative",
      "it-IT",
      "--initiative",
      initiative.id,
    ], false);
    await run([
      "config",
      "language",
      "set",
      "session",
      "ja-JP",
      "--session",
      "attached-session",
    ], false);
    const policyReceipt = (await run([
      "--dry-run",
      "submission",
      "create",
      "--kind",
      "delivery",
      "--title",
      "Language policy",
      "--summary",
      "The session override wins.",
    ], false)) as { language: { source: string; tag: string } };
    expect(policyReceipt.language).toMatchObject({ source: "session", tag: "ja-JP" });

    const localized = (await run([
      "submission",
      "create",
      "--kind",
      "delivery",
      "--title",
      "Persisted language",
      "--summary",
      "The configured session language is stored with this fact.",
    ], false)) as { submission: { content_language: string } };
    expect(localized.submission.content_language).toBe("ja-JP");
  });

  it("filters submissions by host, tool, and session without fabricating a session", async () => {
    const first = (await run([
      "submission",
      "create",
      "--kind",
      "delivery",
      "--title",
      "First identity",
      "--summary",
      "Written by the configured CLI identity.",
      "--attention",
      "record_only",
    ])) as { submission: { id: string } };
    await run([
      "--host",
      "other-host",
      "--tool",
      "other-tool",
      "--session",
      "other-session",
      "submission",
      "create",
      "--kind",
      "delivery",
      "--title",
      "Other identity",
      "--summary",
      "Must not match the configured identity filter.",
      "--attention",
      "record_only",
    ]);

    const filtered = (await run([
      "submission",
      "list",
      "--host",
      "cli-host",
      "--tool",
      "codex",
      "--session",
      "cli-session",
    ])) as Array<{ id: string }>;
    expect(filtered).toEqual(expect.arrayContaining([expect.objectContaining({ id: first.submission.id })]));
    expect(filtered).not.toEqual(expect.arrayContaining([expect.objectContaining({ title: "Other identity" })]));

    const noSession = (await run([
      "--dry-run",
      "submission",
      "create",
      "--kind",
      "delivery",
      "--title",
      "No invented session",
      "--summary",
      "An absent session remains absent.",
    ], false)) as { context: { session_id?: string } };
    expect(noSession.context.session_id).toBeUndefined();
  });

  it("uses native Codex thread IDs and treats blank session values as absent", async () => {
    const native = (await run([
      "--dry-run",
      "submission",
      "create",
      "--kind",
      "delivery",
      "--title",
      "Native Codex thread",
      "--summary",
      "The harness session is preserved.",
    ], false, {
      CODEX_THREAD_ID: "thr_native",
      CODEX_SESSION_ID: "legacy-session",
      THREADLINE_SESSION_ID: "",
    })) as { context: { tool?: string; session_id?: string } };
    expect(native.context).toMatchObject({ tool: "codex", session_id: "thr_native" });

    const explicit = (await run([
      "--dry-run",
      "--session",
      "thr_explicit",
      "submission",
      "create",
      "--kind",
      "delivery",
      "--title",
      "Explicit session",
      "--summary",
      "Explicit input wins.",
    ], false, { CODEX_THREAD_ID: "thr_native" })) as { context: { session_id?: string } };
    expect(explicit.context.session_id).toBe("thr_explicit");

    const blank = (await run([
      "--dry-run",
      "submission",
      "create",
      "--kind",
      "delivery",
      "--title",
      "Blank session",
      "--summary",
      "Blank input is unscoped.",
    ], false, { THREADLINE_SESSION_ID: "   " })) as { context: { session_id?: string } };
    expect(blank.context.session_id).toBeUndefined();
  });

  it("explains deterministic dry-run writes and completion records delivery plus state", async () => {
    const receipt = (await run([
      "--dry-run",
      "--explain",
      "--language",
      "en-us",
      "submission",
      "create",
      "--kind",
      "delivery",
      "--title",
      "Dry run",
      "--summary",
      "Do not send this.",
    ])) as {
      dry_run: boolean;
      request: { headers: { "idempotency-key": string }; body: { content_language: string } };
      language: { source: string; tag: string };
      idempotency: { source: string; formula: string };
    };
    expect(receipt).toMatchObject({
      dry_run: true,
      language: { source: "command", tag: "en-US" },
      idempotency: { source: "automatic" },
    });
    expect(receipt.request.headers["idempotency-key"]).toMatch(/^threadline\/v1\/submission\.create\//);
    expect(receipt.request.body.content_language).toBe("en-US");
    expect(receipt.idempotency.formula).toContain("canonical-json");

    const initiative = (await run([
      "initiative",
      "create",
      "--title",
      "Completion workflow",
      "--intent",
      "Persist both a delivery and completion state",
    ])) as { id: string };
    const done = (await run(["done", initiative.id, "--summary", "All required work is complete."])) as {
      delivery: { submission: { kind: string; initiative_id: string } };
      state: { status: string };
    };
    expect(done).toMatchObject({
      delivery: { submission: { kind: "delivery", initiative_id: initiative.id } },
      state: { status: "completed" },
    });
    await run(["done", initiative.id, "--summary", "All required work is complete."]);
    const submissions = (await run(["submission", "list"])) as Array<{ initiative_id: string | null }>;
    expect(submissions.filter((entry) => entry.initiative_id === initiative.id)).toHaveLength(1);
    expect(await run(["verify-complete", initiative.id])).toMatchObject({ initiative_id: initiative.id, complete: true });
  });

  it("creates and lists Tasks with global or attached initiative context, and gates completion on open Tasks", async () => {
    const initiative = (await run([
      "initiative",
      "create",
      "--title",
      "Task lifecycle",
      "--intent",
      "Do not complete while implementation Tasks remain open",
    ])) as { id: string };

    const explicitTask = (await run([
      "task",
      "create",
      "--initiative",
      initiative.id,
      "--title",
      "Ship lifecycle gate",
    ])) as { id: string; initiative_id: string; status: string };
    expect(explicitTask).toMatchObject({ initiative_id: initiative.id, status: "open" });

    expect(await run(["task", "list", "--initiative", initiative.id])).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: explicitTask.id })]),
    );

    await run(["attach", "--initiative", initiative.id]);
    const attachedTask = (await run([
      "task",
      "create",
      "--title",
      "Verify task completion",
    ])) as { id: string; initiative_id: string };
    expect(attachedTask.initiative_id).toBe(initiative.id);
    expect(await run(["task", "list"])).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: attachedTask.id })]),
    );

    expect(await runExpectingExitCode(["verify-complete", initiative.id], 2)).toMatchObject({
      initiative_id: initiative.id,
      complete: false,
      checks: {
        open_tasks: expect.arrayContaining([
          expect.objectContaining({ id: explicitTask.id, status: "open" }),
          expect.objectContaining({ id: attachedTask.id, status: "open" }),
        ]),
      },
    });

    await run(["task", "update", explicitTask.id, "--complete"]);
    await run(["task", "update", attachedTask.id, "--complete"]);
    await run(["done", initiative.id, "--summary", "All initiative Tasks are complete."]);
    expect(await run(["verify-complete", initiative.id])).toMatchObject({
      initiative_id: initiative.id,
      complete: true,
      checks: { open_tasks: [] },
    });
  });

  it("synchronizes a durable event and projects Done atomically", async () => {
    const initiative = (await run([
      "initiative",
      "create",
      "--title",
      "Cutover workflow",
      "--intent",
      "Record a cutover with its resulting state",
    ])) as { id: string };

    const synced = (await run([
      "--initiative",
      initiative.id,
      "sync",
      "--event",
      "cutover",
      "--summary",
      "Old host is down and the target is healthy.",
      "--status",
      "done",
      "--next",
      "Reauthenticate Tailscale if remote mesh access is needed.",
      "--evidence",
      "healthcheck:ok,cutover:complete",
    ])) as { submission: { kind: string; evidence_refs: string[] }; initiative?: { lifecycle: string } };
    expect(synced.submission).toMatchObject({ kind: "delivery", evidence_refs: ["healthcheck:ok", "cutover:complete"] });
    expect((await run(["initiative", "get", initiative.id])) as { lifecycle: string }).toMatchObject({ lifecycle: "done" });
  });
}, 15_000);
