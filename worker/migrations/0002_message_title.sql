-- Adds an optional topic to each message (shown in the message board's contents page).
-- Run once on databases created before this column existed:
--   npx wrangler d1 execute luludeng-messages --remote --file=worker/migrations/0002_message_title.sql --config=worker/wrangler.toml
ALTER TABLE messages ADD COLUMN title TEXT CHECK (title IS NULL OR length(title) <= 30);
