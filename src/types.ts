export interface Env {
  DB: D1Database;

  // Secrets
  WHATSAPP_ACCESS_TOKEN: string;
  WHATSAPP_APP_SECRET: string;
  WHATSAPP_VERIFY_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  GROQ_API_KEY: string;
  ADMIN_TOKEN?: string;

  // Settings
  GRAPH_API_VERSION: string;
  GROQ_MODEL: string;
  GROQ_FALLBACK_MODEL?: string;
  MONTHLY_REPLY_LIMIT: string;
  MAX_USER_MSGS_PER_HOUR: string;
  HANDOFF_HOURS: string;
  RETENTION_DAYS: string;

  /** Optional number (digits only) that gets told when a customer needs a person. */
  OWNER_WHATSAPP?: string;

  // Overridden only by the local end-to-end test.
  GRAPH_BASE_URL?: string;
  GROQ_BASE_URL?: string;
}

export interface IncomingMessage {
  channel: string;
  /** Unique per channel. Used to ignore webhook retries. */
  id: string;
  userId: string;
  /** Null when the message is something the bot cannot read, such as a photo. */
  text: string | null;
  /** Short label stored in place of unreadable content, for example "[image]". */
  label: string;
  /** Unix seconds. */
  timestamp: number;
}

/**
 * Everything a platform has to provide. To add Instagram or Telegram, implement
 * this interface and register it in src/channels/index.ts. Nothing else changes.
 */
export interface Channel {
  readonly name: string;
  /** Answers the platform's webhook setup handshake (GET). */
  handleVerification(url: URL): Promise<Response>;
  /** Proves that a POST really came from the platform. */
  verifyRequest(request: Request, rawBody: string): Promise<boolean>;
  parseMessages(rawBody: string): IncomingMessage[];
  send(userId: string, text: string): Promise<void>;
  isValidUserId(userId: string): boolean;
}
