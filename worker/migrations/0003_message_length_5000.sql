-- Raises the message length limit from 500 to 5000 characters.
-- SQLite cannot change a CHECK constraint in place, so the table is rebuilt (data copied, then swapped).
-- Applied to production on 2026-11-23 from the D1 console, after taking a /bookmark restore point.
CREATE TABLE messages_new (
  id TEXT PRIMARY KEY NOT NULL,
  author TEXT NOT NULL CHECK (length(author) BETWEEN 1 AND 50),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 5000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  mood TEXT CHECK (mood IS NULL OR length(mood) <= 32),
  title TEXT CHECK (title IS NULL OR length(title) <= 30),
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1))
);
INSERT INTO messages_new (id, author, content, created_at, mood, title, visible)
SELECT id, author, content, created_at, mood, title, visible FROM messages;
DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;
CREATE INDEX IF NOT EXISTS idx_messages_visible_created_at ON messages (visible, created_at, id);
