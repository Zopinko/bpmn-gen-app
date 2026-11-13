CREATE TABLE IF NOT EXISTS email_verifications (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    verification_id TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    requested_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_email_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('verify_email', 'password_changed')),
    verification_id TEXT,
    available_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    CHECK ((kind = 'verify_email' AND verification_id IS NOT NULL) OR
           (kind = 'password_changed' AND verification_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_auth_email_available ON auth_email_outbox(available_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_email_verification_pending
    ON auth_email_outbox(user_id, verification_id) WHERE verification_id IS NOT NULL;
