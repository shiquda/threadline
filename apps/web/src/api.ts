import type {
  AuditEvent,
  Decision,
  InboxItem,
  Initiative,
  InitiativeStatus,
  Submission,
  Task,
  Workboard,
} from "@threadline/protocol";

export type Connection = { url: string; token: string };

const connectionKey = "threadline.connection";
const apiUrl = (import.meta.env.VITE_THREADLINE_API_URL as string | undefined) ?? (typeof window === "undefined" ? "" : window.location.origin);
const apiToken = (import.meta.env.VITE_THREADLINE_TOKEN as string | undefined) ?? "";

export function readConnection(): Connection {
  try {
    const saved = JSON.parse(localStorage.getItem(connectionKey) ?? "null") as Partial<Connection> | null;
    return { url: saved?.url || apiUrl, token: saved?.token || apiToken };
  } catch {
    return { url: apiUrl, token: apiToken };
  }
}

export function writeConnection(connection: Connection): void {
  localStorage.setItem(connectionKey, JSON.stringify(connection));
}

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export class ThreadlineApi {
  constructor(private readonly connection: Connection) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.connection.url.replace(/\/$/, "")}${path}`;
    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    if (this.connection.token) headers.set("Authorization", `Bearer ${this.connection.token}`);
    if (init?.body) headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await fetch(url, { ...init, headers, signal: init?.signal ?? null });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ApiError(`Could not reach ${this.connection.url}. Check the Gateway URL.`);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new ApiError(body?.message ?? `Gateway returned ${response.status}.`, response.status);
    }
    return response.json() as Promise<T>;
  }

  inbox(signal?: AbortSignal) { return this.request<InboxItem[]>("/api/v1/inbox", { signal: signal ?? null }); }
  workboard(signal?: AbortSignal) { return this.request<Workboard>("/api/v1/workboard", { signal: signal ?? null }); }
  initiatives(signal?: AbortSignal) { return this.request<Initiative[]>("/api/v1/initiatives", { signal: signal ?? null }); }
  initiative(id: string, signal?: AbortSignal) { return this.request<Initiative>(`/api/v1/initiatives/${id}`, { signal: signal ?? null }); }
  submissions(initiativeId?: string, signal?: AbortSignal) {
    return this.request<Submission[]>(`/api/v1/submissions${initiativeId ? `?initiative_id=${encodeURIComponent(initiativeId)}` : ""}`, { signal: signal ?? null });
  }
  submission(id: string, signal?: AbortSignal) { return this.request<Submission>(`/api/v1/submissions/${id}`, { signal: signal ?? null }); }
  tasks(initiativeId: string, signal?: AbortSignal) { return this.request<Task[]>(`/api/v1/tasks?initiative_id=${encodeURIComponent(initiativeId)}`, { signal: signal ?? null }); }
  task(id: string, signal?: AbortSignal) { return this.request<Task>(`/api/v1/tasks/${id}`, { signal: signal ?? null }); }
  taskSubmissions(id: string, signal?: AbortSignal) { return this.request<Submission[]>(`/api/v1/tasks/${id}/submissions`, { signal: signal ?? null }); }
  decisions(signal?: AbortSignal) { return this.request<Decision[]>("/api/v1/decisions", { signal: signal ?? null }); }
  decision(id: string, signal?: AbortSignal) { return this.request<Decision>(`/api/v1/decisions/${id}`, { signal: signal ?? null }); }
  events(entityType?: string, entityId?: string, signal?: AbortSignal) {
    const query = entityType && entityId ? `?entity_type=${entityType}&entity_id=${encodeURIComponent(entityId)}` : "";
    return this.request<AuditEvent[]>(`/api/v1/events${query}`, { signal: signal ?? null });
  }
  createInitiative(input: { title: string; intent: string; status: InitiativeStatus; next_step: string | null }) {
    return this.request<Initiative>("/api/v1/initiatives", {
      method: "POST",
      body: JSON.stringify({ ...input, actor: humanActor() }),
    });
  }
  updateInitiative(id: string, input: Partial<Pick<Initiative, "title" | "intent" | "status" | "next_step">>) {
    return this.request<Initiative>(`/api/v1/initiatives/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...input, actor: humanActor() }),
    });
  }
  createTask(input: { initiative_id: string; title: string; detail?: string }) {
    return this.request<Task>("/api/v1/tasks", { method: "POST", body: JSON.stringify({ ...input, actor: humanActor() }) });
  }
  updateTask(id: string, input: Partial<Pick<Task, "title" | "detail" | "status">>) {
    return this.request<Task>(`/api/v1/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ ...input, actor: humanActor() }) });
  }
  linkTaskSubmission(taskId: string, submissionId: string) {
    return this.request<void>(`/api/v1/tasks/${taskId}/submissions/${submissionId}`, { method: "POST", body: JSON.stringify({ submission_id: submissionId, actor: humanActor() }) });
  }
  unlinkTaskSubmission(taskId: string, submissionId: string) {
    return this.request<void>(`/api/v1/tasks/${taskId}/submissions/${submissionId}`, { method: "PATCH", body: JSON.stringify({ submission_id: submissionId, actor: humanActor() }) });
  }
  updateNotification(id: string, action: "read" | "snooze" | "archive") {
    const snoozedUntil = action === "snooze" ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null;
    return this.request(`/api/v1/notifications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action, snoozed_until: snoozedUntil, actor: humanActor() }),
    });
  }
  resolveDecision(id: string, outcome: string) {
    return this.request<Decision>(`/api/v1/decisions/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ outcome, resolved_via: "web", actor: humanActor() }),
    });
  }
}

export function humanActor() {
  return { actor_type: "human" as const, actor_name: "web-user", source: "web", runtime: null, agent: null, session_id: null };
}
