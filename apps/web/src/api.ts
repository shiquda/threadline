import type {
  AuditEvent,
  Decision,
  InboxItem,
  Initiative,
  InitiativeStatus,
  Submission,
  Workboard,
} from "@threadline/protocol";

export type Connection = { url: string; token: string };

const connectionKey = "threadline.connection";
const apiUrl = (import.meta.env.VITE_THREADLINE_API_URL as string | undefined) ?? window.location.origin;
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
      response = await fetch(url, { ...init, headers });
    } catch {
      throw new ApiError(`Could not reach ${this.connection.url}. Check the Gateway URL.`);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new ApiError(body?.message ?? `Gateway returned ${response.status}.`, response.status);
    }
    return response.json() as Promise<T>;
  }

  inbox() { return this.request<InboxItem[]>("/api/v1/inbox"); }
  workboard() { return this.request<Workboard>("/api/v1/workboard"); }
  initiatives() { return this.request<Initiative[]>("/api/v1/initiatives"); }
  initiative(id: string) { return this.request<Initiative>(`/api/v1/initiatives/${id}`); }
  submissions(initiativeId?: string) {
    return this.request<Submission[]>(`/api/v1/submissions${initiativeId ? `?initiative_id=${encodeURIComponent(initiativeId)}` : ""}`);
  }
  submission(id: string) { return this.request<Submission>(`/api/v1/submissions/${id}`); }
  decisions() { return this.request<Decision[]>("/api/v1/decisions"); }
  decision(id: string) { return this.request<Decision>(`/api/v1/decisions/${id}`); }
  events(entityType?: string, entityId?: string) {
    const query = entityType && entityId ? `?entity_type=${entityType}&entity_id=${encodeURIComponent(entityId)}` : "";
    return this.request<AuditEvent[]>(`/api/v1/events${query}`);
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
