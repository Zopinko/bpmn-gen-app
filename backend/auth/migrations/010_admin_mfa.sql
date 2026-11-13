-- Idempotent admin MFA migration for SQLite
-- Admin Multi-Factor Authentication support

-- Admin MFA settings per user
CREATE TABLE IF NOT EXISTS admin_mfa (
    user_id TEXT NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret_ciphertext TEXT NOT NULL,
    pending_session_hash TEXT,
    pending_expires_at TEXT,
    last_counter INTEGER,
    enabled_at TEXT
);

-- Admin MFA recovery codes with composite primary key
CREATE TABLE IF NOT EXISTS admin_mfa_recovery (
    user_id TEXT NOT NULL REFERENCES admin_mfa(user_id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    PRIMARY KEY (user_id, code_hash)
);

-- Admin MFA session elevation tracking
CREATE TABLE IF NOT EXISTS admin_mfa_elevations (
    session_hash TEXT NOT NULL PRIMARY KEY,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (session_hash) REFERENCES auth_sessions(session_id_hash) ON DELETE CASCADE
);

-- Admin MFA rate limiting attempts
CREATE TABLE IF NOT EXISTS admin_mfa_attempts (
    user_id TEXT NOT NULL PRIMARY KEY,
    window_start INTEGER NOT NULL,
    attempts INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
