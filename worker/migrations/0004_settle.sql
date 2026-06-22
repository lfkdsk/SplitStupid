-- 0004_settle.sql — first-class "settle" (clear-the-slate) events.
--
-- A settle event is a lightweight checkpoint *any member* can stamp to record
-- "as of now we're squared up". Unlike finalize (which locks the whole group
-- forever), a settle just draws a line: balance computation resets from here,
-- the group stays open, and the checkpoint stands as proof everyone was even
-- at that instant. Repeatable — settle as often as you clear accounts.
--
-- SQLite can't ALTER a CHECK constraint in place, so widen events.type the
-- same way 0003 did: recreate the table and copy the rows across. events has
-- no incoming foreign keys, so the swap is safe; we rebuild its index after.

PRAGMA foreign_keys = OFF;

CREATE TABLE events_new (
  id            TEXT PRIMARY KEY,
  group_id      TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('expense','void','edit','settle')),
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

-- settle payload: { note? }  — an optional human note ("June rent squared up").
-- The event's own `ts` is the clear instant, stamped strictly after every
-- prior event in the group so the boundary is unambiguous even against
-- backdated expenses. Settlement (balances + suggested transfers) is computed
-- only over the expense/void/edit events appended after the latest settle.
