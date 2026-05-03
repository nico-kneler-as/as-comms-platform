CREATE UNIQUE INDEX contacts_primary_phone_unique
  ON contacts (primary_phone) WHERE primary_phone IS NOT NULL;
