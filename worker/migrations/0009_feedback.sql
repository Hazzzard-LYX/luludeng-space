-- 需求反馈 (feedback board): website feature requests / bug reports from lulu & dengdeng.
CREATE TABLE IF NOT EXISTS feedback_items (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'other')),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 500),
  created_by TEXT,
  created_at TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  done_at TEXT,
  done_by TEXT,
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  deleted_by TEXT,
  deleted_at TEXT,
  deleted_reason TEXT CHECK (deleted_reason IS NULL OR length(deleted_reason) <= 100)
);

CREATE INDEX IF NOT EXISTS idx_feedback_visible_created_at
ON feedback_items (visible, created_at, id);
