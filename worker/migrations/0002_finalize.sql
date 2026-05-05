-- Finalize: an owner can lock a group once everyone's settled up. Once
-- locked, no more expenses, voids, or member changes; the ledger is
-- frozen as historical record. Owner can reopen if needed.
--
-- Stored as a timestamp (ms) rather than a boolean so we can also surface
-- "finalized at <date>" in the UI without a second column.

ALTER TABLE groups ADD COLUMN finalized_at INTEGER;
