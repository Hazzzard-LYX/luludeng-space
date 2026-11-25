-- Half-star ratings (0.5-5). The original `rating` column only allows whole stars 1-5, and SQLite
-- can't change a CHECK in place, so new ratings go into `stars`; old ones are copied over.
ALTER TABLE food_spots ADD COLUMN stars REAL CHECK (stars IS NULL OR (stars BETWEEN 0.5 AND 5 AND stars * 2 = CAST(stars * 2 AS INTEGER)));
UPDATE food_spots SET stars = rating WHERE stars IS NULL AND rating IS NOT NULL;
