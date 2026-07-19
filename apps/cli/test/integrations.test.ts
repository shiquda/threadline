import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { environmentLines, installIntegration, integrationStatus, removeIntegration } from "../src/integrations.js";

const directories: string[] = [];

async function root(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "threadline-integration-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("harness integrations", () => {
  it("installs and removes only its Claude SessionStart hook", async () => {
    const directory = await root();
    const settings = join(directory, ".claude", "settings.json");
    await mkdir(join(directory, ".claude"), { recursive: true });
    await writeFile(settings, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "user-hook" }] }] } }), "utf8");

    await installIntegration("claude-code", directory);
    await installIntegration("claude-code", directory);
    const installed = await readFile(settings, "utf8");
    expect(installed.match(/threadline integration env claude-code/g)).toHaveLength(1);
    expect(installed).toContain("user-hook");
    expect((await integrationStatus("claude-code", directory)).installed).toBe(true);

    await removeIntegration("claude-code", directory);
    const removed = await readFile(settings, "utf8");
    expect(removed).toContain("user-hook");
    expect(removed).not.toContain("threadline integration env claude-code");
  });

  it("uses native IDs only when a Claude hook payload provides one", () => {
    expect(environmentLines("claude-code", { session_id: "session'one" })).toEqual([
      "THREADLINE_SESSION_ID='session'\"'\"'one'",
      "THREADLINE_TOOL=claude-code",
    ]);
    expect(environmentLines("claude-code", { session_id: "  " })).toEqual(["THREADLINE_TOOL=claude-code"]);
  });

  it("keeps OpenCode and OpenClaw adapters as removable managed files", async () => {
    const directory = await root();
    for (const harness of ["opencode", "openclaw"] as const) {
      await installIntegration(harness, directory);
      expect((await integrationStatus(harness, directory)).installed).toBe(true);
      await removeIntegration(harness, directory);
      expect((await integrationStatus(harness, directory)).installed).toBe(false);
    }
  });
});
