CREATE INDEX IF NOT EXISTS mailchimp_campaign_activity_details_campaign_type_idx
  ON mailchimp_campaign_activity_details (campaign_id, activity_type);
