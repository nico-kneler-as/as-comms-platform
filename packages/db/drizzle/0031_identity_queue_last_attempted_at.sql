ALTER TABLE identity_resolution_queue
  ADD COLUMN last_attempted_at timestamptz;

CREATE INDEX identity_resolution_queue_last_attempted_idx
  ON identity_resolution_queue (last_attempted_at NULLS FIRST, opened_at ASC)
  WHERE status = 'open';
