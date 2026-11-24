-- Wish lists: one list per person plus an allowance ledger. Safe to re-run (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS wishes (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL CHECK (owner IN ('lulu', 'dengdeng')),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 200),
  created_at TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  done_at TEXT,
  done_by TEXT,
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_wishes_owner ON wishes (owner, visible, created_at);
CREATE TABLE IF NOT EXISTS wish_allowance (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL CHECK (owner IN ('lulu', 'dengdeng')),
  delta INTEGER NOT NULL CHECK (delta <> 0 AND delta BETWEEN -20 AND 20),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 100),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wish_allowance_owner ON wish_allowance (owner, created_at);
