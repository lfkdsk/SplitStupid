-- SplitStupid D1 schema. Three tables: groups, members, events.
-- Settlement / balance computation stays client-side (pure function over
-- events + members), so the schema only stores raw facts; no aggregates.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS groups (
  id           TEXT PRIMARY KEY,        -- 12-hex random; the share-URL slug
  name         TEXT NOT NULL,
  currency     TEXT NOT NULL,
  owner_login  TEXT NOT NULL,           -- GH login of the creator
  created_at   INTEGER NOT NULL         -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups(owner_login);

-- Membership is a separate table (not a JSON column on groups) so we can
-- index by login and answer "what groups is alice in" with a single SQL
-- query — that's the joiner's "Your groups" list.
CREATE TABLE IF NOT EXISTS members (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  login      TEXT NOT NULL,
  joined_at  INTEGER NOT NULL,
  PRIMARY KEY (group_id, login)
);

CREATE INDEX IF NOT EXISTS idx_members_login ON members(login);

-- Events are append-only by convention. Edits/deletes are expressed as
-- type='void' rows that reference targetId in the payload — keeps the
-- audit trail intact and matches the existing frontend mental model.
CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,           -- 12-hex random
  group_id      TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('expense','void')),
  payload       TEXT NOT NULL,              -- JSON: see below
  author_login  TEXT NOT NULL,              -- GH login that recorded this
  ts            INTEGER NOT NULL            -- unix ms
);

-- expense payload: { payer, amount, participants:[login,...],
--                    split:'equal'|{login:amount,...}, note? }
-- void payload:    { targetId, reason? }

CREATE INDEX IF NOT EXISTS idx_events_group_ts ON events(group_id, ts);
