import type { Decision, Submission } from "@threadline/protocol";
import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";

export type NotificationEvent =
  | {
      type: "decision_created";
      submission: Submission;
      decision: Decision;
    }
  | {
      type: "alert_created";
      submission: Submission;
    };

export interface NotificationPublisher {
  publish(event: NotificationEvent): Promise<void>;
}

export interface TelegramPublisherOptions {
  botToken: string;
  chatId: string;
  publicUrl?: string;
  proxyUrl?: string;
  retryAttempts?: number;
  fetch?: typeof undiciFetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function messageFor(event: NotificationEvent): string {
  const context = [
    event.submission.runtime && `<b>Runtime</b>: ${escapeHtml(event.submission.runtime)}`,
    event.submission.agent && `<b>Agent</b>: ${escapeHtml(event.submission.agent)}`,
    event.submission.session_id && `<b>Session</b>: <code>${escapeHtml(event.submission.session_id)}</code>`,
  ].filter(Boolean);

  if (event.type === "decision_created") {
    const options = event.decision.options?.length
      ? `\n<b>Options</b>: ${event.decision.options.map(escapeHtml).join(" | ")}`
      : "";
    return [
      "<b>New decision</b>",
      `<b>${escapeHtml(event.submission.title)}</b>`,
      escapeHtml(event.decision.question),
      options.trim(),
      context.join("\n"),
    ]
      .filter(Boolean)
      .join("\n");
  }

  return ["<b>Alert</b>", `<b>${escapeHtml(event.submission.title)}</b>`, escapeHtml(event.submission.summary), context.join("\n")]
    .filter(Boolean)
    .join("\n");
}

export function createTelegramPublisher(options: TelegramPublisherOptions): NotificationPublisher {
  const fetch = options.fetch ?? undiciFetch;
  const retryAttempts = Math.max(1, options.retryAttempts ?? 3);
  const sleep = options.sleep ?? defaultSleep;
  const dispatcher: Dispatcher | undefined = options.proxyUrl ? new ProxyAgent(options.proxyUrl) : undefined;
  const endpoint = `https://api.telegram.org/bot${options.botToken}/sendMessage`;
  const publicUrl = options.publicUrl?.replace(/\/$/, "");

  return {
    async publish(event: NotificationEvent): Promise<void> {
      for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              chat_id: options.chatId,
              text: messageFor(event),
              parse_mode: "HTML",
              disable_web_page_preview: true,
              ...(publicUrl
                ? {
                    reply_markup: {
                      inline_keyboard: [[{
                        text: event.type === "decision_created" ? "Open decision" : "Open alert",
                        url: `${publicUrl}/#${event.type === "decision_created" ? `decision/${event.decision.id}` : `submission/${event.submission.id}`}`,
                      }]],
                    },
                  }
                : {}),
            }),
            ...(dispatcher ? { dispatcher } : {}),
            signal: AbortSignal.timeout(5_000),
          });
          if (response.ok) return;
        } catch {
          // Failures are intentionally handled below without exposing the bot URL or Token.
        }
        if (attempt < retryAttempts) await sleep(250 * 2 ** (attempt - 1));
      }
      throw new Error("Telegram notification delivery failed");
    },
  };
}

export function createPublisherFromEnvironment(environment = process.env): NotificationPublisher | undefined {
  const botToken = environment.THREADLINE_TELEGRAM_BOT_TOKEN;
  const chatId = environment.THREADLINE_TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return undefined;
  const parsedAttempts = Number.parseInt(environment.THREADLINE_NOTIFICATION_RETRY_ATTEMPTS ?? "3", 10);
  return createTelegramPublisher({
    botToken,
    chatId,
    ...(environment.THREADLINE_HTTP_PROXY ? { proxyUrl: environment.THREADLINE_HTTP_PROXY } : {}),
    ...(environment.THREADLINE_PUBLIC_URL ? { publicUrl: environment.THREADLINE_PUBLIC_URL } : {}),
    retryAttempts: Number.isFinite(parsedAttempts) ? parsedAttempts : 3,
  });
}
