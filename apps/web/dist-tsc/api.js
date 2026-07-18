const connectionKey = "threadline.connection";
const apiUrl = import.meta.env.VITE_THREADLINE_API_URL ?? window.location.origin;
const apiToken = import.meta.env.VITE_THREADLINE_TOKEN ?? "";
export function readConnection() {
    try {
        const saved = JSON.parse(localStorage.getItem(connectionKey) ?? "null");
        return { url: saved?.url || apiUrl, token: saved?.token || apiToken };
    }
    catch {
        return { url: apiUrl, token: apiToken };
    }
}
export function writeConnection(connection) {
    localStorage.setItem(connectionKey, JSON.stringify(connection));
}
export class ApiError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
export class ThreadlineApi {
    connection;
    constructor(connection) {
        this.connection = connection;
    }
    async request(path, init) {
        const url = `${this.connection.url.replace(/\/$/, "")}${path}`;
        const headers = new Headers(init?.headers);
        headers.set("Accept", "application/json");
        if (this.connection.token)
            headers.set("Authorization", `Bearer ${this.connection.token}`);
        if (init?.body)
            headers.set("Content-Type", "application/json");
        let response;
        try {
            response = await fetch(url, { ...init, headers });
        }
        catch {
            throw new ApiError(`Could not reach ${this.connection.url}. Check the Gateway URL.`);
        }
        if (!response.ok) {
            const body = (await response.json().catch(() => null));
            throw new ApiError(body?.message ?? `Gateway returned ${response.status}.`, response.status);
        }
        return response.json();
    }
    inbox() { return this.request("/api/v1/inbox"); }
    workboard() { return this.request("/api/v1/workboard"); }
    initiatives() { return this.request("/api/v1/initiatives"); }
    initiative(id) { return this.request(`/api/v1/initiatives/${id}`); }
    submissions(initiativeId) {
        return this.request(`/api/v1/submissions${initiativeId ? `?initiative_id=${encodeURIComponent(initiativeId)}` : ""}`);
    }
    decisions() { return this.request("/api/v1/decisions"); }
    decision(id) { return this.request(`/api/v1/decisions/${id}`); }
    events(entityType, entityId) {
        const query = entityType && entityId ? `?entity_type=${entityType}&entity_id=${encodeURIComponent(entityId)}` : "";
        return this.request(`/api/v1/events${query}`);
    }
    createInitiative(input) {
        return this.request("/api/v1/initiatives", {
            method: "POST",
            body: JSON.stringify({ ...input, actor: humanActor() }),
        });
    }
    updateInitiative(id, input) {
        return this.request(`/api/v1/initiatives/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ ...input, actor: humanActor() }),
        });
    }
    updateNotification(id, action) {
        const snoozedUntil = action === "snooze" ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null;
        return this.request(`/api/v1/notifications/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ action, snoozed_until: snoozedUntil, actor: humanActor() }),
        });
    }
    resolveDecision(id, outcome) {
        return this.request(`/api/v1/decisions/${id}/resolve`, {
            method: "POST",
            body: JSON.stringify({ outcome, resolved_via: "web", actor: humanActor() }),
        });
    }
}
export function humanActor() {
    return { actor_type: "human", actor_name: "Jim", source: "web", runtime: null, agent: null, session_id: null };
}
//# sourceMappingURL=api.js.map