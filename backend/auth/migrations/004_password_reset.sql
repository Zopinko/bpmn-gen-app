ALTER TABLE users ADD COLUMN password_reset_token_hash TEXT NULL;
ALTER TABLE users ADD COLUMN password_reset_expires_at TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_users_password_reset_token_hash ON users(password_reset_token_hash);
