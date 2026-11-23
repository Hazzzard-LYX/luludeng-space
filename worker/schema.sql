CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  author TEXT NOT NULL CHECK (length(author) BETWEEN 1 AND 50),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 5000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  mood TEXT CHECK (mood IS NULL OR length(mood) <= 32),
  title TEXT CHECK (title IS NULL OR length(title) <= 30),
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_messages_visible_created_at
ON messages (visible, created_at, id);


CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  place TEXT NOT NULL CHECK (length(place) BETWEEN 1 AND 50),
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'visible', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_photos_status_created_at
ON photos (status, created_at, id);

CREATE TABLE IF NOT EXISTS places (
  name TEXT PRIMARY KEY NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
  lat REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS hidden_static_photos (
  src TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

PRAGMA optimize;
