BEGIN IMMEDIATE;

ALTER TABLE auth_email_outbox RENAME TO auth_email_outbox_previous;
CREATE TABLE auth_email_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    verification_id TEXT,
    invite_id TEXT UNIQUE REFERENCES organization_invites(id) ON DELETE CASCADE,
    language TEXT,
    notice_type TEXT,
    notice_org_name TEXT,
    available_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    CHECK (
        (kind = 'verify_email' AND user_id IS NOT NULL AND verification_id IS NOT NULL AND invite_id IS NULL) OR
        (kind = 'password_changed' AND user_id IS NOT NULL AND verification_id IS NULL AND invite_id IS NULL) OR
        (kind = 'organization_invite' AND user_id IS NULL AND verification_id IS NULL AND invite_id IS NOT NULL AND language IS NOT NULL) OR
        (kind = 'organization_notice' AND user_id IS NOT NULL AND verification_id IS NULL AND invite_id IS NULL
            AND notice_type IS NOT NULL AND notice_org_name IS NOT NULL)
    )
);

INSERT INTO auth_email_outbox(id, user_id, kind, verification_id, invite_id, language, available_at, attempts)
    SELECT id, user_id, kind, verification_id, invite_id, language, available_at, attempts FROM auth_email_outbox_previous;
DROP TABLE auth_email_outbox_previous;

CREATE INDEX idx_auth_email_available ON auth_email_outbox(available_at, id);
CREATE UNIQUE INDEX idx_auth_email_verification_pending
    ON auth_email_outbox(user_id, verification_id) WHERE verification_id IS NOT NULL;
