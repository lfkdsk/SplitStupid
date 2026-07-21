-- 0005_exchange_rates.sql — cached FX rates for multi-currency expenses.
--
-- Expense payloads still store the final converted amount used for settlement.
-- This table is only a local cache for automatic provider lookups so web and
-- mobile clients do not call a public rates API directly.

CREATE TABLE IF NOT EXISTS exchange_rates (
  base_currency   TEXT NOT NULL,
  quote_currency  TEXT NOT NULL,
  rate_date       TEXT NOT NULL,
  provider        TEXT NOT NULL,
  rate            REAL NOT NULL,
  fetched_at      INTEGER NOT NULL,
  PRIMARY KEY (base_currency, quote_currency, rate_date, provider)
);
