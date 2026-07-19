import { resolveConnection } from "./config.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  authenticated = true,
): Promise<T> {
  const connection = await resolveConnection();
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  if (authenticated) headers.set("authorization", `Bearer ${connection.token}`);

  const response = await fetch(`${connection.url}${path}`, { ...init, headers });
  if (response.ok && response.status === 204) return undefined as T;
  const body = (await response.json()) as { code?: string; message?: string; details?: unknown };
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.code ?? "request_failed",
      body.message ?? `Request failed with HTTP ${response.status}`,
      body.details,
    );
  }
  return body as T;
}
