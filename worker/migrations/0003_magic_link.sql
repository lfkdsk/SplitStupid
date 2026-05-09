-- Magic-link email auth: a second, parallel identity scheme alongside
-- GitHub OAuth. Email users live in the same groups/members/events
-- tables, just with their email address (e.g. "alice@example.com")
-- in the *_login columns instead of a GitHub username. The two id
-- spaces don't overlap because GitHub logins can't contain "@".
--
-- Two tables:
--   magic_tokens — short-lived (15 min) one-time-use tokens that we
--                  email out as `https://.../#magic_token=…`. Once
--                  redeemed they get a non-null `consumed_at` and
--                  cannot be reused.
--   sessions     — long-lived (30 day) bearer tokens issued in
--                  exchange for a redeemed magic token. These are
--                  what the frontend sends as
--                  `Authorization: Bearer mls_<token>`. Stored opaque
--                  (not a JWT) so we can revoke by row delete.

CREATE TABLE IF NOT EXISTS magic_tokens (
  token        TEXT PRIMARY KEY,        -- 32-hex random
  email        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,        -- unix ms
  expires_at   INTEGER NOT NULL,        -- unix ms; ≈15 min after created_at
  consumed_at  INTEGER                  -- null until redeemed; non-null = used
);

CREATE INDEX IF NOT EXISTS idx_magic_tokens_email ON magic_tokens(email);

CREATE TABLE IF NOT EXISTS sessions (
  token        TEXT PRIMARY KEY,        -- 48-hex random; sent as `mls_<token>`
  email        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL         -- unix ms; sliding 30-day window
);

CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);
