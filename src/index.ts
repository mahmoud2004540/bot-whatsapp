import { handleAdmin } from "./admin";
import { handleMessage } from "./bot";
import { getChannel } from "./channels";
import { Store } from "./store";
import type { Env } from "./types";

const MAX_BODY_CHARS = 1_000_000;

async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  const channel = getChannel(url.pathname.split("/")[2] ?? "", env);
  if (!channel) return new Response("Not found", { status: 404 });

  if (request.method === "GET") return channel.handleVerification(url);
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_CHARS) return new Response("Too large", { status: 413 });
  if (!(await channel.verifyRequest(request, rawBody))) {
    return new Response("Invalid signature", { status: 401 });
  }

  // Answer at once, otherwise the platform times out and resends the webhook.
  ctx.waitUntil(
    (async () => {
      for (const message of channel.parseMessages(rawBody)) {
        try {
          await handleMessage(env, channel, message);
        } catch (error) {
          console.error(`Failed to handle message: ${String(error)}`);
        }
      }
    })(),
  );
  return new Response("OK");
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/") return new Response("OK");
    if (url.pathname.startsWith("/webhook/")) return handleWebhook(request, env, ctx, url);
    if (url.pathname.startsWith("/admin/")) return handleAdmin(request, env, url);
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_event, env): Promise<void> {
    const cutoff = Math.floor(Date.now() / 1000) - Number(env.RETENTION_DAYS) * 86_400;
    await new Store(env.DB).cleanup(cutoff);
  },
} satisfies ExportedHandler<Env>;
