#!/usr/bin/env node
import { resolve } from "node:path";
import { ThreadlineStore } from "@threadline/store";
import { buildApp } from "./app.js";
import { createPublisherFromEnvironment } from "./notifier.js";

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function enabled(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

const token = process.env.THREADLINE_TOKEN;
if (!token) {
  throw new Error("THREADLINE_TOKEN is required");
}

const databasePath = resolve(process.env.THREADLINE_DATABASE ?? "threadline.sqlite");
const webDir = process.env.THREADLINE_WEB_DIR;
const publisher = createPublisherFromEnvironment();
const port = Number.parseInt(process.env.THREADLINE_PORT ?? "3000", 10);
const host = process.env.THREADLINE_HOST ?? "127.0.0.1";
const store = new ThreadlineStore(databasePath);
const app = await buildApp({
  store,
  token,
  logger: true,
  bodyLimit: positiveInteger(process.env.THREADLINE_BODY_LIMIT_BYTES, 262_144),
  rateLimitMax: positiveInteger(process.env.THREADLINE_RATE_LIMIT_MAX, 120),
  rateLimitWindowMs: positiveInteger(process.env.THREADLINE_RATE_LIMIT_WINDOW_MS, 60_000),
  trustProxy: enabled(process.env.THREADLINE_TRUST_PROXY),
  ...(publisher ? { publisher } : {}),
  ...(webDir ? { webDir: resolve(webDir) } : {}),
  ...(process.env.THREADLINE_CORS_ORIGIN
    ? { corsOrigin: process.env.THREADLINE_CORS_ORIGIN }
    : {}),
});

const shutdown = async () => {
  await app.close();
  store.close();
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await app.listen({ host, port });
