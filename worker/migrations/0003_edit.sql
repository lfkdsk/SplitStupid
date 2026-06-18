-- 0003_edit.sql — first-class "edit" events.
--
-- Until now an "edit" was faked on the client as a void-of-the-original plus
-- a fresh expense. That worked but littered the ledger with paired void +
-- expense rows for every correction. An edit is now its own event type that
-- amends an existing expense's amount / date in place, leaving one clean
-- audit row.
--
-- SQLite can't ALTER a CHECK constraint in place, so the only way to widen
-- the events.type set is to recreate the table and copy the rows across.
-- events has no incoming foreign keys (members → groups, events → groups),
-- so the swap is safe; we just rebuild its own index afterwards.

PRAGMA foreign_keys = OFF;

CREATE TABLE events_new (
  id            TEXT PRIMARY KEY,
  group_id      TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('expense','void','edit')),
  payload       TEXT NOT NULL,
  author_login  TEXT NOT NULL,
  ts            INTEGER NOT NULL
);

INSERT INTO events_new (id, group_id, type, payload, author_login, ts)
  SELECT id, group_id, type, payload, author_login, ts FROM events;

DROP TABLE events;
ALTER TABLE events_new RENAME TO events;

CREATE INDEX IF NOT EXISTS idx_events_group_ts ON events(group_id, ts);

PRAGMA foreign_keys = ON;

-- edit payload: { targetId, amount, date }
--   targetId — id of the expense event being amended
--   amount   — new amount in minor units (positive integer)
--   date     — new effective expense date, unix ms
-- The edit row's own `ts` column is when the edit was made (audit order);
-- `date` carries the expense's new displayed instant.
