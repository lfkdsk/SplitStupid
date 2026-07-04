-- 0005_accounts.sql — provider identities and canonical accounts.
--
-- Existing ledger tables keep their *_login column names for compatibility,
-- but values are now canonical SplitStupid account keys. GitHub users keep
-- their login as the account key on first GitHub sign-in, preserving legacy
-- groups. Apple-only users use an apple:<hash> account key until/unless a
-- matching real email signs in with GitHub later.

CREATE TABLE IF NOT EXISTS accounts (
  account_key       TEXT PRIMARY KEY,
  email             TEXT UNIQUE,
  display_name      TEXT NOT NULL,
  avatar_url        TEXT,
  primary_provider  TEXT CHECK (primary_provider IN ('github','apple')),
  provider_login    TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);

CREATE TABLE IF NOT EXISTS identities (
  provider          TEXT NOT NULL CHECK (provider IN ('github','apple')),
  provider_user_id  TEXT NOT NULL,
  account_key       TEXT NOT NULL REFERENCES accounts(account_key) ON DELETE CASCADE,
  email             TEXT,
  display_name      TEXT,
  avatar_url        TEXT,
  provider_login    TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_identities_account ON identities(account_key);
CREATE INDEX IF NOT EXISTS idx_identities_email ON identities(email);
