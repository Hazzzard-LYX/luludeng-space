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
