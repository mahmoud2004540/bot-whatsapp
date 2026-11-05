import { getChannel } from "./channels";
import { safeEqual } from "./crypto";
import { Store } from "./store";
import type { Env } from "./types";

const json = (data: unknown, status = 200) => Response.json(data, { status });

/**
 * Bearer-protected endpoints for the person behind the bot:
 *   GET    /admin/whatsapp/stats
 *   GET    /admin/whatsapp/handoffs
 *   GET    /admin/whatsapp/conversations/<number>
 *   POST   /admin/whatsapp/conversations/<number>/reply   {"text":"..."}
 *   POST   /admin/whatsapp/conversations/<number>/resume
 *   DELETE /admin/whatsapp/conversations/<number>
 */
export async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  // With no token configured the endpoints do not exist.
  if (!env.ADMIN_TOKEN) return new Response("Not found", { status: 404 });

  const auth = request.headers.get("authorization") ?? "";
  if (!(await safeEqual(auth, `Bearer ${env.ADMIN_TOKEN}`))) {
    return json({ error: "unauthorized" }, 401);
  }

  const [, , channelName = "", section = "", userId = "", action = ""] = url.pathname.split("/");
  const channel = getChannel(channelName, env);
  if (!channel) return json({ error: "unknown channel" }, 404);

  const store = new Store(env.DB);
  const now = Math.floor(Date.now() / 1000);
  const method = request.method;

  if (section === "stats" && method === "GET") {
    return json({
      month_sent: await store.getMonthlyUsage(channel.name, now),
      month_limit: Number(env.MONTHLY_REPLY_LIMIT),
    });
  }

  if (section === "handoffs" && method === "GET") {
    return json({ handoffs: await store.listHandoffs(channel.name, now) });
  }

  if (section !== "conversations" || !channel.isValidUserId(userId)) {
    return json({ error: "not found" }, 404);
  }

  if (!action && method === "GET") {
    return json({ messages: await store.getConversation(channel.name, userId) });
  }

  if (!action && method === "DELETE") {
    await store.deleteUser(channel.name, userId);
    return json({ deleted: true });
  }

  if (action === "resume" && method === "POST") {
    await store.setHandoff(channel.name, userId, 0);
    return json({ resumed: true });
  }

  if (action === "reply" && method === "POST") {
    const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return json({ error: "text is required" }, 400);

    if (!(await store.reserveSend(channel.name, Number(env.MONTHLY_REPLY_LIMIT), now))) {
      return json({ error: "monthly limit reached" }, 429);
    }
    try {
      await channel.send(userId, text);
    } catch (error) {
      await store.releaseSend(channel.name, now);
      return json({ error: String(error) }, 502);
    }
    await store.saveMessage(channel.name, userId, "human", text, now);
    return json({ sent: true });
  }

  return json({ error: "not found" }, 404);
}
