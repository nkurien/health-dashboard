-- Google OAuth tokens for the two dashboard users. Token columns hold AES-GCM
-- ciphertext ("enc:v1:<base64>"), never plaintext.
CREATE TABLE IF NOT EXISTS user_tokens (
  user_id       TEXT PRIMARY KEY CHECK (user_id IN ('user1', 'user2')),
  access_token  TEXT NOT NULL,
  refresh_token TEXT,
  token_expiry  INTEGER,           -- unix ms
  google_sub    TEXT,
  display_name  TEXT,
  email         TEXT,
  updated_at    INTEGER NOT NULL   -- unix ms
);
