INSERT INTO "integration_health" (
  "id",
  "service_name",
  "category",
  "status"
) VALUES
  ('salesforce', 'salesforce', 'crm', 'not_checked'),
  ('gmail', 'gmail', 'messaging', 'not_checked'),
  ('simpletexting', 'simpletexting', 'messaging', 'not_configured'),
  ('mailchimp', 'mailchimp', 'messaging', 'not_configured'),
  ('notion', 'notion', 'knowledge', 'not_configured'),
  ('openai', 'openai', 'ai', 'not_configured')
ON CONFLICT ("id") DO NOTHING;
