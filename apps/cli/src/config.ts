import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CliConfig {
  url?: string;
  token?: string;
  context?: PersistedContext;
  language?: LanguagePolicy;
}

export interface PersistedContext {
  actorType?: "human" | "agent" | "system";
  actorName?: string;
  source?: string;
  runtime?: string;
  agent?: string;
  sessionId?: string;
  initiativeId?: string;
}

export interface LanguagePolicy {
  /** The language inherited from the active user interaction. */
  interaction?: string;
  /** The workspace-wide language selected by the user. */
  fixed?: string;
  /** Per-session overrides, keyed by Threadline session ID. */
  sessions?: Record<string, string>;
  /** Per-initiative overrides, keyed by Threadline initiative ID. */
  initiatives?: Record<string, string>;
}

export function configPath(): string {
  return process.env.THREADLINE_CONFIG ?? join(homedir(), ".threadline", "config.json");
}

export async function readConfig(): Promise<CliConfig> {
  try {
    return JSON.parse(await readFile(configPath(), "utf8")) as CliConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function writeConfig(config: CliConfig): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

export async function resolveConnection(): Promise<{ url: string; token: string }> {
  const config = await readConfig();
  const url = process.env.THREADLINE_URL ?? config.url;
  const token = process.env.THREADLINE_TOKEN ?? config.token;
  if (!url) throw new Error("Gateway URL is missing. Set THREADLINE_URL or run config set-url.");
  if (!token) throw new Error("Gateway token is missing. Set THREADLINE_TOKEN or run config set-token.");
  return { url: url.replace(/\/$/, ""), token };
}
