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

-- Food map (美食地图): places we ate, with photos stored in R2 under food/.
CREATE TABLE IF NOT EXISTS food_spots (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  city TEXT NOT NULL CHECK (length(city) BETWEEN 1 AND 50),
  address TEXT NOT NULL DEFAULT '' CHECK (length(address) <= 100),
  lat REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  visited_on TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_food_spots_visible ON food_spots (visible, visited_on);

CREATE TABLE IF NOT EXISTS food_photos (
  id TEXT PRIMARY KEY NOT NULL,
  spot_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_food_photos_spot ON food_photos (spot_id, visible);

PRAGMA optimize;
