#!/usr/bin/env node
import type { ActorContext, AttentionPolicy, SubmissionKind } from "@threadline/protocol";
import { Command, Option } from "commander";
import { ApiError, request } from "./client.js";
import { configPath, readConfig, writeConfig } from "./config.js";

interface GlobalOptions {
  json?: boolean;
  actorType?: "human" | "agent" | "system";
  actorName?: string;
  source?: string;
  runtime?: string;
  agent?: string;
  session?: string;
  idempotencyKey?: string;
}

const program = new Command();

program
  .name("threadline")
  .description("CLI for the Threadline Human-Agent Gateway")
  .version("0.1.0")
  .option("--json", "emit compact JSON for machine consumption")
  .addOption(new Option("--actor-type <type>").choices(["human", "agent", "system"]))
  .option("--actor-name <name>", "audit actor name")
  .option("--source <source>", "originating integration")
  .option("--runtime <runtime>", "Agent runtime name")
  .option("--agent <agent>", "Agent name")
  .option("--session <id>", "Agent session ID")
  .option("--idempotency-key <key>", "stable retry key for create operations");

function globalOptions(): GlobalOptions {
  return program.opts<GlobalOptions>();
}

function actor(): ActorContext {
  const options = globalOptions();
  const agent = options.agent ?? process.env.THREADLINE_AGENT;
  const source = options.source ?? process.env.THREADLINE_SOURCE;
  const runtime = options.runtime ?? process.env.THREADLINE_RUNTIME;
  const sessionId = options.session ?? process.env.THREADLINE_SESSION_ID;
  const actorName =
    options.actorName ??
    process.env.THREADLINE_ACTOR_NAME ??
    agent ??
    process.env.USERNAME ??
    process.env.USER ??
    "threadline-cli";
  return {
    actor_type:
      options.actorType ??
      (process.env.THREADLINE_ACTOR_TYPE as ActorContext["actor_type"] | undefined) ??
      (agent ? "agent" : "human"),
    actor_name: actorName,
    ...(source ? { source } : {}),
    ...(runtime ? { runtime } : {}),
    ...(agent ? { agent } : {}),
    ...(sessionId ? { session_id: sessionId } : {}),
  };
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, globalOptions().json ? 0 : 2)}\n`);
}

function mutationHeaders(): Record<string, string> {
  const key = globalOptions().idempotencyKey ?? process.env.THREADLINE_IDEMPOTENCY_KEY;
  return key ? { "idempotency-key": key } : {};
}

function commaList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const config = program.command("config").description("manage local CLI configuration");

config
  .command("set-url <url>")
  .action(async (url: string) => {
    const current = await readConfig();
    await writeConfig({ ...current, url: url.replace(/\/$/, "") });
    output({ path: configPath(), url: url.replace(/\/$/, "") });
  });

config
  .command("set-token <token>")
  .action(async (token: string) => {
    const current = await readConfig();
    await writeConfig({ ...current, token });
    output({ path: configPath(), token: "********" });
  });

config.command("show").action(async () => {
  const current = await readConfig();
  output({ path: configPath(), url: current.url ?? null, token: current.token ? "********" : null });
});

program.command("status").action(async () => output(await request("/health", {}, false)));

const inbox = program.command("inbox").description("read and manage attention items");
inbox.command("list").action(async () => output(await request("/api/v1/inbox")));
inbox
  .command("read <notification-id>")
  .action(async (id: string) =>
    output(
      await request(`/api/v1/notifications/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "read", actor: actor() }),
      }),
    ),
  );
inbox
  .command("snooze <notification-id>")
  .requiredOption("--until <timestamp>", "UTC ISO 8601 timestamp")
  .action(async (id: string, options: { until: string }) =>
    output(
      await request(`/api/v1/notifications/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "snooze", snoozed_until: options.until, actor: actor() }),
      }),
    ),
  );
inbox
  .command("archive <notification-id>")
  .action(async (id: string) =>
    output(
      await request(`/api/v1/notifications/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "archive", actor: actor() }),
      }),
    ),
  );

program
  .command("workboard")
  .description("read the aggregated workboard")
  .action(async () => output(await request("/api/v1/workboard")));

const initiative = program.command("initiative").description("manage initiatives");
initiative
  .command("create")
  .requiredOption("--title <title>")
  .requiredOption("--intent <intent>")
  .option("--status <status>", "initial status", "active")
  .option("--next-step <step>")
  .action(async (options: { title: string; intent: string; status: string; nextStep?: string }) =>
    output(
      await request("/api/v1/initiatives", {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({
          title: options.title,
          intent: options.intent,
          status: options.status,
          ...(options.nextStep ? { next_step: options.nextStep } : {}),
          actor: actor(),
        }),
      }),
    ),
  );
initiative
  .command("list")
  .option("--status <status>")
  .action(async (options: { status?: string }) =>
    output(await request(`/api/v1/initiatives${options.status ? `?status=${encodeURIComponent(options.status)}` : ""}`)),
  );
initiative
  .command("get <id>")
  .action(async (id: string) => output(await request(`/api/v1/initiatives/${id}`)));
initiative
  .command("update <id>")
  .option("--title <title>")
  .option("--intent <intent>")
  .option("--status <status>")
  .option("--next-step <step>")
  .option("--clear-next-step")
  .action(
    async (
      id: string,
      options: {
        title?: string;
        intent?: string;
        status?: string;
        nextStep?: string;
        clearNextStep?: boolean;
      },
    ) => {
      const fields = {
        ...(options.title ? { title: options.title } : {}),
        ...(options.intent ? { intent: options.intent } : {}),
        ...(options.status ? { status: options.status } : {}),
        ...(options.clearNextStep
          ? { next_step: null }
          : options.nextStep
            ? { next_step: options.nextStep }
            : {}),
      };
      output(
        await request(`/api/v1/initiatives/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...fields, actor: actor() }),
        }),
      );
    },
  );

const submission = program.command("submission").description("submit and inspect standard content");
submission
  .command("create")
  .requiredOption("--kind <kind>")
  .requiredOption("--title <title>")
  .requiredOption("--summary <summary>")
  .option("--detail <detail>")
  .option("--detail-ref <ref>")
  .option("--initiative <id>")
  .option("--attention <policy>", "attention policy", "inbox")
  .option("--dedupe-key <key>")
  .option("--observed")
  .option("--question <question>", "required for decision_request")
  .option("--options <values>", "comma-separated decision options")
  .option("--risk <level>", "decision risk level", "low")
  .action(
    async (options: {
      kind: SubmissionKind;
      title: string;
      summary: string;
      detail?: string;
      detailRef?: string;
      initiative?: string;
      attention: AttentionPolicy;
      dedupeKey?: string;
      observed?: boolean;
      question?: string;
      options?: string;
      risk: string;
    }) => {
      const decision = options.question
        ? {
            question: options.question,
            ...(options.options ? { options: commaList(options.options) } : {}),
            risk_level: options.risk,
          }
        : undefined;
      output(
        await request("/api/v1/submissions", {
          method: "POST",
          headers: mutationHeaders(),
          body: JSON.stringify({
            kind: options.kind,
            title: options.title,
            summary: options.summary,
            ...(options.detail ? { detail: options.detail } : {}),
            ...(options.detailRef ? { detail_ref: options.detailRef } : {}),
            ...(options.initiative ? { initiative_id: options.initiative } : {}),
            attention_policy: options.attention,
            ...(options.dedupeKey ? { dedupe_key: options.dedupeKey } : {}),
            ...(options.observed ? { observed: true } : {}),
            ...(decision ? { decision } : {}),
            actor: actor(),
          }),
        }),
      );
    },
  );
submission
  .command("list")
  .option("--initiative <id>")
  .action(async (options: { initiative?: string }) =>
    output(
      await request(
        `/api/v1/submissions${options.initiative ? `?initiative_id=${encodeURIComponent(options.initiative)}` : ""}`,
      ),
    ),
  );
submission
  .command("get <id>")
  .action(async (id: string) => output(await request(`/api/v1/submissions/${id}`)));

const decision = program.command("decision").description("read and resolve decisions");
decision
  .command("list")
  .option("--status <status>")
  .action(async (options: { status?: string }) =>
    output(await request(`/api/v1/decisions${options.status ? `?status=${encodeURIComponent(options.status)}` : ""}`)),
  );
decision
  .command("get <id>")
  .action(async (id: string) => output(await request(`/api/v1/decisions/${id}`)));
decision
  .command("resolve <id>")
  .requiredOption("--outcome <outcome>")
  .option("--via <via>", "resolution channel", "agent_session")
  .action(async (id: string, options: { outcome: string; via: string }) =>
    output(
      await request(`/api/v1/decisions/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ outcome: options.outcome, resolved_via: options.via, actor: actor() }),
      }),
    ),
  );

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof ApiError) {
    process.stderr.write(`${JSON.stringify({ code: error.code, message: error.message, details: error.details })}\n`);
  } else {
    process.stderr.write(`${(error as Error).message}\n`);
  }
  process.exitCode = 1;
});
