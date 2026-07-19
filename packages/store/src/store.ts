import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type {
  ActorContext,
  AuditEvent,
  CreateTaskInput,
  CreateInitiativeInput,
  CreateSubmissionInput,
  Decision,
  DecisionStatus,
  InboxItem,
  Initiative,
  InitiativeBlocker,
  InitiativeLifecycle,
  InitiativeOwner,
  InitiativeStatus,
  Notification,
  ResolveDecisionInput,
  Submission,
  SubmissionResult,
  Task,
  UpdateTaskInput,
  UpdateInitiativeInput,
  UpdateNotificationInput,
  Workboard,
} from "@threadline/protocol";
import { migrate } from "./migrations.js";

type DecisionRow = Omit<Decision, "options"> & { options_json: string | null };
type SubmissionRow = Omit<Submission, "evidence_refs"> & { evidence_refs_json: string };
type EventRow = Omit<AuditEvent, "payload"> & { payload_json: string | null };
type IdempotencyRow = {
  operation: string;
  request_hash: string;
  response_json: string;
};

export interface CreateSubmissionOutcome {
  result: SubmissionResult;
  created: boolean;
}

export interface SubmissionFilters {
  initiative_id?: string;
  host?: string;
  tool?: string;
  session_id?: string;
}

export class StoreError extends Error {
  constructor(
    public readonly code: "not_found" | "conflict" | "invalid_request",
    message: string,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

function now(): string {
  return new Date().toISOString();
}

function sourceFor(actor: ActorContext): string {
  return actor.source ?? actor.runtime ?? actor.actor_name;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

type InitiativeStatePatch = {
  lifecycle?: InitiativeLifecycle;
  blocker?: InitiativeBlocker;
  owner?: InitiativeOwner;
  next_action?: string | null;
  status?: InitiativeStatus;
  next_step?: string | null;
};

function stateForStatus(status: InitiativeStatus): Pick<
  Initiative,
  "lifecycle" | "blocker" | "owner"
> {
  switch (status) {
    case "waiting_for_jim":
      return { lifecycle: "open", blocker: "human", owner: "human" };
    case "paused":
      return { lifecycle: "open", blocker: "external", owner: "none" };
    case "completed":
    case "cancelled":
      return { lifecycle: "done", blocker: "none", owner: "none" };
    case "waiting_for_agent":
    case "active":
      return { lifecycle: "open", blocker: "none", owner: "agent" };
  }
}

function hasSemanticState(input: InitiativeStatePatch): boolean {
  return ["lifecycle", "blocker", "owner", "next_action"].some((key) => hasOwn(input, key));
}

function legacyStatusFor(
  state: Pick<Initiative, "lifecycle" | "blocker" | "owner">,
  priorStatus: InitiativeStatus | undefined,
): InitiativeStatus {
  if (state.lifecycle === "done") return "completed";
  if (state.blocker === "human") return "waiting_for_jim";
  if (state.blocker === "external" || state.blocker === "failed" || state.owner === "none") {
    return "paused";
  }
  return priorStatus === "waiting_for_agent" ? "waiting_for_agent" : "active";
}

function deriveInitiativeState(
  current: Initiative | undefined,
  input: InitiativeStatePatch,
): Pick<Initiative, "status" | "lifecycle" | "blocker" | "owner" | "next_step" | "next_action"> {
  const baseStatus = input.status ?? current?.status ?? "active";
  const base = input.status ? stateForStatus(input.status) : current ?? stateForStatus(baseStatus);
  const lifecycle = input.lifecycle ?? base.lifecycle;
  const blocker = input.blocker ?? base.blocker;
  const owner = input.owner ?? base.owner;
  const nextAction = hasOwn(input, "next_action")
    ? input.next_action ?? null
    : hasOwn(input, "next_step")
      ? input.next_step ?? null
      : current?.next_action ?? current?.next_step ?? null;
  const status = !hasSemanticState(input) && input.status
    ? input.status
    : legacyStatusFor({ lifecycle, blocker, owner }, input.status ?? current?.status ?? baseStatus);
  return { status, lifecycle, blocker, owner, next_step: nextAction, next_action: nextAction };
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export class ThreadlineStore {
  readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    migrate(this.db);
  }

  close(): void {
    this.db.close();
  }

  createInitiative(input: CreateInitiativeInput, idempotencyKey?: string): Initiative {
    const cached = this.readIdempotent<Initiative>(idempotencyKey, "initiative.create", input);
    if (cached) return cached;

    const timestamp = now();
    const state = deriveInitiativeState(undefined, input);
    const initiative: Initiative = {
      id: randomUUID(),
      title: input.title,
      intent: input.intent,
      ...state,
      created_at: timestamp,
      updated_at: timestamp,
      last_activity_at: timestamp,
      created_by: input.actor.actor_name,
    };

    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO initiatives
           (id, title, intent, status, next_step, lifecycle, blocker, owner, next_action,
            created_at, updated_at, last_activity_at, created_by)
           VALUES (@id, @title, @intent, @status, @next_step, @lifecycle, @blocker, @owner,
                   @next_action, @created_at, @updated_at, @last_activity_at, @created_by)`,
        )
        .run(initiative);
      this.writeEvent("initiative", initiative.id, "initiative.created", input.actor, {
        status: initiative.status,
        lifecycle: initiative.lifecycle,
        blocker: initiative.blocker,
        owner: initiative.owner,
      });
      this.writeIdempotent(idempotencyKey, "initiative.create", input, initiative);
    });
    write();
    return initiative;
  }

  getInitiative(id: string): Initiative {
    const initiative = this.db.prepare("SELECT * FROM initiatives WHERE id = ?").get(id) as
      | Initiative
      | undefined;
    if (!initiative) {
      throw new StoreError("not_found", `Initiative ${id} was not found`);
    }
    return initiative;
  }

  listInitiatives(status?: InitiativeStatus): Initiative[] {
    if (status) {
      return this.db
        .prepare("SELECT * FROM initiatives WHERE status = ? ORDER BY last_activity_at DESC")
        .all(status) as Initiative[];
    }
    return this.db
      .prepare("SELECT * FROM initiatives ORDER BY last_activity_at DESC")
      .all() as Initiative[];
  }

  updateInitiative(id: string, input: UpdateInitiativeInput): Initiative {
    return this.db.transaction(() => {
      const current = this.getInitiative(id);
      const timestamp = now();
      const state = deriveInitiativeState(current, input);
      this.assertInitiativeCanTransitionToDone(current, state.lifecycle);
      const updated: Initiative = {
        ...current,
        title: input.title ?? current.title,
        intent: input.intent ?? current.intent,
        ...state,
        updated_at: timestamp,
        last_activity_at: timestamp,
      };
      this.db
        .prepare(
          `UPDATE initiatives
           SET title = @title, intent = @intent, status = @status, next_step = @next_step,
               lifecycle = @lifecycle, blocker = @blocker, owner = @owner, next_action = @next_action,
               updated_at = @updated_at, last_activity_at = @last_activity_at
           WHERE id = @id`,
        )
        .run(updated);
      this.writeEvent("initiative", id, "initiative.updated", input.actor, {
        status: updated.status,
        lifecycle: updated.lifecycle,
        blocker: updated.blocker,
        owner: updated.owner,
        next_action: updated.next_action,
      });
      return updated;
    })();
  }

  private assertInitiativeCanTransitionToDone(
    initiative: Initiative,
    lifecycle: InitiativeLifecycle,
  ): void {
    if (initiative.lifecycle === "done" || lifecycle !== "done") return;
    const openTask = this.db
      .prepare("SELECT 1 FROM tasks WHERE initiative_id = ? AND status = 'open' LIMIT 1")
      .get(initiative.id);
    if (openTask) {
      throw new StoreError(
        "conflict",
        `Initiative ${initiative.id} cannot transition to done while it has open Tasks`,
      );
    }
  }

  private assertInitiativeAcceptsOpenTasks(initiative: Initiative): void {
    if (initiative.lifecycle === "done") {
      throw new StoreError("conflict", `Initiative ${initiative.id} is done and cannot accept open Tasks`);
    }
  }

  createSubmission(input: CreateSubmissionInput, idempotencyKey?: string): SubmissionResult {
    return this.createSubmissionWithOutcome(input, idempotencyKey).result;
  }

  createSubmissionWithOutcome(
    input: CreateSubmissionInput,
    idempotencyKey?: string,
  ): CreateSubmissionOutcome {
    if (input.kind === "decision_request" && !input.decision) {
      throw new StoreError("invalid_request", "decision_request requires decision data");
    }
    if (input.kind !== "decision_request" && input.decision) {
      throw new StoreError("invalid_request", "Only decision_request may include decision data");
    }
    if (input.initiative_update && !input.initiative_id) {
      throw new StoreError("invalid_request", "initiative_update requires initiative_id");
    }
    if (input.initiative_id) {
      this.getInitiative(input.initiative_id);
    }
    const cached = this.readIdempotent<SubmissionResult>(
      idempotencyKey,
      "submission.create",
      input,
    );
    if (cached) return { result: cached, created: false };

    const result = this.db.transaction((): SubmissionResult => {
      const timestamp = now();
      const submission: Submission = {
        id: randomUUID(),
        kind: input.kind,
        title: input.title,
        summary: input.summary,
        detail: input.detail ?? null,
        detail_ref: input.detail_ref ?? null,
        content_language: input.content_language ?? "und",
        evidence_refs: input.evidence_refs ?? [],
        initiative_id: input.initiative_id ?? null,
        attention_policy: input.attention_policy,
        dedupe_key: input.dedupe_key ?? null,
        host: input.actor.host ?? null,
        tool: input.actor.tool ?? input.actor.runtime ?? null,
        source: sourceFor(input.actor),
        runtime: input.actor.runtime ?? null,
        agent: input.actor.agent ?? null,
        session_id: input.actor.session_id ?? null,
        observed_at: input.observed ? timestamp : null,
        created_at: timestamp,
        created_by: input.actor.actor_name,
      };
      this.db
        .prepare(
          `INSERT INTO submissions
           (id, kind, title, summary, detail, detail_ref, content_language, evidence_refs_json,
            initiative_id, attention_policy,
            dedupe_key, host, tool, source, runtime, agent, session_id, observed_at, created_at, created_by)
           VALUES (@id, @kind, @title, @summary, @detail, @detail_ref, @content_language,
                   @evidence_refs_json, @initiative_id, @attention_policy, @dedupe_key, @host,
                   @tool, @source, @runtime, @agent, @session_id, @observed_at, @created_at, @created_by)`,
        )
        .run({ ...submission, evidence_refs_json: JSON.stringify(submission.evidence_refs) });

      let decision: Decision | null = null;
      if (input.decision) {
        decision = {
          id: randomUUID(),
          submission_id: submission.id,
          initiative_id: submission.initiative_id,
          question: input.decision.question,
          options: input.decision.options ?? null,
          risk_level: input.decision.risk_level ?? "low",
          status: "open",
          resolution: null,
          resolved_via: null,
          resolved_by: null,
          resolved_at: null,
          created_at: timestamp,
          updated_at: timestamp,
        };
        this.db
          .prepare(
            `INSERT INTO decisions
             (id, submission_id, initiative_id, question, options_json, risk_level, status,
              resolution, resolved_via, resolved_by, resolved_at, created_at, updated_at)
             VALUES (@id, @submission_id, @initiative_id, @question, @options_json, @risk_level,
                     @status, @resolution, @resolved_via, @resolved_by, @resolved_at, @created_at,
                     @updated_at)`,
          )
          .run({ ...decision, options_json: decision.options ? JSON.stringify(decision.options) : null });
      }

      const suppression = this.notificationSuppression(input);
      const notification: Notification = {
        id: randomUUID(),
        submission_id: submission.id,
        channel: "web",
        status: suppression ? "suppressed" : "active",
        suppression_reason: suppression,
        snoozed_until: null,
        created_at: timestamp,
        updated_at: timestamp,
      };
      this.db
        .prepare(
          `INSERT INTO notifications
           (id, submission_id, channel, status, suppression_reason, snoozed_until, created_at, updated_at)
           VALUES (@id, @submission_id, @channel, @status, @suppression_reason, @snoozed_until,
                   @created_at, @updated_at)`,
        )
        .run(notification);

      if (submission.initiative_id) {
        const initiativeBefore = this.getInitiative(submission.initiative_id);
        const impliedState: InitiativeStatePatch | undefined =
          submission.kind === "decision_request" &&
          ["active", "waiting_for_agent"].includes(initiativeBefore.status)
            ? { status: "waiting_for_jim", blocker: "human", owner: "human" }
            : undefined;
        const statePatch = input.initiative_update ?? impliedState;
        if (statePatch) {
          const state = deriveInitiativeState(initiativeBefore, statePatch);
          this.assertInitiativeCanTransitionToDone(initiativeBefore, state.lifecycle);
          this.db
            .prepare(
              `UPDATE initiatives
               SET status = ?, next_step = ?, lifecycle = ?, blocker = ?, owner = ?, next_action = ?,
                   last_activity_at = ?, updated_at = ?
               WHERE id = ?`,
            )
            .run(
              state.status,
              state.next_step,
              state.lifecycle,
              state.blocker,
              state.owner,
              state.next_action,
              timestamp,
              timestamp,
              submission.initiative_id,
            );
          this.writeEvent(
            "initiative",
            submission.initiative_id,
            "initiative.state_derived",
            input.actor,
            {
              previous_status: initiativeBefore.status,
              status: state.status,
              lifecycle: state.lifecycle,
              blocker: state.blocker,
              owner: state.owner,
              next_action: state.next_action,
              source_submission_id: submission.id,
            },
          );
        }
      }

      this.writeEvent("submission", submission.id, "submission.created", input.actor, {
        kind: submission.kind,
        notification_status: notification.status,
      });
      if (decision) {
        this.writeEvent("decision", decision.id, "decision.created", input.actor, {
          risk_level: decision.risk_level,
        });
      }

      const submissionResult = { submission, decision, notification };
      this.writeIdempotent(idempotencyKey, "submission.create", input, submissionResult);
      return submissionResult;
    })();
    return { result, created: true };
  }

  private notificationSuppression(
    input: CreateSubmissionInput,
  ): "observed" | "record_only" | "digest" | "deduplicated" | null {
    if (input.observed) return "observed";
    if (input.attention_policy === "record_only") return "record_only";
    if (input.attention_policy === "digest") return "digest";
    if (!input.dedupe_key) return null;

    const active = this.db
      .prepare(
        `SELECT n.id
         FROM notifications n
         JOIN submissions s ON s.id = n.submission_id
         WHERE s.dedupe_key = ? AND n.status IN ('active', 'read', 'snoozed')
         LIMIT 1`,
      )
      .get(input.dedupe_key);
    return active ? "deduplicated" : null;
  }

  getSubmission(id: string): Submission {
    const row = this.db.prepare("SELECT * FROM submissions WHERE id = ?").get(id) as
      | SubmissionRow
      | undefined;
    if (!row) throw new StoreError("not_found", `Submission ${id} was not found`);
    return this.mapSubmission(row);
  }

  listSubmissions(initiativeId?: string): Submission[];
  listSubmissions(filters?: SubmissionFilters): Submission[];
  listSubmissions(filtersOrInitiativeId: SubmissionFilters | string = {}): Submission[] {
    const filters = typeof filtersOrInitiativeId === "string"
      ? { initiative_id: filtersOrInitiativeId }
      : filtersOrInitiativeId;
    const clauses: string[] = [];
    const values: string[] = [];
    for (const [column, value] of Object.entries(filters)) {
      if (value) {
        clauses.push(`${column} = ?`);
        values.push(value);
      }
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    return (this.db.prepare(`SELECT * FROM submissions${where} ORDER BY created_at DESC`).all(...values) as SubmissionRow[])
      .map((row) => this.mapSubmission(row));
  }

  createTask(input: CreateTaskInput, idempotencyKey?: string): Task {
    this.getInitiative(input.initiative_id);
    const cached = this.readIdempotent<Task>(idempotencyKey, "task.create", input);
    if (cached) return cached;
    const timestamp = now();
    const task: Task = {
      id: randomUUID(),
      initiative_id: input.initiative_id,
      title: input.title,
      detail: input.detail ?? null,
      status: "open",
      created_at: timestamp,
      updated_at: timestamp,
      created_by: input.actor.actor_name,
      completed_at: null,
      completed_by: null,
    };
    this.db.transaction(() => {
      this.assertInitiativeAcceptsOpenTasks(this.getInitiative(input.initiative_id));
      this.db.prepare(
        `INSERT INTO tasks
         (id, initiative_id, title, detail, status, created_at, updated_at, created_by, completed_at, completed_by)
         VALUES (@id, @initiative_id, @title, @detail, @status, @created_at, @updated_at, @created_by, @completed_at, @completed_by)`,
      ).run(task);
      this.writeEvent("task", task.id, "task.created", input.actor, { initiative_id: task.initiative_id });
      this.writeIdempotent(idempotencyKey, "task.create", input, task);
    })();
    return task;
  }

  getTask(id: string): Task {
    const task = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
    if (!task) throw new StoreError("not_found", `Task ${id} was not found`);
    return task;
  }

  listTasks(initiativeId: string): Task[] {
    this.getInitiative(initiativeId);
    return this.db.prepare("SELECT * FROM tasks WHERE initiative_id = ? ORDER BY status ASC, updated_at DESC")
      .all(initiativeId) as Task[];
  }

  updateTask(id: string, input: UpdateTaskInput): Task {
    return this.db.transaction(() => {
      const current = this.getTask(id);
      const timestamp = now();
      const status = input.status ?? current.status;
      const changedStatus = status !== current.status;
      if (status === "open" && current.status !== "open") {
        this.assertInitiativeAcceptsOpenTasks(this.getInitiative(current.initiative_id));
      }
      const task: Task = {
        ...current,
        title: input.title ?? current.title,
        detail: hasOwn(input, "detail") ? input.detail ?? null : current.detail,
        status,
        updated_at: timestamp,
        completed_at: status === "completed" ? (current.completed_at ?? timestamp) : null,
        completed_by: status === "completed" ? (current.completed_by ?? input.actor.actor_name) : null,
      };
      this.db.prepare(
        `UPDATE tasks SET title = @title, detail = @detail, status = @status, updated_at = @updated_at,
         completed_at = @completed_at, completed_by = @completed_by WHERE id = @id`,
      ).run(task);
      this.writeEvent("task", id, changedStatus ? `task.${status}` : "task.updated", input.actor, {
        initiative_id: task.initiative_id,
      });
      return task;
    })();
  }

  listTaskSubmissions(taskId: string): Submission[] {
    this.getTask(taskId);
    return (this.db.prepare(
      `SELECT s.* FROM submissions s JOIN task_submission_links l ON l.submission_id = s.id
       WHERE l.task_id = ? ORDER BY s.created_at DESC`,
    ).all(taskId) as SubmissionRow[]).map((row) => this.mapSubmission(row));
  }

  linkTaskSubmission(taskId: string, submissionId: string, actor: ActorContext): void {
    const task = this.getTask(taskId);
    const submission = this.getSubmission(submissionId);
    if (submission.initiative_id !== task.initiative_id) {
      throw new StoreError("invalid_request", "Task and Submission must belong to the same Initiative");
    }
    const timestamp = now();
    this.db.transaction(() => {
      const result = this.db.prepare(
        `INSERT OR IGNORE INTO task_submission_links(task_id, submission_id, created_at, created_by)
         VALUES (?, ?, ?, ?)`,
      ).run(taskId, submissionId, timestamp, actor.actor_name);
      if (result.changes) this.writeEvent("task", taskId, "task.submission_linked", actor, { submission_id: submissionId });
    })();
  }

  unlinkTaskSubmission(taskId: string, submissionId: string, actor: ActorContext): void {
    this.getTask(taskId);
    this.db.transaction(() => {
      const result = this.db.prepare("DELETE FROM task_submission_links WHERE task_id = ? AND submission_id = ?")
        .run(taskId, submissionId);
      if (result.changes) this.writeEvent("task", taskId, "task.submission_unlinked", actor, { submission_id: submissionId });
    })();
  }

  getDecision(id: string): Decision {
    const row = this.db.prepare("SELECT * FROM decisions WHERE id = ?").get(id) as
      | DecisionRow
      | undefined;
    if (!row) throw new StoreError("not_found", `Decision ${id} was not found`);
    return this.mapDecision(row);
  }

  listDecisions(status?: DecisionStatus, initiativeId?: string): Decision[] {
    if (status && initiativeId) {
      return (
        this.db
          .prepare(
            "SELECT * FROM decisions WHERE status = ? AND initiative_id = ? ORDER BY created_at DESC",
          )
          .all(status, initiativeId) as DecisionRow[]
      ).map((row) => this.mapDecision(row));
    }
    if (initiativeId) {
      return (
        this.db
          .prepare("SELECT * FROM decisions WHERE initiative_id = ? ORDER BY created_at DESC")
          .all(initiativeId) as DecisionRow[]
      ).map((row) => this.mapDecision(row));
    }
    const rows = status
      ? (this.db
          .prepare("SELECT * FROM decisions WHERE status = ? ORDER BY created_at DESC")
          .all(status) as DecisionRow[])
      : (this.db.prepare("SELECT * FROM decisions ORDER BY created_at DESC").all() as DecisionRow[]);
    return rows.map((row) => this.mapDecision(row));
  }

  resolveDecision(id: string, input: ResolveDecisionInput): Decision {
    return this.db.transaction(() => {
      const current = this.getDecision(id);
      if (current.status === "resolved") {
        if (current.resolution === input.outcome) return current;
        throw new StoreError("conflict", `Decision ${id} is already resolved with a different outcome`);
      }
      if (current.status !== "open" && current.status !== "seen") {
        throw new StoreError("conflict", `Decision ${id} cannot be resolved from ${current.status}`);
      }

      const timestamp = now();
      this.db
        .prepare(
          `UPDATE decisions
           SET status = 'resolved', resolution = ?, resolved_via = ?, resolved_by = ?,
               resolved_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.outcome,
          input.resolved_via,
          input.actor.actor_name,
          timestamp,
          timestamp,
          id,
        );
      const closingNotifications = this.db
        .prepare(
          `SELECT id FROM notifications
           WHERE submission_id = ? AND status IN ('active', 'read', 'snoozed')`,
        )
        .all(current.submission_id) as Array<{ id: string }>;
      this.db
        .prepare(
          `UPDATE notifications
           SET status = 'resolved', snoozed_until = NULL, updated_at = ?
           WHERE submission_id = ? AND status IN ('active', 'read', 'snoozed')`,
        )
        .run(timestamp, current.submission_id);
      for (const notification of closingNotifications) {
        this.writeEvent(
          "notification",
          notification.id,
          "notification.resolved",
          input.actor,
          { decision_id: id },
        );
      }
      if (current.initiative_id) {
        const initiativeBefore = this.getInitiative(current.initiative_id);
        const state = deriveInitiativeState(initiativeBefore, {
          status: "waiting_for_agent",
          blocker: "none",
          owner: "agent",
        });
        this.db
          .prepare(
            `UPDATE initiatives
             SET status = ?, next_step = ?, lifecycle = ?, blocker = ?, owner = ?, next_action = ?,
                 last_activity_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            state.status,
            state.next_step,
            state.lifecycle,
            state.blocker,
            state.owner,
            state.next_action,
            timestamp,
            timestamp,
            current.initiative_id,
          );
        if (initiativeBefore.status === "waiting_for_jim") {
          this.writeEvent(
            "initiative",
            current.initiative_id,
            "initiative.state_derived",
            input.actor,
            {
              previous_status: "waiting_for_jim",
              status: state.status,
              lifecycle: state.lifecycle,
              blocker: state.blocker,
              owner: state.owner,
              source_decision_id: id,
            },
          );
        }
      }
      this.writeEvent("decision", id, "decision.resolved", input.actor, {
        outcome: input.outcome,
        resolved_via: input.resolved_via,
      });
      return this.getDecision(id);
    })();
  }

  getNotification(id: string): Notification {
    const row = this.db.prepare("SELECT * FROM notifications WHERE id = ?").get(id) as
      | Notification
      | undefined;
    if (!row) throw new StoreError("not_found", `Notification ${id} was not found`);
    return row;
  }

  updateNotification(id: string, input: UpdateNotificationInput): Notification {
    const current = this.getNotification(id);
    if (["resolved", "suppressed"].includes(current.status)) {
      throw new StoreError("conflict", `Notification ${id} cannot be changed from ${current.status}`);
    }
    if (input.action === "snooze" && !input.snoozed_until) {
      throw new StoreError("invalid_request", "snoozed_until is required for snooze");
    }

    const status = input.action === "archive" ? "archived" : input.action === "snooze" ? "snoozed" : "read";
    const timestamp = now();
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE notifications SET status = ?, snoozed_until = ?, updated_at = ? WHERE id = ?")
        .run(status, input.action === "snooze" ? input.snoozed_until : null, timestamp, id);
      this.writeEvent("notification", id, `notification.${input.action}`, input.actor, {
        snoozed_until: input.snoozed_until ?? null,
      });
    })();
    return this.getNotification(id);
  }

  listInbox(): InboxItem[] {
    const rows = this.db
      .prepare(
        `SELECT n.id AS notification_id, n.submission_id
         FROM notifications n
         JOIN submissions s ON s.id = n.submission_id
         LEFT JOIN decisions d ON d.submission_id = s.id
         WHERE n.status IN ('active', 'read')
            OR (n.status = 'snoozed' AND n.snoozed_until <= ?)
         ORDER BY
           CASE WHEN s.attention_policy = 'interrupt' THEN 0
                WHEN d.status IN ('open', 'seen') THEN 1
                ELSE 2 END,
           n.created_at DESC`,
      )
      .all(now()) as Array<{ notification_id: string; submission_id: string }>;

    return rows.map((row) => {
      const notification = this.getNotification(row.notification_id);
      const submission = this.getSubmission(row.submission_id);
      const decisionRow = this.db
        .prepare("SELECT * FROM decisions WHERE submission_id = ?")
        .get(submission.id) as DecisionRow | undefined;
      return {
        notification,
        submission,
        decision: decisionRow ? this.mapDecision(decisionRow) : null,
        initiative: submission.initiative_id ? this.getInitiative(submission.initiative_id) : null,
      };
    });
  }

  getWorkboard(): Workboard {
    const initiatives = this.listInitiatives();
    return {
      ready: initiatives.filter(
        (item) => item.lifecycle === "open" && item.blocker === "none" && item.owner !== "none",
      ),
      waiting: initiatives.filter(
        (item) => item.lifecycle === "open" && (item.blocker !== "none" || item.owner === "none"),
      ),
      done: initiatives.filter((item) => item.lifecycle === "done"),
      active: initiatives.filter((item) => item.status === "active"),
      waiting_for_jim: initiatives.filter((item) => item.status === "waiting_for_jim"),
      waiting_for_agent: initiatives.filter((item) => item.status === "waiting_for_agent"),
      paused_or_done: initiatives.filter((item) =>
        ["paused", "completed", "cancelled"].includes(item.status),
      ),
    };
  }

  listEvents(entityType?: string, entityId?: string): AuditEvent[] {
    let rows: EventRow[];
    if (entityType && entityId) {
      rows = this.db
        .prepare(
          "SELECT * FROM audit_events WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC",
        )
        .all(entityType, entityId) as EventRow[];
    } else {
      rows = this.db.prepare("SELECT * FROM audit_events ORDER BY created_at DESC").all() as EventRow[];
    }
    return rows.map((row) => ({
      ...row,
      payload: row.payload_json ? (JSON.parse(row.payload_json) as Record<string, unknown>) : null,
    }));
  }

  private mapDecision(row: DecisionRow): Decision {
    const { options_json, ...decision } = row;
    return {
      ...decision,
      options: options_json ? (JSON.parse(options_json) as string[]) : null,
    };
  }

  private mapSubmission(row: SubmissionRow): Submission {
    const { evidence_refs_json, ...submission } = row;
    return {
      ...submission,
      evidence_refs: JSON.parse(evidence_refs_json) as string[],
    };
  }

  private writeEvent(
    entityType: string,
    entityId: string,
    eventType: string,
    actor: ActorContext,
    payload: Record<string, unknown> | null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO audit_events
         (id, entity_type, entity_id, event_type, actor_type, actor_name, host, tool, source, runtime,
          agent, session_id, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        entityType,
        entityId,
        eventType,
        actor.actor_type,
        actor.actor_name,
        actor.host ?? null,
        actor.tool ?? actor.runtime ?? null,
        actor.source ?? null,
        actor.runtime ?? null,
        actor.agent ?? null,
        actor.session_id ?? null,
        payload ? JSON.stringify(payload) : null,
        now(),
      );
  }

  private idempotencyHash(input: unknown): string {
    return createHash("sha256").update(stableSerialize(input)).digest("hex");
  }

  private readIdempotent<T>(
    key: string | undefined,
    operation: string,
    input: unknown,
  ): T | null {
    if (!key) return null;
    const row = this.db
      .prepare("SELECT operation, request_hash, response_json FROM idempotency_keys WHERE key = ?")
      .get(key) as IdempotencyRow | undefined;
    if (!row) return null;
    if (row.operation !== operation || row.request_hash !== this.idempotencyHash(input)) {
      throw new StoreError("conflict", `Idempotency key ${key} was already used for another request`);
    }
    return JSON.parse(row.response_json) as T;
  }

  private writeIdempotent(
    key: string | undefined,
    operation: string,
    input: unknown,
    response: unknown,
  ): void {
    if (!key) return;
    this.db
      .prepare(
        `INSERT INTO idempotency_keys(key, operation, request_hash, response_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(key, operation, this.idempotencyHash(input), JSON.stringify(response), now());
  }
}
