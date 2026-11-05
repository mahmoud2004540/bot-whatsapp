import { HANDOFF_WORDS, MESSAGES } from "./business";
import { generateReply, HANDOFF_MARKER } from "./llm";
import { Store } from "./store";
import type { Channel, Env, IncomingMessage } from "./types";

const MAX_INPUT_CHARS = 1000;
/** WhatsApp only allows free-form replies within 24 hours, so older retries are dropped. */
const MAX_MESSAGE_AGE_SECONDS = 23 * 60 * 60;

export function wantsHuman(text: string): boolean {
  const lower = text.toLowerCase();
  return HANDOFF_WORDS.some((word) => {
    // \b does not work with Arabic, so word edges are checked with Unicode classes.
    const escaped = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u").test(lower);
  });
}

export function pickMessages(text: string | null) {
  return text && /\p{Script=Arabic}/u.test(text) ? MESSAGES.ar : MESSAGES.intl;
}

async function notifyOwner(
  env: Env,
  channel: Channel,
  store: Store,
  message: IncomingMessage,
  now: number,
): Promise<void> {
  const owner = env.OWNER_WHATSAPP;
  if (!owner || owner === message.userId) return;
  if (!(await store.reserveSend(channel.name, Number(env.MONTHLY_REPLY_LIMIT), now))) return;
  try {
    await channel.send(owner, `Customer ${message.userId} is waiting for a person.`);
  } catch (error) {
    // Expected when the owner has not messaged the bot in the last 24 hours.
    await store.releaseSend(channel.name, now);
    console.warn(`Owner notification failed: ${String(error)}`);
  }
}

export async function handleMessage(
  env: Env,
  channel: Channel,
  message: IncomingMessage,
  now = Math.floor(Date.now() / 1000),
): Promise<void> {
  const store = new Store(env.DB);
  const { userId } = message;

  if (!(await store.markProcessed(channel.name, message.id, now))) return;
  if (now - message.timestamp > MAX_MESSAGE_AGE_SECONDS) return;

  // Stops one person from using up the monthly allowance and the AI quota.
  const recent = await store.countUserMessagesSince(channel.name, userId, now - 3600);
  if (recent >= Number(env.MAX_USER_MSGS_PER_HOUR)) return;

  const text = message.text?.slice(0, MAX_INPUT_CHARS) ?? null;
  await store.touchConversation(channel.name, userId, now);
  await store.saveMessage(channel.name, userId, "user", text ?? message.label, now);

  if (await store.isInHandoff(channel.name, userId, now)) return;

  if (!(await store.reserveSend(channel.name, Number(env.MONTHLY_REPLY_LIMIT), now))) {
    console.warn(`Monthly reply limit reached for ${channel.name}; not replying.`);
    return;
  }

  const fixed = pickMessages(text);
  let reply: string;
  let handoff = false;

  if (text === null) {
    reply = fixed.unsupported;
  } else if (wantsHuman(text)) {
    reply = fixed.handoff;
    handoff = true;
  } else {
    try {
      const generated = await generateReply(env, await store.getHistory(channel.name, userId));
      if (generated.includes(HANDOFF_MARKER)) {
        reply = fixed.handoff;
        handoff = true;
      } else {
        reply = generated;
      }
    } catch (error) {
      console.error(String(error));
      reply = fixed.unavailable;
    }
  }

  const firstReply = await store.claimDisclosure(channel.name, userId);
  try {
    await channel.send(userId, firstReply ? `${fixed.disclosure}\n\n${reply}` : reply);
  } catch (error) {
    await store.releaseSend(channel.name, now);
    if (firstReply) await store.releaseDisclosure(channel.name, userId);
    throw error;
  }

  await store.saveMessage(channel.name, userId, "bot", reply, now);

  if (handoff) {
    await store.setHandoff(channel.name, userId, now + Number(env.HANDOFF_HOURS) * 3600);
    await notifyOwner(env, channel, store, message, now);
  }
}
