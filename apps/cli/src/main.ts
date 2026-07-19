#!/usr/bin/env node
import { createHash } from "node:crypto";
import type { ActorContext, AttentionPolicy, SubmissionKind, Task } from "@threadline/protocol";
import { Command, Option } from "commander";
import { ApiError, request } from "./client.js";
import {
  type CliConfig,
  type LanguagePolicy,
  type PersistedContext,
  configPath,
  readConfig,
  writeConfig,
} from "./config.js";

interface GlobalOptions {
  json?: boolean;
  dryRun?: boolean;
  explain?: boolean;
  actorType?: "human" | "agent" | "system";
  actorName?: string;
  source?: string;
  runtime?: string;
  agent?: string;
  session?: string;
  initiative?: string;
  language?: string;
  idempotencyKey?: string;
}

interface ResolvedContext {
  actor: ActorContext;
  initiativeId?: string;
}

interface ResolvedLanguage {
  tag: string;
  source: "command" | "session" | "initiative" | "workspace" | "interaction";
}

interface Idempotency {
  key: string;
  source: "command" | "environment" | "automatic";
  formula?: string;
}

interface WriteRequest {
  operation: string;
  path: string;
  method: "POST" | "PATCH";
  body: Record<string, unknown>;
  idempotent?: boolean;
  submission?: boolean;
}

const program = new Command();

program
  .name("threadline")
  .description("CLI for the Threadline Human-Agent Gateway")
  .version("0.1.0")
  .option("--json", "emit compact JSON for machine consumption")
  .option("--dry-run", "print a write receipt without calling the Gateway")
  .option("--explain", "include resolved context and request details in write output")
  .addOption(new Option("--actor-type <type>").choices(["human", "agent", "system"]))
  .option("--actor-name <name>", "audit actor name")
  .option("--source <source>", "originating integration")
  .option("--runtime <runtime>", "Agent runtime name")
  .option("--agent <agent>", "Agent name")
  .option("--session <id>", "Agent session ID")
  .option("--initiative <id>", "default initiative for this command")
  .option("--language <bcp47>, --lang <bcp47>", "content language for this command")
  .option("--idempotency-key <key>", "stable retry key for create operations");

function globalOptions(): GlobalOptions {
  return program.opts<GlobalOptions>();
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, globalOptions().json ? 0 : 2)}\n`);
}

function detectRuntime(): string | undefined {
  if (process.env.CODEX_HOME) return "codex";
  if (process.env.CLAUDE_CODE || process.env.CLAUDE_PROJECT_DIR) return "claude-code";
  if (process.env.CURSOR_TRACE_ID) return "cursor";
  return undefined;
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

async function resolveContext(): Promise<ResolvedContext> {
  const options = globalOptions();
  const config = await readConfig();
  const persisted = config.context ?? {};
  const runtime = firstDefined(options.runtime, process.env.THREADLINE_RUNTIME, persisted.runtime, detectRuntime());
  const agent = firstDefined(options.agent, process.env.THREADLINE_AGENT, persisted.agent);
  const sessionId = firstDefined(
    options.session,
    process.env.THREADLINE_SESSION_ID,
    process.env.CODEX_SESSION_ID,
    process.env.CLAUDE_SESSION_ID,
    persisted.sessionId,
  );
  const source = firstDefined(options.source, process.env.THREADLINE_SOURCE, persisted.source);
  const actorName = firstDefined(
    options.actorName,
    process.env.THREADLINE_ACTOR_NAME,
    persisted.actorName,
    agent,
    process.env.USERNAME,
    process.env.USER,
    "threadline-cli",
  );
  const actorType = firstDefined<ActorContext["actor_type"]>(
    options.actorType,
    process.env.THREADLINE_ACTOR_TYPE as ActorContext["actor_type"] | undefined,
    persisted.actorType,
    agent ? "agent" : "human",
  );
  const initiativeId = firstDefined(
    options.initiative,
    process.env.THREADLINE_INITIATIVE,
    persisted.initiativeId,
  );

  return {
    actor: {
      actor_type: actorType ?? "human",
      actor_name: actorName ?? "threadline-cli",
      ...(source ? { source } : {}),
      ...(runtime ? { runtime } : {}),
      ...(agent ? { agent } : {}),
      ...(sessionId ? { session_id: sessionId } : {}),
    },
    ...(initiativeId ? { initiativeId } : {}),
  };
}

function validateLanguage(tag: string): string {
  try {
    const canonical = Intl.getCanonicalLocales(tag)[0];
    if (!canonical) throw new Error("empty language");
    return canonical;
  } catch {
    throw new Error(`Language must be a valid BCP 47 tag: ${tag}`);
  }
}

function inferInteractionLanguage(): string {
  const raw = process.env.THREADLINE_INTERACTION_LANGUAGE ?? process.env.LANG ?? "en";
  const normalized = raw.split(".")[0]!.replace(/_/g, "-");
  return /^(?:C|POSIX)$/i.test(normalized) ? "en" : normalized;
}

function resolveLanguage(
  policy: LanguagePolicy | undefined,
  context: ResolvedContext,
): ResolvedLanguage | undefined {
  const options = globalOptions();
  const sessionId = context.actor.session_id;
  const initiativeId = context.initiativeId;
  const candidate = options.language
    ? { tag: options.language, source: "command" as const }
    : sessionId && policy?.sessions?.[sessionId]
      ? { tag: policy.sessions[sessionId], source: "session" as const }
      : initiativeId && policy?.initiatives?.[initiativeId]
        ? { tag: policy.initiatives[initiativeId], source: "initiative" as const }
        : policy?.fixed
          ? { tag: policy.fixed, source: "workspace" as const }
          : { tag: policy?.interaction ?? inferInteractionLanguage(), source: "interaction" as const };
  return { ...candidate, tag: validateLanguage(candidate.tag) };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function resolveIdempotency(operation: string, body: Record<string, unknown>): Idempotency {
  const explicit = globalOptions().idempotencyKey;
  if (explicit) return { key: explicit, source: "command" };
  const environment = process.env.THREADLINE_IDEMPOTENCY_KEY;
  if (environment) return { key: environment, source: "environment" };
  const digest = createHash("sha256").update(canonicalJson({ operation, body })).digest("hex");
  return {
    key: `threadline/v1/${operation}/${digest}`,
    source: "automatic",
    formula: "threadline/v1/<operation>/sha256(canonical-json({operation,body}))",
  };
}

function writeReceipt(
  requestDetails: WriteRequest,
  context: ResolvedContext,
  language: ResolvedLanguage | undefined,
  idempotency: Idempotency | undefined,
  body: Record<string, unknown>,
): Record<string, unknown> {
  return {
    dry_run: Boolean(globalOptions().dryRun),
    operation: requestDetails.operation,
    request: {
      method: requestDetails.method,
      path: requestDetails.path,
      headers: {
        ...(idempotency ? { "idempotency-key": idempotency.key } : {}),
        ...(language ? { "x-threadline-language": language.tag } : {}),
      },
      body,
    },
    context: { ...context.actor, ...(context.initiativeId ? { initiative_id: context.initiativeId } : {}) },
    language: language
      ? {
          tag: language.tag,
          source: language.source,
          api_contract: requestDetails.submission
            ? "content_language is sent in the submission body; x-threadline-language is compatibility metadata."
            : "x-threadline-language is compatibility metadata for this write.",
        }
      : null,
    idempotency: idempotency
      ? { key: idempotency.key, source: idempotency.source, ...(idempotency.formula ? { formula: idempotency.formula } : {}) }
      : null,
  };
}

async function write<T>(
  requestDetails: WriteRequest,
  context: ResolvedContext,
  emit = true,
): Promise<T | Record<string, unknown>> {
  const config = await readConfig();
  const language = resolveLanguage(config.language, context);
  const body = {
    ...requestDetails.body,
    ...(requestDetails.submission && language ? { content_language: language.tag } : {}),
  };
  const idempotency = requestDetails.idempotent
    ? resolveIdempotency(requestDetails.operation, body)
    : undefined;
  const receipt = writeReceipt(requestDetails, context, language, idempotency, body);

  if (globalOptions().dryRun) {
    if (emit) output(receipt);
    return receipt;
  }

  const result = await request<T>(requestDetails.path, {
    method: requestDetails.method,
    headers: {
      ...(idempotency ? { "idempotency-key": idempotency.key } : {}),
      ...(language ? { "x-threadline-language": language.tag } : {}),
    },
    body: JSON.stringify(body),
  });
  const rendered = globalOptions().explain ? { result, receipt } : result;
  if (emit) output(rendered);
  return rendered;
}

function commaList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function initiativeId(explicit: string | undefined, context: ResolvedContext): string {
  const id = explicit ?? context.initiativeId;
  if (!id) {
    throw new Error("Initiative ID is required. Pass an ID, use --initiative, or run attach --initiative <id>.");
  }
  return id;
}

function compactContext(context: PersistedContext): PersistedContext {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined && value !== ""),
  ) as PersistedContext;
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
  output({
    path: configPath(),
    url: current.url ?? null,
    token: current.token ? "********" : null,
    context: current.context ?? null,
    language: current.language ?? null,
  });
});

const languageConfig = config.command("language").description("configure BCP 47 language policy");
languageConfig.command("show").action(async () => output((await readConfig()).language ?? {}));
languageConfig
  .command("set <scope> <language>")
  .addOption(new Option("--session <id>", "session override key"))
  .addOption(new Option("--initiative <id>", "initiative override key"))
  .action(async (scope: string, language: string, options: { session?: string; initiative?: string }) => {
    const tag = validateLanguage(language);
    const current = await readConfig();
    const policy: LanguagePolicy = { ...(current.language ?? {}) };
    if (scope === "interaction") policy.interaction = tag;
    else if (scope === "fixed") policy.fixed = tag;
    else if (scope === "session") {
      const context = await resolveContext();
      const key = options.session ?? context.actor.session_id;
      if (!key) throw new Error("A session override needs --session <id> or an attached session.");
      policy.sessions = { ...(policy.sessions ?? {}), [key]: tag };
    } else if (scope === "initiative") {
      const context = await resolveContext();
      const key = options.initiative ?? context.initiativeId;
      if (!key) throw new Error("An initiative override needs --initiative <id> or an attached initiative.");
      policy.initiatives = { ...(policy.initiatives ?? {}), [key]: tag };
    } else {
      throw new Error("Language scope must be interaction, fixed, session, or initiative.");
    }
    await writeConfig({ ...current, language: policy });
    output({ path: configPath(), language: policy });
  });

config
  .command("set-content-language <mode>")
  .option("--lang <bcp47>")
  .option("--initiative <id>")
  .action(async (mode: string, options: { lang?: string; initiative?: string }) => {
    const current = await readConfig();
    const policy: LanguagePolicy = { ...(current.language ?? {}) };
    if (mode === "interaction") {
      delete policy.fixed;
    } else if (mode === "fixed") {
      if (!options.lang) throw new Error("fixed content language requires --lang <bcp47>.");
      policy.fixed = validateLanguage(options.lang);
    } else if (mode === "initiative") {
      if (!options.lang) throw new Error("initiative content language requires --lang <bcp47>.");
      const context = await resolveContext();
      const id = options.initiative ?? context.initiativeId;
      if (!id) throw new Error("initiative content language requires --initiative <id> or attached context.");
      policy.initiatives = { ...(policy.initiatives ?? {}), [id]: validateLanguage(options.lang) };
    } else {
      throw new Error("Content language mode must be interaction, fixed, or initiative.");
    }
    await writeConfig({ ...current, language: policy });
    output({ path: configPath(), content_language_mode: mode, language: policy });
  });

program
  .command("attach")
  .description("persist default Agent and initiative context")
  .addOption(new Option("--actor-type <type>").choices(["human", "agent", "system"]))
  .option("--actor-name <name>")
  .option("--source <source>")
  .option("--runtime <runtime>")
  .option("--agent <agent>")
  .option("--session <id>")
  .option("--initiative <id>")
  .option("--clear", "remove the persisted context before applying supplied values")
  .action(async (options: PersistedContext & { session?: string; initiative?: string; clear?: boolean }) => {
    const current = await readConfig();
    const global = globalOptions();
    const context: PersistedContext = { ...(options.clear ? {} : current.context ?? {}) };
    const actorType = firstDefined(options.actorType, global.actorType);
    const actorName = firstDefined(options.actorName, global.actorName);
    const source = firstDefined(options.source, global.source);
    const runtime = firstDefined(options.runtime, global.runtime);
    const agent = firstDefined(options.agent, global.agent);
    const sessionId = firstDefined(options.sessionId, options.session, global.session);
    const initiativeId = firstDefined(options.initiativeId, options.initiative, global.initiative);
    if (actorType) context.actorType = actorType;
    if (actorName) context.actorName = actorName;
    if (source) context.source = source;
    if (runtime) context.runtime = runtime;
    if (agent) context.agent = agent;
    if (sessionId) context.sessionId = sessionId;
    if (initiativeId) context.initiativeId = initiativeId;
    const compact = compactContext(context);
    if (Object.keys(compact).length > 0) {
      await writeConfig({ ...current, context: compact });
    } else {
      const { context: _context, ...withoutContext } = current;
      await writeConfig(withoutContext);
    }
    output({ path: configPath(), context: Object.keys(compact).length > 0 ? compact : null });
  });

program.command("status").action(async () => output(await request("/health", {}, false)));

const inbox = program.command("inbox").description("read and manage attention items");
inbox.command("list").action(async () => output(await request("/api/v1/inbox")));
inbox
  .command("read <notification-id>")
  .action(async (id: string) => {
    const context = await resolveContext();
    await write({ operation: "notification.read", path: `/api/v1/notifications/${id}`, method: "PATCH", body: { action: "read", actor: context.actor } }, context);
  });
inbox
  .command("snooze <notification-id>")
  .requiredOption("--until <timestamp>", "UTC ISO 8601 timestamp")
  .action(async (id: string, options: { until: string }) => {
    const context = await resolveContext();
    await write({ operation: "notification.snooze", path: `/api/v1/notifications/${id}`, method: "PATCH", body: { action: "snooze", snoozed_until: options.until, actor: context.actor } }, context);
  });
inbox
  .command("archive <notification-id>")
  .action(async (id: string) => {
    const context = await resolveContext();
    await write({ operation: "notification.archive", path: `/api/v1/notifications/${id}`, method: "PATCH", body: { action: "archive", actor: context.actor } }, context);
  });

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
  .action(async (options: { title: string; intent: string; status: string; nextStep?: string }) => {
    const context = await resolveContext();
    await write({ operation: "initiative.create", path: "/api/v1/initiatives", method: "POST", idempotent: true, body: { title: options.title, intent: options.intent, status: options.status, ...(options.nextStep ? { next_step: options.nextStep } : {}), actor: context.actor } }, context);
  });

const task = program.command("task").description("manage project-scoped Tasks");
task
  .command("create")
  .requiredOption("--initiative <id>")
  .requiredOption("--title <title>")
  .option("--detail <detail>")
  .action(async (options: { initiative: string; title: string; detail?: string }) => {
    const context = await resolveContext();
    await write({
      operation: "task.create", path: "/api/v1/tasks", method: "POST", idempotent: true,
      body: { initiative_id: options.initiative, title: options.title, ...(options.detail ? { detail: options.detail } : {}), actor: context.actor },
    }, context);
  });
task
  .command("list")
  .requiredOption("--initiative <id>")
  .action(async (options: { initiative: string }) => output(await request<Task[]>(`/api/v1/tasks?initiative_id=${encodeURIComponent(options.initiative)}`)));
task.command("get <id>").action(async (id: string) => output(await request<Task>(`/api/v1/tasks/${id}`)));
task
  .command("update <id>")
  .option("--title <title>")
  .option("--detail <detail>")
  .option("--clear-detail")
  .option("--complete")
  .option("--reopen")
  .action(async (id: string, options: { title?: string; detail?: string; clearDetail?: boolean; complete?: boolean; reopen?: boolean }) => {
    if (options.complete && options.reopen) throw new Error("Choose either --complete or --reopen.");
    const context = await resolveContext();
    await write({
      operation: "task.update", path: `/api/v1/tasks/${id}`, method: "PATCH",
      body: { ...(options.title ? { title: options.title } : {}), ...(options.clearDetail ? { detail: null } : options.detail ? { detail: options.detail } : {}), ...(options.complete ? { status: "completed" } : options.reopen ? { status: "open" } : {}), actor: context.actor },
    }, context);
  });
const taskSubmission = task.command("submission").description("manage Task Submission links");
taskSubmission.command("list <task-id>").action(async (id: string) => output(await request(`/api/v1/tasks/${id}/submissions`)));
taskSubmission
  .command("link <task-id>")
  .requiredOption("--submission <id>")
  .action(async (id: string, options: { submission: string }) => {
    const context = await resolveContext();
    await write({ operation: "task.submission.link", path: `/api/v1/tasks/${id}/submissions/${options.submission}`, method: "POST", body: { submission_id: options.submission, actor: context.actor } }, context);
  });
taskSubmission
  .command("unlink <task-id>")
  .requiredOption("--submission <id>")
  .action(async (id: string, options: { submission: string }) => {
    const context = await resolveContext();
    await write({ operation: "task.submission.unlink", path: `/api/v1/tasks/${id}/submissions/${options.submission}`, method: "PATCH", body: { submission_id: options.submission, actor: context.actor } }, context);
  });
initiative
  .command("list")
  .option("--status <status>")
  .action(async (options: { status?: string }) => output(await request(`/api/v1/initiatives${options.status ? `?status=${encodeURIComponent(options.status)}` : ""}`)));
initiative.command("get <id>").action(async (id: string) => output(await request(`/api/v1/initiatives/${id}`)));
initiative
  .command("update <id>")
  .option("--title <title>")
  .option("--intent <intent>")
  .option("--status <status>")
  .option("--next-step <step>")
  .option("--clear-next-step")
  .action(async (id: string, options: { title?: string; intent?: string; status?: string; nextStep?: string; clearNextStep?: boolean }) => {
    const context = await resolveContext();
    const fields = {
      ...(options.title ? { title: options.title } : {}),
      ...(options.intent ? { intent: options.intent } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.clearNextStep ? { next_step: null } : options.nextStep ? { next_step: options.nextStep } : {}),
    };
    await write({ operation: "initiative.update", path: `/api/v1/initiatives/${id}`, method: "PATCH", body: { ...fields, actor: context.actor } }, context);
  });

const submission = program.command("submission").description("submit and inspect standard content");
submission
  .command("create")
  .requiredOption("--kind <kind>")
  .requiredOption("--title <title>")
  .requiredOption("--summary <summary>")
  .option("--detail <detail>")
  .option("--detail-ref <ref>")
  .option("--evidence <refs>", "comma-separated durable evidence references")
  .option("--initiative <id>")
  .option("--attention <policy>", "attention policy", "inbox")
  .option("--dedupe-key <key>")
  .option("--observed")
  .option("--question <question>", "required for decision_request")
  .option("--options <values>", "comma-separated decision options")
  .option("--risk <level>", "decision risk level", "low")
  .action(async (options: { kind: SubmissionKind; title: string; summary: string; detail?: string; detailRef?: string; evidence?: string; initiative?: string; attention: AttentionPolicy; dedupeKey?: string; observed?: boolean; question?: string; options?: string; risk: string }) => {
    const context = await resolveContext();
    const decision = options.question ? { question: options.question, ...(options.options ? { options: commaList(options.options) } : {}), risk_level: options.risk } : undefined;
    await write({
      operation: "submission.create",
      path: "/api/v1/submissions",
      method: "POST",
      idempotent: true,
      submission: true,
      body: {
        kind: options.kind,
        title: options.title,
        summary: options.summary,
        ...(options.detail ? { detail: options.detail } : {}),
        ...(options.detailRef ? { detail_ref: options.detailRef } : {}),
        ...(options.evidence ? { evidence_refs: commaList(options.evidence) } : {}),
        ...(options.initiative ?? context.initiativeId ? { initiative_id: options.initiative ?? context.initiativeId } : {}),
        attention_policy: options.attention,
        ...(options.dedupeKey ? { dedupe_key: options.dedupeKey } : {}),
        ...(options.observed ? { observed: true } : {}),
        ...(decision ? { decision } : {}),
        actor: context.actor,
      },
    }, context);
  });
submission
  .command("list")
  .option("--initiative <id>")
  .action(async (options: { initiative?: string }) => output(await request(`/api/v1/submissions${options.initiative ? `?initiative_id=${encodeURIComponent(options.initiative)}` : ""}`)));
submission.command("get <id>").action(async (id: string) => output(await request(`/api/v1/submissions/${id}`)));

const decision = program.command("decision").description("read and resolve decisions");
decision
  .command("list")
  .option("--status <status>")
  .action(async (options: { status?: string }) => output(await request(`/api/v1/decisions${options.status ? `?status=${encodeURIComponent(options.status)}` : ""}`)));
decision.command("get <id>").action(async (id: string) => output(await request(`/api/v1/decisions/${id}`)));
decision
  .command("resolve <id>")
  .requiredOption("--outcome <outcome>")
  .option("--via <via>", "resolution channel", "agent_session")
  .action(async (id: string, options: { outcome: string; via: string }) => {
    const context = await resolveContext();
    await write({ operation: "decision.resolve", path: `/api/v1/decisions/${id}/resolve`, method: "POST", body: { outcome: options.outcome, resolved_via: options.via, actor: context.actor } }, context);
  });

function lifecycleCommand(
  name: "ready" | "wait" | "done",
  status: "active" | "waiting_for_jim" | "completed",
): void {
  const command = program.command(`${name} [initiative-id]`).option("--next-step <step>").option("--next <step>");
  if (name === "wait") {
    command
      .option("--on <blocker>", "blocker: human, external, or failed")
      .option("--for <target>", "legacy waiting target: jim or agent")
      .option("--question <question>", "create a decision request while waiting for a human")
      .option("--title <title>", "decision request title", "Decision needed")
      .option("--attention <policy>", "decision request attention policy", "inbox");
  }
  if (name === "done") {
    command
      .option("--title <title>", "completion delivery title", "Initiative completed")
      .option("--summary <summary>", "completion delivery summary")
      .option("--attention <policy>", "completion delivery attention policy", "record_only");
  }
  command.action(
    async (
      id: string | undefined,
      options: { nextStep?: string; next?: string; for?: string; on?: "human" | "external" | "failed"; question?: string; title?: string; summary?: string; attention?: AttentionPolicy },
    ) => {
      const context = await resolveContext();
      const target = initiativeId(id, context);
      const nextAction = options.next ?? options.nextStep;
      const blocker = name === "wait"
        ? options.on ?? (options.for === "agent" ? "none" : "human")
        : "none";
      if (name === "wait" && options.for && !["jim", "agent"].includes(options.for)) throw new Error("wait --for must be jim or agent.");
      if (name === "wait" && options.question && blocker !== "human") throw new Error("wait --question requires --on human.");
      const waitStatus = name === "wait" && options.for === "agent" ? "waiting_for_agent" : status;
      const stateRequest: WriteRequest = {
        operation: `initiative.${name}`,
        path: `/api/v1/initiatives/${target}`,
        method: "PATCH",
        body: {
          status: waitStatus,
          lifecycle: name === "done" ? "done" : "open",
          blocker,
          owner: name === "done" || blocker !== "none" ? (blocker === "human" ? "human" : "none") : "agent",
          ...(nextAction ? { next_step: nextAction, next_action: nextAction } : {}),
          actor: context.actor,
        },
      };
      if (name !== "done") {
        if (name === "wait" && options.question) {
          await write({
            operation: "initiative.wait.decision",
            path: "/api/v1/submissions",
            method: "POST",
            idempotent: true,
            submission: true,
            body: {
              kind: "decision_request",
              title: options.title ?? "Decision needed",
              summary: options.question,
              initiative_id: target,
              attention_policy: options.attention ?? "inbox",
              decision: { question: options.question, risk_level: "low" },
              actor: context.actor,
            },
          }, context, false);
        }
        await write(stateRequest, context);
        return;
      }
      const delivery = await write(
        {
          operation: "initiative.done.delivery",
          path: "/api/v1/submissions",
          method: "POST",
          idempotent: true,
          submission: true,
          body: {
            kind: "delivery",
            title: options.title ?? "Initiative completed",
            summary: options.summary ?? `Initiative ${target} has been marked complete.`,
            initiative_id: target,
            attention_policy: options.attention ?? "record_only",
            initiative_update: { lifecycle: "done", blocker: "none", owner: "none", ...(nextAction ? { next_action: nextAction } : {}) },
            actor: context.actor,
          },
        },
        context,
        false,
      );
      const state = await request(`/api/v1/initiatives/${target}`);
      output({ delivery, state });
    },
  );
}

lifecycleCommand("ready", "active");
lifecycleCommand("wait", "waiting_for_jim");
lifecycleCommand("done", "completed");

program.command("sync").description("record an event and its projected state, or inspect attached context")
  .option("--event <event>")
  .option("--title <title>")
  .option("--summary <summary>")
  .option("--status <status>", "ready, waiting, or done")
  .option("--next <action>")
  .option("--on <blocker>", "human, external, or failed")
  .option("--evidence <refs>")
  .option("--attention <policy>", "attention policy", "record_only")
  .option("--observed")
  .action(async (options: { event?: string; title?: string; summary?: string; status?: "ready" | "waiting" | "done"; next?: string; on?: "human" | "external" | "failed"; evidence?: string; attention: AttentionPolicy; observed?: boolean }) => {
  const context = await resolveContext();
  if (options.event || options.summary) {
    const target = initiativeId(undefined, context);
    const status = options.status ?? "ready";
    const blocker = status === "waiting" ? options.on ?? "external" : "none";
    const owner = status === "done" || blocker !== "none" ? (blocker === "human" ? "human" : "none") : "agent";
    await write({
      operation: "initiative.sync",
      path: "/api/v1/submissions",
      method: "POST",
      idempotent: true,
      submission: true,
      body: {
        kind: status === "done" ? "delivery" : "progress_update",
        title: options.title ?? options.event ?? "Initiative synchronized",
        summary: options.summary ?? options.event ?? "Initiative state synchronized.",
        initiative_id: target,
        attention_policy: options.attention,
        ...(options.evidence ? { evidence_refs: commaList(options.evidence) } : {}),
        ...(options.observed ? { observed: true } : {}),
        initiative_update: {
          lifecycle: status === "done" ? "done" : "open",
          blocker,
          owner,
          ...(options.next ? { next_action: options.next } : {}),
        },
        actor: context.actor,
      },
    }, context);
    return;
  }
  const [workboard, decisions] = await Promise.all([
    request("/api/v1/workboard"),
    context.initiativeId ? request(`/api/v1/decisions?initiative_id=${encodeURIComponent(context.initiativeId)}`) : Promise.resolve(undefined),
  ]);
  output({ context: { ...context.actor, ...(context.initiativeId ? { initiative_id: context.initiativeId } : {}) }, workboard, ...(decisions ? { decisions } : {}) });
});

program.command("verify-complete [initiative-id]").description("verify an initiative is completed with no unresolved decisions").action(async (id: string | undefined) => {
  const context = await resolveContext();
  const target = initiativeId(id, context);
  const [item, decisions, submissions] = await Promise.all([
    request<{ status?: string }>(`/api/v1/initiatives/${target}`),
    request<Array<{ id: string; status: string }>>(`/api/v1/decisions?initiative_id=${encodeURIComponent(target)}`),
    request<Array<{ kind: string }>>(`/api/v1/submissions?initiative_id=${encodeURIComponent(target)}`),
  ]);
  const unresolved = decisions.filter((entry) => !["resolved", "expired", "superseded"].includes(entry.status));
  const deliveries = submissions.filter((entry) => entry.kind === "delivery");
  const complete = item.status === "completed" && unresolved.length === 0 && deliveries.length > 0;
  output({ initiative_id: target, complete, checks: { initiative_status: item.status, unresolved_decisions: unresolved, deliveries: deliveries.length } });
  if (!complete) process.exitCode = 2;
});

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof ApiError) {
    process.stderr.write(`${JSON.stringify({ code: error.code, message: error.message, details: error.details })}\n`);
  } else {
    process.stderr.write(`${(error as Error).message}\n`);
  }
  process.exitCode = 1;
});
