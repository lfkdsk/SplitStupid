-- 0006_offline_members.sql — group-scoped members without login accounts.
--
-- Offline members are not auth accounts and never appear in accounts or
-- identities. Their guest key is stored in members.login so the existing
-- ledger shape keeps working; this table only preserves the display profile.

CREATE TABLE IF NOT EXISTS offline_members (
  member_key    TEXT PRIMARY KEY,
  group_id      TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_members_group_name
  ON offline_members(group_id, display_name COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_offline_members_group
  ON offline_members(group_id);
