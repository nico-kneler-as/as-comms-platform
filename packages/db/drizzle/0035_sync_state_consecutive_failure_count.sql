ALTER TABLE sync_state
  ADD COLUMN consecutive_failure_count integer NOT NULL DEFAULT 0;
