import type { ChatMessage } from "./llm";

export type Role = "user" | "bot" | "human";

const HISTORY_LIMIT = 10;

function currentMonth(now: number): string {
  return new Date(now * 1000).toISOString().slice(0, 7);
}

export class Store {
  constructor(private readonly db: D1Database) {}

  /** Returns false when this message id was already handled. */
  async markProcessed(channel: string, id: string, now: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        "INSERT OR IGNORE INTO processed_messages (channel, message_id, created_at) VALUES (?, ?, ?)",
      )
      .bind(channel, id, now)
      .run();
    return result.meta.changes === 1;
  }

  async countUserMessagesSince(channel: string, userId: string, since: number): Promise<number> {
    const row = await this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM messages WHERE channel = ? AND user_id = ? AND role = 'user' AND created_at >= ?",
      )
      .bind(channel, userId, since)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async touchConversation(channel: string, userId: string, now: number): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO conversations (channel, user_id, last_seen) VALUES (?, ?, ?)
         ON CONFLICT (channel, user_id) DO UPDATE SET last_seen = excluded.last_seen`,
      )
      .bind(channel, userId, now)
      .run();
  }

  async saveMessage(
    channel: string,
    userId: string,
    role: Role,
    content: string,
    now: number,
  ): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO messages (channel, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(channel, userId, role, content, now)
      .run();
  }

  async getHistory(channel: string, userId: string): Promise<ChatMessage[]> {
    const { results } = await this.db
      .prepare(
        "SELECT role, content FROM messages WHERE channel = ? AND user_id = ? ORDER BY id DESC LIMIT ?",
      )
      .bind(channel, userId, HISTORY_LIMIT)
      .all<{ role: Role; content: string }>();
    return results.reverse().map((row) => ({
      role: row.role === "user" ? "user" : "assistant",
      content: row.content,
    }));
  }

  async isInHandoff(channel: string, userId: string, now: number): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT handoff_until FROM conversations WHERE channel = ? AND user_id = ?")
      .bind(channel, userId)
      .first<{ handoff_until: number }>();
    return (row?.handoff_until ?? 0) > now;
  }

  async setHandoff(channel: string, userId: string, until: number): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE conversations SET handoff_until = ? WHERE channel = ? AND user_id = ?")
      .bind(until, channel, userId)
      .run();
    return result.meta.changes === 1;
  }

  async listHandoffs(channel: string, now: number) {
    const { results } = await this.db
      .prepare(
        "SELECT user_id, handoff_until, last_seen FROM conversations WHERE channel = ? AND handoff_until > ? ORDER BY last_seen DESC",
      )
      .bind(channel, now)
      .all<{ user_id: string; handoff_until: number; last_seen: number }>();
    return results;
  }

  async getConversation(channel: string, userId: string) {
    const { results } = await this.db
      .prepare(
        "SELECT role, content, created_at FROM messages WHERE channel = ? AND user_id = ? ORDER BY id DESC LIMIT 100",
      )
      .bind(channel, userId)
      .all<{ role: Role; content: string; created_at: number }>();
    return results.reverse();
  }

  /** Claims the once-per-conversation bot notice. Returns true only for the first caller. */
  async claimDisclosure(channel: string, userId: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE conversations SET disclosed = 1 WHERE channel = ? AND user_id = ? AND disclosed = 0",
      )
      .bind(channel, userId)
      .run();
    return result.meta.changes === 1;
  }

  async releaseDisclosure(channel: string, userId: string): Promise<void> {
    await this.db
      .prepare("UPDATE conversations SET disclosed = 0 WHERE channel = ? AND user_id = ?")
      .bind(channel, userId)
      .run();
  }

  /** Atomically takes one send from the monthly allowance. False means it is used up. */
  async reserveSend(channel: string, limit: number, now: number): Promise<boolean> {
    if (limit <= 0) return false;
    const row = await this.db
      .prepare(
        `INSERT INTO monthly_usage (channel, month, sent) VALUES (?, ?, 1)
         ON CONFLICT (channel, month) DO UPDATE SET sent = sent + 1 WHERE sent < ?
         RETURNING sent`,
      )
      .bind(channel, currentMonth(now), limit)
      .first<{ sent: number }>();
    return row !== null;
  }

  /** Gives a reservation back when the platform rejected the message. */
  async releaseSend(channel: string, now: number): Promise<void> {
    await this.db
      .prepare(
        "UPDATE monthly_usage SET sent = sent - 1 WHERE channel = ? AND month = ? AND sent > 0",
      )
      .bind(channel, currentMonth(now))
      .run();
  }

  async getMonthlyUsage(channel: string, now: number): Promise<number> {
    const row = await this.db
      .prepare("SELECT sent FROM monthly_usage WHERE channel = ? AND month = ?")
      .bind(channel, currentMonth(now))
      .first<{ sent: number }>();
    return row?.sent ?? 0;
  }

  async deleteUser(channel: string, userId: string): Promise<void> {
    await this.db.batch([
      this.db.prepare("DELETE FROM messages WHERE channel = ? AND user_id = ?").bind(channel, userId),
      this.db
        .prepare("DELETE FROM conversations WHERE channel = ? AND user_id = ?")
        .bind(channel, userId),
    ]);
  }

  async cleanup(cutoff: number): Promise<void> {
    await this.db.batch([
      this.db.prepare("DELETE FROM messages WHERE created_at < ?").bind(cutoff),
      this.db.prepare("DELETE FROM processed_messages WHERE created_at < ?").bind(cutoff),
      this.db.prepare("DELETE FROM conversations WHERE last_seen < ?").bind(cutoff),
    ]);
  }
}
