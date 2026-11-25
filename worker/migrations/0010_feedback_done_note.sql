-- 需求反馈: marking an item done now records a short summary of what was actually done (up to 200 characters).
ALTER TABLE feedback_items ADD COLUMN done_note TEXT CHECK (done_note IS NULL OR length(done_note) <= 200);
