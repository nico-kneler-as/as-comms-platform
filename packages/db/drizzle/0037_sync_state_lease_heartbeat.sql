ALTER TABLE sync_state
  ADD COLUMN lease_owner text,
  ADD COLUMN heartbeat_at timestamptz;
