import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { ThreadlineStore } from "@threadline/store";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../api/src/app.js";

const execFileAsync = promisify(execFile);
const token = "cli-test-token";
const cli = resolve("apps/cli/dist/main.js");

describe("Threadline CLI", () => {
  let app: FastifyInstance;
  let store: ThreadlineStore;
  let url: string;

  beforeAll(async () => {
    store = new ThreadlineStore(":memory:");
    app = await buildApp({ store, token });
    url = await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    await app.close();
    store.close();
  });

  async function run(args: string[]): Promise<unknown> {
    const result = await execFileAsync(process.execPath, [cli, "--json", ...args], {
      env: {
        ...process.env,
        THREADLINE_URL: url,
        THREADLINE_TOKEN: token,
        THREADLINE_ACTOR_TYPE: "agent",
        THREADLINE_ACTOR_NAME: "cli-agent",
        THREADLINE_RUNTIME: "codex",
        THREADLINE_AGENT: "cli-agent",
        THREADLINE_SESSION_ID: "cli-session",
      },
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
});
