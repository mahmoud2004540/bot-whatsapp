import { safeEqual, verifyHmacSha256 } from "../crypto";
import type { Channel, Env, IncomingMessage } from "../types";

const WHATSAPP_MAX_TEXT = 4096;

/** Service events with nothing to answer. Anything else unreadable gets a polite reply. */
const IGNORED_TYPES = new Set(["reaction", "system", "unsupported", "errors"]);

interface WaMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
}

interface WaPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: WaMessage[];
      };
    }>;
  }>;
}

function readableText(message: WaMessage): string | null {
  const text =
    message.text?.body ??
    message.button?.text ??
    message.interactive?.button_reply?.title ??
    message.interactive?.list_reply?.title;
  return text?.trim() || null;
}

export function parseWhatsAppPayload(rawBody: string, phoneNumberId: string): IncomingMessage[] {
  let payload: WaPayload;
  try {
    payload = JSON.parse(rawBody) as WaPayload;
  } catch {
    return [];
  }

  const incoming: IncomingMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value || value.metadata?.phone_number_id !== phoneNumberId) continue;

      for (const message of value.messages ?? []) {
        const type = message.type ?? "unknown";
        if (!message.id || !message.from || IGNORED_TYPES.has(type)) continue;
        incoming.push({
          channel: "whatsapp",
          id: message.id,
          userId: message.from,
          text: readableText(message),
          label: `[${type}]`,
          timestamp: Number(message.timestamp) || 0,
        });
      }
    }
  }
  return incoming;
}

export class WhatsAppChannel implements Channel {
  readonly name = "whatsapp";

  constructor(private readonly env: Env) {}

  async handleVerification(url: URL): Promise<Response> {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token") ?? "";
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    const configured = this.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === "subscribe" && configured && (await safeEqual(token, configured))) {
      return new Response(challenge, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return new Response("Forbidden", { status: 403 });
  }

  verifyRequest(request: Request, rawBody: string): Promise<boolean> {
    return verifyHmacSha256(
      this.env.WHATSAPP_APP_SECRET,
      rawBody,
      request.headers.get("x-hub-signature-256"),
    );
  }

  parseMessages(rawBody: string): IncomingMessage[] {
    return parseWhatsAppPayload(rawBody, this.env.WHATSAPP_PHONE_NUMBER_ID);
  }

  isValidUserId(userId: string): boolean {
    return /^\d{6,15}$/.test(userId);
  }

  async send(userId: string, text: string): Promise<void> {
    const base = this.env.GRAPH_BASE_URL ?? "https://graph.facebook.com";
    const url = `${base}/${this.env.GRAPH_API_VERSION}/${this.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.env.WHATSAPP_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: userId,
        type: "text",
        // Keeps a link in a generated reply from being fetched and previewed.
        text: { preview_url: false, body: text.slice(0, WHATSAPP_MAX_TEXT) },
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      const details = (await response.json().catch(() => null)) as {
        error?: { code?: number; message?: string };
      } | null;
      throw new Error(
        `WhatsApp send failed: HTTP ${response.status}, code ${details?.error?.code ?? "?"}, ${details?.error?.message ?? "no details"}`,
      );
    }
  }
}
