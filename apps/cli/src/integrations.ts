import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const harnesses = ["codex", "claude-code", "opencode", "openclaw"] as const;
export type Harness = (typeof harnesses)[number];

export type IntegrationStatus = {
  harness: Harness;
  installed: boolean;
  target: string | null;
  detail: string;
};

function home(root?: string): string {
  return root ?? process.env.THREADLINE_INTEGRATION_HOME ?? homedir();
}

function claudeSettings(root?: string): string {
  return join(home(root), ".claude", "settings.json");
}

function openCodePlugin(root?: string): string {
  return join(home(root), ".config", "opencode", "plugins", "threadline.ts");
}

function openClawPlugin(root?: string): string {
  return join(home(root), ".openclaw", "extensions", "threadline", "index.ts");
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function writeAtomically(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.threadline-${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

type ClaudeHook = { type?: unknown; command?: unknown; [key: string]: unknown };
type ClaudeSessionStart = { hooks?: unknown; [key: string]: unknown };
type ClaudeSettings = { hooks?: Record<string, unknown>; [key: string]: unknown };
const claudeCommand = "threadline integration env claude-code";

function managedClaudeHook(): ClaudeSessionStart {
  return { hooks: [{ type: "command", command: claudeCommand }] };
}

function isManagedHook(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as ClaudeHook).type === "command" && (value as ClaudeHook).command === claudeCommand);
}

function readClaudeSettings(source: string): ClaudeSettings {
  const parsed = JSON.parse(source) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Claude settings must be a JSON object.");
  return parsed as ClaudeSettings;
}

function installClaudeHook(settings: ClaudeSettings): ClaudeSettings {
  const hooks = { ...(settings.hooks ?? {}) };
  const current = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
  const installed = current.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const nested = (entry as ClaudeSessionStart).hooks;
    return Array.isArray(nested) && nested.some(isManagedHook);
  });
  if (!installed) hooks.SessionStart = [...current, managedClaudeHook()];
  return { ...settings, hooks };
}

function removeClaudeHook(settings: ClaudeSettings): ClaudeSettings {
  if (!settings.hooks || !Array.isArray(settings.hooks.SessionStart)) return settings;
  const remaining = settings.hooks.SessionStart.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [entry];
    const row = entry as ClaudeSessionStart;
    if (!Array.isArray(row.hooks)) return [entry];
    const hooks = row.hooks.filter((hook) => !isManagedHook(hook));
    return hooks.length ? [{ ...row, hooks }] : [];
  });
  const hooks = { ...settings.hooks };
  if (remaining.length) hooks.SessionStart = remaining;
  else delete hooks.SessionStart;
  return Object.keys(hooks).length ? { ...settings, hooks } : Object.fromEntries(Object.entries(settings).filter(([key]) => key !== "hooks"));
}

const openCodeSource = `// Managed by Threadline. Remove with: threadline integration remove opencode\nexport default async () => ({\n  \"shell.env\": async (input: { sessionID?: string }, output: { env: Record<string, string> }) => {\n    if (input.sessionID) output.env.THREADLINE_SESSION_ID = input.sessionID;\n    output.env.THREADLINE_TOOL = \"opencode\";\n  },\n});\n`;

const openClawSource = `// Managed by Threadline. Remove with: threadline integration remove openclaw\nexport default function threadlinePlugin(api: { on: (name: string, handler: (event: unknown, ctx: { sessionId?: string }) => Record<string, string>) => void }) {\n  api.on(\"resolve_exec_env\", (_event, ctx) => ({\n    ...(ctx.sessionId ? { THREADLINE_SESSION_ID: ctx.sessionId } : {}),\n    THREADLINE_TOOL: \"openclaw\",\n  }));\n}\n`;

export function isHarness(value: string): value is Harness {
  return (harnesses as readonly string[]).includes(value);
}

export async function integrationStatus(harness: Harness, root?: string): Promise<IntegrationStatus> {
  if (harness === "codex") {
    return {
      harness,
      installed: Boolean(process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID),
      target: null,
      detail: "Codex is detected directly through CODEX_THREAD_ID (with CODEX_SESSION_ID compatibility).",
    };
  }
  const target = harness === "claude-code" ? claudeSettings(root) : harness === "opencode" ? openCodePlugin(root) : openClawPlugin(root);
  if (harness === "claude-code") {
    if (!await exists(target)) return { harness, installed: false, target, detail: "Claude settings file is absent." };
    try {
      const settings = readClaudeSettings(await readFile(target, "utf8"));
      const installed = Array.isArray(settings.hooks?.SessionStart) && settings.hooks.SessionStart.some((entry) => {
        const nested = entry && typeof entry === "object" ? (entry as ClaudeSessionStart).hooks : undefined;
        return Array.isArray(nested) && nested.some(isManagedHook);
      });
      return { harness, installed, target, detail: installed ? "Threadline SessionStart hook is installed." : "No Threadline SessionStart hook is installed." };
    } catch {
      return { harness, installed: false, target, detail: "Claude settings are not valid JSON; Threadline left them unchanged." };
    }
  }
  return { harness, installed: await exists(target), target, detail: "Managed Threadline plugin file." };
}

export async function installIntegration(harness: Harness, root?: string, dryRun = false): Promise<IntegrationStatus> {
  if (harness === "codex") return integrationStatus(harness, root);
  const target = harness === "claude-code" ? claudeSettings(root) : harness === "opencode" ? openCodePlugin(root) : openClawPlugin(root);
  if (harness === "claude-code") {
    const current = await exists(target) ? readClaudeSettings(await readFile(target, "utf8")) : {};
    if (!dryRun) await writeAtomically(target, `${JSON.stringify(installClaudeHook(current), null, 2)}\n`);
  } else if (!dryRun) {
    await writeAtomically(target, harness === "opencode" ? openCodeSource : openClawSource);
  }
  const result = dryRun ? await integrationStatus(harness, root) : await integrationStatus(harness, root);
  return { ...result, installed: dryRun ? result.installed : true, target, detail: dryRun ? `Would install Threadline adapter at ${target}.` : "Threadline adapter is installed." };
}

export async function removeIntegration(harness: Harness, root?: string, dryRun = false): Promise<IntegrationStatus> {
  if (harness === "codex") return { harness, installed: false, target: null, detail: "Codex uses direct environment detection and has no managed adapter." };
  const target = harness === "claude-code" ? claudeSettings(root) : harness === "opencode" ? openCodePlugin(root) : openClawPlugin(root);
  if (harness === "claude-code" && await exists(target)) {
    const current = readClaudeSettings(await readFile(target, "utf8"));
    if (!dryRun) await writeAtomically(target, `${JSON.stringify(removeClaudeHook(current), null, 2)}\n`);
  } else if (harness !== "claude-code" && !dryRun) {
    await rm(target, { force: true });
  }
  return { harness, installed: false, target, detail: dryRun ? `Would remove the Threadline adapter at ${target}.` : "Threadline adapter is removed." };
}

export function environmentLines(harness: Harness, payload: unknown): string[] {
  if (harness !== "claude-code" || !payload || typeof payload !== "object") return [];
  const sessionId = (payload as { session_id?: unknown }).session_id;
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) return ["THREADLINE_TOOL=claude-code"];
  return [`THREADLINE_SESSION_ID=${shellQuote(sessionId)}`, "THREADLINE_TOOL=claude-code"];
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
