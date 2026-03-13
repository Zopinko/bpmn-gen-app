ALTER TABLE organization_invites ADD COLUMN expires_at TEXT NULL;
ALTER TABLE organization_invites ADD COLUMN used_at TEXT NULL;
ALTER TABLE organization_invites ADD COLUMN used_by_user_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_org_invites_expires_at ON organization_invites(expires_at);
CREATE INDEX IF NOT EXISTS idx_org_invites_used_at ON organization_invites(used_at);
