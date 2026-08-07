CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  author TEXT NOT NULL CHECK (length(author) BETWEEN 1 AND 50),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  mood TEXT CHECK (mood IS NULL OR length(mood) <= 32),
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_messages_visible_created_at
ON messages (visible, created_at, id);

PRAGMA optimize;
