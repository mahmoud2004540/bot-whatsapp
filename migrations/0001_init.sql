CREATE TABLE conversations (
  channel        TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  disclosed      INTEGER NOT NULL DEFAULT 0,
  handoff_until  INTEGER NOT NULL DEFAULT 0,
  last_seen      INTEGER NOT NULL,
  PRIMARY KEY (channel, user_id)
);

CREATE TABLE messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user', 'bot', 'human')),
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_messages_conversation ON messages (channel, user_id, created_at);
CREATE INDEX idx_messages_created ON messages (created_at);

-- Meta retries webhooks, so every incoming message id is recorded once.
CREATE TABLE processed_messages (
  channel     TEXT NOT NULL,
  message_id  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (channel, message_id)
);
CREATE INDEX idx_processed_created ON processed_messages (created_at);

CREATE TABLE monthly_usage (
  channel  TEXT NOT NULL,
  month    TEXT NOT NULL,
  sent     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel, month)
);
