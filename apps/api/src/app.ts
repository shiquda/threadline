import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import {
  CreateInitiativeInputSchema,
  CreateSubmissionInputSchema,
  CreateTaskInputSchema,
  DecisionStatusSchema,
  InitiativeStatusSchema,
  ResolveDecisionInputSchema,
  UpdateInitiativeInputSchema,
  UpdateNotificationInputSchema,
  UpdateTaskInputSchema,
  LinkTaskSubmissionInputSchema,
  type CreateInitiativeInput,
  type CreateSubmissionInput,
  type CreateTaskInput,
  type Decision,
  type DecisionStatus,
  type InitiativeStatus,
  type ResolveDecisionInput,
  type Submission,
  type UpdateInitiativeInput,
  type UpdateNotificationInput,
  type UpdateTaskInput,
  type LinkTaskSubmissionInput,
} from "@threadline/protocol";
import { StoreError, ThreadlineStore } from "@threadline/store";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import type { NotificationEvent, NotificationPublisher } from "./notifier.js";

export interface AppOptions {
  store: ThreadlineStore;
  token: string;
  logger?: boolean;
  corsOrigin?: string;
  webDir?: string;
  publisher?: NotificationPublisher;
  bodyLimit?: number;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  rateLimitKeyGenerator?: (request: FastifyRequest) => string | number | Promise<string | number>;
  trustProxy?: boolean;
}

const IdParamsSchema = Type.Object({ id: Type.String({ minLength: 1 }) });
const InitiativeQuerySchema = Type.Object({
  status: Type.Optional(InitiativeStatusSchema),
});
const SubmissionQuerySchema = Type.Object({
  initiative_id: Type.Optional(Type.String()),
  host: Type.Optional(Type.String()),
  tool: Type.Optional(Type.String()),
  session_id: Type.Optional(Type.String()),
});
const TaskQuerySchema = Type.Object({ initiative_id: Type.String() });
const DecisionQuerySchema = Type.Object({
  status: Type.Optional(DecisionStatusSchema),
  initiative_id: Type.Optional(Type.String()),
});
const EventQuerySchema = Type.Object({
  entity_type: Type.Optional(Type.String()),
  entity_id: Type.Optional(Type.String()),
});

function idempotencyKey(headers: Record<string, unknown>): string | undefined {
  const value = headers["idempotency-key"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function tokenMatches(expected: string, supplied: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

function notificationEvent(result: {
  submission: Submission;
  decision: Decision | null;
}): NotificationEvent | undefined {
  if (result.submission.kind === "decision_request" && result.decision) {
    return { type: "decision_created", submission: result.submission, decision: result.decision };
  }
  if (result.submission.kind === "alert") {
    return { type: "alert_created", submission: result.submission };
  }
  return undefined;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: options.bodyLimit ?? 262_144,
    trustProxy: options.trustProxy ?? false,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        baseUri: ["'none'"],
        defaultSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "no-referrer" },
  });

  await app.register(rateLimit, {
    allowList: (request) => request.url === "/health",
    keyGenerator: options.rateLimitKeyGenerator ?? ((request) => request.ip),
    max: options.rateLimitMax ?? 120,
    timeWindow: options.rateLimitWindowMs ?? 60_000,
  });

  await app.register(cors, {
    origin: options.corsOrigin ?? false,
  });

  if (options.webDir && existsSync(options.webDir)) {
    await app.register(fastifyStatic, {
      root: resolve(options.webDir),
    });
  }

  app.addHook("preHandler", async (request, reply) => {
    if (request.method === "OPTIONS" || !request.url.startsWith("/api/v1")) return;
    const authorization = request.headers.authorization;
    const supplied = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (!supplied || !tokenMatches(options.token, supplied)) {
      return reply.code(401).send({
        code: "unauthorized",
        message: "A valid Bearer token is required",
      });
    }
  });

  app.setErrorHandler((unknownError, _request, reply) => {
    if (unknownError instanceof StoreError) {
      const status =
        unknownError.code === "not_found" ? 404 : unknownError.code === "conflict" ? 409 : 400;
      return reply.code(status).send({ code: unknownError.code, message: unknownError.message });
    }
    const error = unknownError as FastifyError;
    if (error.validation) {
      return reply.code(400).send({
        code: "validation_error",
        message: "Request validation failed",
        details: error.validation,
      });
    }
    app.log.error(error);
    return reply.code(error.statusCode ?? 500).send({
      code: "internal_error",
      message: error.statusCode && error.statusCode < 500 ? error.message : "Internal server error",
    });
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/v1/inbox", async () => options.store.listInbox());
  app.get("/api/v1/workboard", async () => options.store.getWorkboard());

  app.post(
    "/api/v1/initiatives",
    { schema: { body: CreateInitiativeInputSchema } },
    async (request, reply) => {
      const initiative = options.store.createInitiative(
        request.body as CreateInitiativeInput,
        idempotencyKey(request.headers),
      );
      return reply.code(201).send(initiative);
    },
  );

  app.get(
    "/api/v1/initiatives",
    { schema: { querystring: InitiativeQuerySchema } },
    async (request) => {
      const query = request.query as { status?: InitiativeStatus };
      return options.store.listInitiatives(query.status);
    },
  );

  app.get(
    "/api/v1/initiatives/:id",
    { schema: { params: IdParamsSchema } },
    async (request) => options.store.getInitiative((request.params as { id: string }).id),
  );

  app.patch(
    "/api/v1/initiatives/:id",
    { schema: { params: IdParamsSchema, body: UpdateInitiativeInputSchema } },
    async (request) =>
      options.store.updateInitiative(
        (request.params as { id: string }).id,
        request.body as UpdateInitiativeInput,
      ),
  );

  app.post(
    "/api/v1/tasks",
    { schema: { body: CreateTaskInputSchema } },
    async (request, reply) => reply.code(201).send(options.store.createTask(
      request.body as CreateTaskInput,
      idempotencyKey(request.headers),
    )),
  );

  app.get(
    "/api/v1/tasks",
    { schema: { querystring: TaskQuerySchema } },
    async (request) => options.store.listTasks((request.query as { initiative_id: string }).initiative_id),
  );

  app.get(
    "/api/v1/tasks/:id",
    { schema: { params: IdParamsSchema } },
    async (request) => options.store.getTask((request.params as { id: string }).id),
  );

  app.patch(
    "/api/v1/tasks/:id",
    { schema: { params: IdParamsSchema, body: UpdateTaskInputSchema } },
    async (request) => options.store.updateTask(
      (request.params as { id: string }).id,
      request.body as UpdateTaskInput,
    ),
  );

  app.get(
    "/api/v1/tasks/:id/submissions",
    { schema: { params: IdParamsSchema } },
    async (request) => options.store.listTaskSubmissions((request.params as { id: string }).id),
  );

  app.post(
    "/api/v1/tasks/:id/submissions/:submissionId",
    { schema: { params: Type.Object({ id: Type.String({ minLength: 1 }), submissionId: Type.String({ minLength: 1 }) }), body: LinkTaskSubmissionInputSchema } },
    async (request, reply) => {
      const params = request.params as { id: string; submissionId: string };
      options.store.linkTaskSubmission(params.id, params.submissionId, (request.body as LinkTaskSubmissionInput).actor);
      return reply.code(204).send();
    },
  );

  app.patch(
    "/api/v1/tasks/:id/submissions/:submissionId",
    { schema: { params: Type.Object({ id: Type.String({ minLength: 1 }), submissionId: Type.String({ minLength: 1 }) }), body: LinkTaskSubmissionInputSchema } },
    async (request, reply) => {
      const params = request.params as { id: string; submissionId: string };
      options.store.unlinkTaskSubmission(params.id, params.submissionId, (request.body as LinkTaskSubmissionInput).actor);
      return reply.code(204).send();
    },
  );

  app.post(
    "/api/v1/submissions",
    { schema: { body: CreateSubmissionInputSchema } },
    async (request, reply) => {
      const outcome = options.store.createSubmissionWithOutcome(
        request.body as CreateSubmissionInput,
        idempotencyKey(request.headers),
      );
      const event = outcome.created ? notificationEvent(outcome.result) : undefined;
      if (event && options.publisher) {
        void options.publisher.publish(event).catch(() => {
          app.log.error(
            { notification_type: event.type, submission_id: event.submission.id },
            "Outbound notification delivery failed",
          );
        });
      }
      return reply.code(201).send(outcome.result);
    },
  );

  app.get(
    "/api/v1/submissions",
    { schema: { querystring: SubmissionQuerySchema } },
    async (request) => {
      const query = request.query as { initiative_id?: string; host?: string; tool?: string; session_id?: string };
      return options.store.listSubmissions(query);
    },
  );

  app.get(
    "/api/v1/submissions/:id",
    { schema: { params: IdParamsSchema } },
    async (request) => options.store.getSubmission((request.params as { id: string }).id),
  );

  app.get(
    "/api/v1/decisions",
    { schema: { querystring: DecisionQuerySchema } },
    async (request) => {
      const query = request.query as { status?: DecisionStatus; initiative_id?: string };
      return options.store.listDecisions(query.status, query.initiative_id);
    },
  );

  app.get(
    "/api/v1/decisions/:id",
    { schema: { params: IdParamsSchema } },
    async (request) => options.store.getDecision((request.params as { id: string }).id),
  );

  app.post(
    "/api/v1/decisions/:id/resolve",
    { schema: { params: IdParamsSchema, body: ResolveDecisionInputSchema } },
    async (request) =>
      options.store.resolveDecision(
        (request.params as { id: string }).id,
        request.body as ResolveDecisionInput,
      ),
  );

  app.patch(
    "/api/v1/notifications/:id",
    { schema: { params: IdParamsSchema, body: UpdateNotificationInputSchema } },
    async (request) =>
      options.store.updateNotification(
        (request.params as { id: string }).id,
        request.body as UpdateNotificationInput,
      ),
  );

  app.get(
    "/api/v1/events",
    { schema: { querystring: EventQuerySchema } },
    async (request) => {
      const query = request.query as { entity_type?: string; entity_id?: string };
      return options.store.listEvents(query.entity_type, query.entity_id);
    },
  );

  return app;
}
