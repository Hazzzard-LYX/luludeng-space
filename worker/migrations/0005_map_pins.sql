-- Map pins (footprints/wishes added on the map) and hidden places, shared across devices.
CREATE TABLE IF NOT EXISTS map_pins (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
  type TEXT NOT NULL CHECK (type IN ('footprint', 'wish')),
  lat REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  created_by TEXT,
  created_at TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_map_pins_visible ON map_pins (visible, created_at);
CREATE TABLE IF NOT EXISTS map_hidden (
  key TEXT PRIMARY KEY NOT NULL CHECK (length(key) <= 200),
  created_at TEXT NOT NULL
);
