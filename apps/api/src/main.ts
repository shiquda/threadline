#!/usr/bin/env node
import { resolve } from "node:path";
import { ThreadlineStore } from "@threadline/store";
import { buildApp } from "./app.js";

const token = process.env.THREADLINE_TOKEN;
if (!token) {
  throw new Error("THREADLINE_TOKEN is required");
}

const databasePath = resolve(process.env.THREADLINE_DATABASE ?? "threadline.sqlite");
const port = Number.parseInt(process.env.THREADLINE_PORT ?? "3000", 10);
const host = process.env.THREADLINE_HOST ?? "127.0.0.1";
const store = new ThreadlineStore(databasePath);
const app = await buildApp({
  store,
  token,
  logger: true,
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
