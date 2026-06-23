CREATE OR REPLACE FUNCTION "normalize_phone_e164_for_migration"("input" text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits text;
BEGIN
  IF "input" IS NULL OR BTRIM("input") = '' THEN
    RETURN NULL;
  END IF;

  IF "input" ~ '^\+[1-9][0-9]{7,14}$' THEN
    RETURN "input";
  END IF;

  digits := regexp_replace("input", '\D', '', 'g');

  IF digits = '' THEN
    RETURN NULL;
  END IF;

  IF length(digits) = 10 AND digits ~ '^[2-9][0-9]{9}$' THEN
    RETURN '+1' || digits;
  END IF;

  IF length(digits) = 11 AND digits ~ '^1[2-9][0-9]{9}$' THEN
    RETURN '+' || digits;
  END IF;

  RETURN NULL;
END;
$$;

DO $$
DECLARE
  contacts_updated_count integer := 0;
  contacts_invalid_count integer := 0;
  identity_updated_count integer := 0;
  identity_merged_count integer := 0;
  identity_invalid_count integer := 0;
  consent_updated_count integer := 0;
  consent_invalid_count integer := 0;
BEGIN
  SELECT count(*)
    INTO contacts_invalid_count
    FROM "contacts"
    WHERE "primary_phone" IS NOT NULL
      AND "primary_phone" NOT LIKE '+%'
      AND "normalize_phone_e164_for_migration"("primary_phone") IS NULL;

  WITH updated AS (
    UPDATE "contacts"
      SET
        "primary_phone" = "normalize_phone_e164_for_migration"("primary_phone"),
        "updated_at" = timezone('utc', now())
      WHERE "primary_phone" IS NOT NULL
        AND "normalize_phone_e164_for_migration"("primary_phone") IS NOT NULL
        AND "primary_phone" <> "normalize_phone_e164_for_migration"("primary_phone")
      RETURNING 1
  )
  SELECT count(*) INTO contacts_updated_count FROM updated;

  SELECT count(*)
    INTO identity_invalid_count
    FROM "contact_identities"
    WHERE "kind" = 'phone'
      AND "normalize_phone_e164_for_migration"("normalized_value") IS NULL;

  WITH normalized AS (
    SELECT
      ci."id",
      ci."contact_id",
      ci."is_primary",
      ci."created_at",
      "normalize_phone_e164_for_migration"(ci."normalized_value") AS canonical_value
    FROM "contact_identities" ci
    WHERE ci."kind" = 'phone'
  ),
  duplicates AS (
    SELECT ranked."id"
    FROM (
      SELECT
        normalized."id",
        row_number() OVER (
          PARTITION BY normalized."contact_id", normalized."canonical_value"
          ORDER BY normalized."is_primary" DESC, normalized."created_at" ASC, normalized."id" ASC
        ) AS row_num
      FROM normalized
      WHERE normalized."canonical_value" IS NOT NULL
    ) ranked
    WHERE ranked."row_num" > 1
  ),
  deleted AS (
    DELETE FROM "contact_identities"
    WHERE "id" IN (SELECT "id" FROM duplicates)
    RETURNING 1
  )
  SELECT count(*) INTO identity_merged_count FROM deleted;

  WITH normalized AS (
    SELECT
      ci."id",
      "normalize_phone_e164_for_migration"(ci."normalized_value") AS canonical_value
    FROM "contact_identities" ci
    WHERE ci."kind" = 'phone'
  ),
  updated AS (
    UPDATE "contact_identities" ci
      SET
        "normalized_value" = normalized."canonical_value",
        "updated_at" = timezone('utc', now())
      FROM normalized
      WHERE ci."id" = normalized."id"
        AND normalized."canonical_value" IS NOT NULL
        AND ci."normalized_value" <> normalized."canonical_value"
      RETURNING 1
  )
  SELECT count(*) INTO identity_updated_count FROM updated;

  SELECT count(*)
    INTO consent_invalid_count
    FROM "consent_records"
    WHERE "normalize_phone_e164_for_migration"("phone_e164") IS NULL;

  WITH updated AS (
    UPDATE "consent_records"
      SET
        "phone_e164" = "normalize_phone_e164_for_migration"("phone_e164"),
        "updated_at" = timezone('utc', now())
      WHERE "normalize_phone_e164_for_migration"("phone_e164") IS NOT NULL
        AND "phone_e164" <> "normalize_phone_e164_for_migration"("phone_e164")
      RETURNING 1
  )
  SELECT count(*) INTO consent_updated_count FROM updated;

  RAISE NOTICE 'phone_e164_normalization summary: contacts_updated=%, contacts_invalid_skipped=%, contact_identities_updated=%, contact_identities_merged=%, contact_identities_invalid_skipped=%, consent_records_updated=%, consent_records_invalid_skipped=%',
    contacts_updated_count,
    contacts_invalid_count,
    identity_updated_count,
    identity_merged_count,
    identity_invalid_count,
    consent_updated_count,
    consent_invalid_count;
END;
$$;

DROP FUNCTION "normalize_phone_e164_for_migration"(text);
