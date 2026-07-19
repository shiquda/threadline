import { describe, expect, it, vi } from "vitest";
import { ApiError, ThreadlineApi } from "./api.js";

describe("ThreadlineApi", () => {
  const api = new ThreadlineApi({ url: "https://gateway.example.com", token: "token" });

  it("passes an AbortSignal to fetch and aborts in-flight requests", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(async (_url, init) => {
      receivedSignal = init?.signal;
      return new Promise((_resolve, reject) => {
        const timeout = setTimeout(() => _resolve(new Response("[]", { status: 200 })), 100);
        if (receivedSignal) receivedSignal.addEventListener("abort", () => { clearTimeout(timeout); reject(new DOMException("Aborted", "AbortError")); });
      });
    }) as unknown as typeof fetch;

    const promise = api.inbox(controller.signal);
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(DOMException);
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("throws ApiError for network failures", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    await expect(api.inbox()).rejects.toThrow(ApiError);
  });

  it("throws ApiError for non-ok responses", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 })) as unknown as typeof fetch;
    await expect(api.inbox()).rejects.toThrow("Unauthorized");
  });
});
