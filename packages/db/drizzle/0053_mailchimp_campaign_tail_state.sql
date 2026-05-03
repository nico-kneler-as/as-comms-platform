CREATE TABLE mailchimp_campaign_tail_state (
  campaign_id text PRIMARY KEY,
  audience_id text NOT NULL,
  first_seen_send_time timestamptz NOT NULL,
  last_activity_seen_at timestamptz,
  last_polled_at timestamptz,
  dropped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mailchimp_campaign_tail_state_active_refresh_idx
  ON mailchimp_campaign_tail_state (last_polled_at)
  WHERE dropped_at IS NULL;
