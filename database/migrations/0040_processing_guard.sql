-- Persistent, revision-scoped protection against analysis/extraction handoff loops.
ALTER TABLE articles
  ADD COLUMN processing_guard_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN processing_handoffs integer NOT NULL DEFAULT 0,
  ADD COLUMN processing_no_progress_handoffs integer NOT NULL DEFAULT 0,
  ADD COLUMN processing_failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN processing_progress_key text NOT NULL DEFAULT '',
  ADD COLUMN processing_progress_at timestamptz,
  ADD COLUMN processing_stage text,
  ADD COLUMN processing_paused_at timestamptz,
  ADD COLUMN processing_pause_reason text;

ALTER TABLE articles DROP CONSTRAINT articles_processing_state_check;
ALTER TABLE articles ADD CONSTRAINT articles_processing_state_check
  CHECK (processing_state IN ('new', 'analyzed', 'skipped', 'failed', 'blocked', 'paused'));
CREATE INDEX articles_processing_paused_idx ON articles (processing_paused_at DESC)
  WHERE processing_state = 'paused';
