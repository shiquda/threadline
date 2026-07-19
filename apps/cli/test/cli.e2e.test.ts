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

  async function run(args: string[], useRuntimeEnvironment = true): Promise<unknown> {
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
      env.THREADLINE_AGENT = "cli-agent";
      env.THREADLINE_SESSION_ID = "cli-session";
    } else {
      delete env.THREADLINE_RUNTIME;
      delete env.THREADLINE_AGENT;
      delete env.THREADLINE_SESSION_ID;
    }
    const result = await execFileAsync(process.execPath, [cli, "--json", ...args], {
      env,
    });
    return JSON.parse(result.stdout.trim()) as unknown;
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
      submission: { session_id: string };
    }>;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.submission.session_id).toBe("cli-session");

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
      delivery: { submission: { kind: "progress_update", initiative_id: initiative.id } },
      state: { status: "completed" },
    });
    expect(await run(["verify-complete", initiative.id])).toMatchObject({ initiative_id: initiative.id, complete: true });
  });
});
