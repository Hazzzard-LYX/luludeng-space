-- One-decimal scores (0.1-5.0, e.g. 4.3). `stars` only allows half steps and SQLite can't change a
-- CHECK in place, so scores go into a new `score` column; existing ratings are copied over.
ALTER TABLE food_spots ADD COLUMN score REAL CHECK (score IS NULL OR (score BETWEEN 0.1 AND 5 AND abs(score * 10 - round(score * 10)) < 0.000001));
UPDATE food_spots SET score = COALESCE(stars, rating) WHERE score IS NULL AND COALESCE(stars, rating) IS NOT NULL;
