import { Type, type Static, type TSchema } from "@sinclair/typebox";

const nullableOptional = <T extends TSchema>(schema: T) =>
  Type.Optional(Type.Union([schema, Type.Null()]));

export const InitiativeStatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("waiting_for_jim"),
  Type.Literal("waiting_for_agent"),
  Type.Literal("paused"),
  Type.Literal("completed"),
  Type.Literal("cancelled"),
]);

export const InitiativeLifecycleSchema = Type.Union([
  Type.Literal("open"),
  Type.Literal("done"),
]);

export const InitiativeBlockerSchema = Type.Union([
  Type.Literal("none"),
  Type.Literal("human"),
  Type.Literal("external"),
  Type.Literal("failed"),
]);

export const InitiativeOwnerSchema = Type.Union([
  Type.Literal("human"),
  Type.Literal("agent"),
  Type.Literal("none"),
]);

export const SubmissionKindSchema = Type.Union([
  Type.Literal("delivery"),
  Type.Literal("recommendation"),
  Type.Literal("decision_request"),
  Type.Literal("alert"),
  Type.Literal("digest"),
  Type.Literal("progress_update"),
]);

export const AttentionPolicySchema = Type.Union([
  Type.Literal("interrupt"),
  Type.Literal("inbox"),
  Type.Literal("digest"),
  Type.Literal("record_only"),
]);

export const DecisionStatusSchema = Type.Union([
  Type.Literal("open"),
  Type.Literal("seen"),
  Type.Literal("resolved"),
  Type.Literal("expired"),
  Type.Literal("superseded"),
]);

export const RiskLevelSchema = Type.Union([
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
]);

export const NotificationStatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("read"),
  Type.Literal("snoozed"),
  Type.Literal("archived"),
  Type.Literal("resolved"),
  Type.Literal("suppressed"),
]);

export const TaskStatusSchema = Type.Union([Type.Literal("open"), Type.Literal("completed")]);

export const ActorContextSchema = Type.Object(
  {
    actor_type: Type.Union([
      Type.Literal("human"),
      Type.Literal("agent"),
      Type.Literal("system"),
    ]),
    actor_name: Type.String({ minLength: 1, maxLength: 200 }),
    host: nullableOptional(Type.String({ maxLength: 255 })),
    tool: nullableOptional(Type.String({ maxLength: 200 })),
    source: nullableOptional(Type.String({ maxLength: 200 })),
    runtime: nullableOptional(Type.String({ maxLength: 200 })),
    agent: nullableOptional(Type.String({ maxLength: 200 })),
    session_id: nullableOptional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);

export const InitiativeSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  intent: Type.String(),
  status: InitiativeStatusSchema,
  next_step: Type.Union([Type.String(), Type.Null()]),
  lifecycle: InitiativeLifecycleSchema,
  blocker: InitiativeBlockerSchema,
  owner: InitiativeOwnerSchema,
  next_action: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
  updated_at: Type.String(),
  last_activity_at: Type.String(),
  created_by: Type.String(),
});

export const SubmissionSchema = Type.Object({
  id: Type.String(),
  kind: SubmissionKindSchema,
  title: Type.String(),
  summary: Type.String(),
  detail: Type.Union([Type.String(), Type.Null()]),
  detail_ref: Type.Union([Type.String(), Type.Null()]),
  content_language: Type.String(),
  evidence_refs: Type.Array(Type.String()),
  initiative_id: Type.Union([Type.String(), Type.Null()]),
  attention_policy: AttentionPolicySchema,
  dedupe_key: Type.Union([Type.String(), Type.Null()]),
  host: Type.Union([Type.String(), Type.Null()]),
  tool: Type.Union([Type.String(), Type.Null()]),
  source: Type.String(),
  runtime: Type.Union([Type.String(), Type.Null()]),
  agent: Type.Union([Type.String(), Type.Null()]),
  session_id: Type.Union([Type.String(), Type.Null()]),
  observed_at: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
  created_by: Type.String(),
});

export const DecisionSchema = Type.Object({
  id: Type.String(),
  submission_id: Type.String(),
  initiative_id: Type.Union([Type.String(), Type.Null()]),
  question: Type.String(),
  options: Type.Union([Type.Array(Type.String()), Type.Null()]),
  risk_level: RiskLevelSchema,
  status: DecisionStatusSchema,
  resolution: Type.Union([Type.String(), Type.Null()]),
  resolved_via: Type.Union([Type.String(), Type.Null()]),
  resolved_by: Type.Union([Type.String(), Type.Null()]),
  resolved_at: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export const NotificationSchema = Type.Object({
  id: Type.String(),
  submission_id: Type.String(),
  channel: Type.Literal("web"),
  status: NotificationStatusSchema,
  suppression_reason: Type.Union([
    Type.Literal("observed"),
    Type.Literal("record_only"),
    Type.Literal("digest"),
    Type.Literal("deduplicated"),
    Type.Null(),
  ]),
  snoozed_until: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export const AuditEventSchema = Type.Object({
  id: Type.String(),
  entity_type: Type.String(),
  entity_id: Type.String(),
  event_type: Type.String(),
  actor_type: Type.String(),
  actor_name: Type.String(),
  host: Type.Union([Type.String(), Type.Null()]),
  tool: Type.Union([Type.String(), Type.Null()]),
  source: Type.Union([Type.String(), Type.Null()]),
  runtime: Type.Union([Type.String(), Type.Null()]),
  agent: Type.Union([Type.String(), Type.Null()]),
  session_id: Type.Union([Type.String(), Type.Null()]),
  payload: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  created_at: Type.String(),
});

export const TaskSchema = Type.Object({
  id: Type.String(),
  initiative_id: Type.String(),
  title: Type.String(),
  detail: Type.Union([Type.String(), Type.Null()]),
  status: TaskStatusSchema,
  created_at: Type.String(),
  updated_at: Type.String(),
  created_by: Type.String(),
  completed_at: Type.Union([Type.String(), Type.Null()]),
  completed_by: Type.Union([Type.String(), Type.Null()]),
});

export const CreateTaskInputSchema = Type.Object({
  initiative_id: Type.String(),
  title: Type.String({ minLength: 1, maxLength: 300 }),
  detail: nullableOptional(Type.String({ maxLength: 10000 })),
  actor: ActorContextSchema,
}, { additionalProperties: false });

export const UpdateTaskInputSchema = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
  detail: nullableOptional(Type.String({ maxLength: 10000 })),
  status: Type.Optional(TaskStatusSchema),
  actor: ActorContextSchema,
}, { additionalProperties: false, minProperties: 2 });

export const LinkTaskSubmissionInputSchema = Type.Object({
  submission_id: Type.String(),
  actor: ActorContextSchema,
}, { additionalProperties: false });

export const CreateInitiativeInputSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 300 }),
    intent: Type.String({ minLength: 1, maxLength: 5000 }),
    status: Type.Optional(InitiativeStatusSchema),
    next_step: nullableOptional(Type.String({ maxLength: 2000 })),
    lifecycle: Type.Optional(InitiativeLifecycleSchema),
    blocker: Type.Optional(InitiativeBlockerSchema),
    owner: Type.Optional(InitiativeOwnerSchema),
    next_action: nullableOptional(Type.String({ maxLength: 2000 })),
    actor: ActorContextSchema,
  },
  { additionalProperties: false },
);

export const InitiativeStateUpdateInputSchema = Type.Object(
  {
    lifecycle: Type.Optional(InitiativeLifecycleSchema),
    blocker: Type.Optional(InitiativeBlockerSchema),
    owner: Type.Optional(InitiativeOwnerSchema),
    next_action: nullableOptional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false, minProperties: 1 },
);

export const UpdateInitiativeInputSchema = Type.Object(
  {
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
    intent: Type.Optional(Type.String({ minLength: 1, maxLength: 5000 })),
    status: Type.Optional(InitiativeStatusSchema),
    next_step: nullableOptional(Type.String({ maxLength: 2000 })),
    lifecycle: Type.Optional(InitiativeLifecycleSchema),
    blocker: Type.Optional(InitiativeBlockerSchema),
    owner: Type.Optional(InitiativeOwnerSchema),
    next_action: nullableOptional(Type.String({ maxLength: 2000 })),
    actor: ActorContextSchema,
  },
  { additionalProperties: false, minProperties: 2 },
);

export const DecisionInputSchema = Type.Object(
  {
    question: Type.String({ minLength: 1, maxLength: 5000 }),
    options: nullableOptional(Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), { maxItems: 20 })),
    risk_level: Type.Optional(RiskLevelSchema),
  },
  { additionalProperties: false },
);

export const CreateSubmissionInputSchema = Type.Object(
  {
    kind: SubmissionKindSchema,
    title: Type.String({ minLength: 1, maxLength: 300 }),
    summary: Type.String({ minLength: 1, maxLength: 5000 }),
    detail: nullableOptional(Type.String({ maxLength: 50000 })),
    detail_ref: nullableOptional(Type.String({ maxLength: 2000 })),
    content_language: Type.Optional(
      Type.String({
        minLength: 2,
        maxLength: 100,
        pattern: "^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|x(?:-[A-Za-z0-9]{1,8})+)$",
      }),
    ),
    evidence_refs: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 2000 }), { maxItems: 100 }),
    ),
    initiative_id: nullableOptional(Type.String()),
    initiative_update: Type.Optional(InitiativeStateUpdateInputSchema),
    attention_policy: AttentionPolicySchema,
    dedupe_key: nullableOptional(Type.String({ maxLength: 500 })),
    observed: Type.Optional(Type.Boolean()),
    decision: Type.Optional(DecisionInputSchema),
    actor: ActorContextSchema,
  },
  { additionalProperties: false },
);

export const ResolveDecisionInputSchema = Type.Object(
  {
    outcome: Type.String({ minLength: 1, maxLength: 10000 }),
    resolved_via: Type.String({ minLength: 1, maxLength: 100 }),
    actor: ActorContextSchema,
  },
  { additionalProperties: false },
);

export const UpdateNotificationInputSchema = Type.Object(
  {
    action: Type.Union([
      Type.Literal("read"),
      Type.Literal("snooze"),
      Type.Literal("archive"),
    ]),
    snoozed_until: nullableOptional(Type.String({ format: "date-time" })),
    actor: ActorContextSchema,
  },
  { additionalProperties: false },
);

export const SubmissionResultSchema = Type.Object({
  submission: SubmissionSchema,
  decision: Type.Union([DecisionSchema, Type.Null()]),
  notification: NotificationSchema,
});

export const InboxItemSchema = Type.Object({
  notification: NotificationSchema,
  submission: SubmissionSchema,
  decision: Type.Union([DecisionSchema, Type.Null()]),
  initiative: Type.Union([InitiativeSchema, Type.Null()]),
});

export const WorkboardSchema = Type.Object({
  ready: Type.Array(InitiativeSchema),
  waiting: Type.Array(InitiativeSchema),
  done: Type.Array(InitiativeSchema),
  active: Type.Array(InitiativeSchema),
  waiting_for_jim: Type.Array(InitiativeSchema),
  waiting_for_agent: Type.Array(InitiativeSchema),
  paused_or_done: Type.Array(InitiativeSchema),
});

export const ErrorResponseSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  details: Type.Optional(Type.Unknown()),
});

export type InitiativeStatus = Static<typeof InitiativeStatusSchema>;
export type InitiativeLifecycle = Static<typeof InitiativeLifecycleSchema>;
export type InitiativeBlocker = Static<typeof InitiativeBlockerSchema>;
export type InitiativeOwner = Static<typeof InitiativeOwnerSchema>;
export type SubmissionKind = Static<typeof SubmissionKindSchema>;
export type AttentionPolicy = Static<typeof AttentionPolicySchema>;
export type DecisionStatus = Static<typeof DecisionStatusSchema>;
export type RiskLevel = Static<typeof RiskLevelSchema>;
export type NotificationStatus = Static<typeof NotificationStatusSchema>;
export type TaskStatus = Static<typeof TaskStatusSchema>;
export type ActorContext = Static<typeof ActorContextSchema>;
export type Initiative = Static<typeof InitiativeSchema>;
export type Submission = Static<typeof SubmissionSchema>;
export type Decision = Static<typeof DecisionSchema>;
export type Notification = Static<typeof NotificationSchema>;
export type AuditEvent = Static<typeof AuditEventSchema>;
export type Task = Static<typeof TaskSchema>;
export type CreateTaskInput = Static<typeof CreateTaskInputSchema>;
export type UpdateTaskInput = Static<typeof UpdateTaskInputSchema>;
export type LinkTaskSubmissionInput = Static<typeof LinkTaskSubmissionInputSchema>;
export type CreateInitiativeInput = Static<typeof CreateInitiativeInputSchema>;
export type InitiativeStateUpdateInput = Static<typeof InitiativeStateUpdateInputSchema>;
export type UpdateInitiativeInput = Static<typeof UpdateInitiativeInputSchema>;
export type CreateSubmissionInput = Static<typeof CreateSubmissionInputSchema>;
export type ResolveDecisionInput = Static<typeof ResolveDecisionInputSchema>;
export type UpdateNotificationInput = Static<typeof UpdateNotificationInputSchema>;
export type SubmissionResult = Static<typeof SubmissionResultSchema>;
export type InboxItem = Static<typeof InboxItemSchema>;
export type Workboard = Static<typeof WorkboardSchema>;
