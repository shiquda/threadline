import { describe, expect, it, vi } from "vitest";
import type { Decision, Submission } from "@threadline/protocol";
import { createPublisherFromEnvironment, createTelegramPublisher } from "../src/notifier.js";

const submission: Submission = {
  id: "submission-1",
  kind: "decision_request",
  title: "Choose a deployment region",
  summary: "A deployment region is required.",
  detail: null,
  detail_ref: null,
  content_language: "en",
  evidence_refs: [],
  initiative_id: null,
  attention_policy: "inbox",
  dedupe_key: null,
  source: "codex",
  runtime: "codex",
  agent: "builder",
  session_id: "session-42",
  observed_at: null,
  created_at: "2026-07-18T00:00:00.000Z",
  created_by: "builder",
};

const decision: Decision = {
  id: "decision-1",
  submission_id: submission.id,
  initiative_id: null,
  question: "Which region should host Threadline?",
  options: ["Singapore", "Tokyo"],
  risk_level: "medium",
  status: "open",
  resolution: null,
  resolved_via: null,
  resolved_by: null,
  resolved_at: null,
  created_at: submission.created_at,
  updated_at: submission.created_at,
};

describe("Telegram notification publisher", () => {
  it("uses Telegram's sendMessage API and includes decision context", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const publisher = createTelegramPublisher({
      botToken: "test-bot-token",
      chatId: "test-chat-id",
      publicUrl: "https://tl.example.com/",
      fetch: fetch as never,
    });

    await publisher.publish({ type: "decision_created", submission, decision });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [endpoint, request] = fetch.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toContain("/bottest-bot-token/sendMessage");
    expect(JSON.parse(request.body as string)).toEqual({
      chat_id: "test-chat-id",
      text: expect.stringContaining("Which region should host Threadline?"),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: "Open decision", url: "https://tl.example.com/#decision/decision-1" }]],
      },
    });
    expect(JSON.parse(request.body as string).text).toContain("🧭");
  });

  it("escapes submission content before sending HTML", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const publisher = createTelegramPublisher({ botToken: "test-bot-token", chatId: "test-chat-id", fetch: fetch as never });

    await publisher.publish({ type: "alert_created", submission: { ...submission, kind: "alert", title: "<unsafe>", summary: "x & y" } });

    expect(JSON.parse((fetch.mock.calls[0] as [string, RequestInit])[1].body as string).text).toContain("&lt;unsafe&gt;");
    expect(JSON.parse((fetch.mock.calls[0] as [string, RequestInit])[1].body as string).text).toContain("x &amp; y");
  });

  it("retries failed delivery a limited number of times", async () => {
    const fetch = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const sleep = vi.fn(async () => undefined);
    const publisher = createTelegramPublisher({
      botToken: "test-bot-token",
      chatId: "test-chat-id",
      retryAttempts: 3,
      fetch: fetch as never,
      sleep,
    });

    await expect(publisher.publish({ type: "alert_created", submission: { ...submission, kind: "alert" } })).rejects.toThrow(
      "Telegram notification delivery failed",
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("is disabled until both Telegram environment variables are configured", () => {
    expect(createPublisherFromEnvironment({})).toBeUndefined();
    expect(
      createPublisherFromEnvironment({
        THREADLINE_TELEGRAM_BOT_TOKEN: "test-bot-token",
        THREADLINE_TELEGRAM_CHAT_ID: "test-chat-id",
      }),
    ).toBeDefined();
  });
});
