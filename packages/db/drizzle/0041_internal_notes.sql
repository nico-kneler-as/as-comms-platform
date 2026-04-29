CREATE TABLE "internal_notes" (
  "id" text PRIMARY KEY NOT NULL,
  "contact_id" text NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "body" text NOT NULL,
  "author_id" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "internal_notes_contact_id_idx" ON "internal_notes" ("contact_id");
CREATE INDEX "internal_notes_created_at_idx" ON "internal_notes" ("created_at" DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT "mnd"."provider_record_id"
      FROM "manual_note_details" AS "mnd"
      INNER JOIN "canonical_event_ledger" AS "cel"
        ON "cel"."source_evidence_id" = "mnd"."source_evidence_id"
      WHERE "cel"."event_type" = 'note.internal.created'
      GROUP BY "mnd"."provider_record_id"
      HAVING COUNT(*) > 1
    ) AS "duplicate_note_ids"
  ) THEN
    RAISE EXCEPTION '0041_internal_notes backfill aborted: duplicate manual_note_details.provider_record_id rows detected for note.internal.created events.';
  END IF;
END
$$;

DO $$
DECLARE
  "admin_user_id" text;
BEGIN
  SELECT "id"
  INTO "admin_user_id"
  FROM "users"
  WHERE "email" = 'nico@adventurescientists.org'
  LIMIT 1;

  IF "admin_user_id" IS NULL
    AND EXISTS (
      SELECT 1
      FROM "manual_note_details" AS "mnd"
      INNER JOIN "canonical_event_ledger" AS "cel"
        ON "cel"."source_evidence_id" = "mnd"."source_evidence_id"
      WHERE "cel"."event_type" = 'note.internal.created'
        AND "mnd"."author_id" IS NULL
    ) THEN
    RAISE EXCEPTION '0041_internal_notes backfill aborted: seeded admin user nico@adventurescientists.org is required to backfill null manual_note_details.author_id rows.';
  END IF;
END
$$;

WITH "admin_user" AS (
  SELECT "id"
  FROM "users"
  WHERE "email" = 'nico@adventurescientists.org'
  LIMIT 1
)
INSERT INTO "internal_notes" (
  "id",
  "contact_id",
  "body",
  "author_id",
  "created_at",
  "updated_at"
)
SELECT
  "mnd"."provider_record_id" AS "id",
  "cel"."contact_id" AS "contact_id",
  "mnd"."body" AS "body",
  COALESCE("mnd"."author_id", (SELECT "id" FROM "admin_user")) AS "author_id",
  "mnd"."created_at" AS "created_at",
  "mnd"."updated_at" AS "updated_at"
FROM "manual_note_details" AS "mnd"
INNER JOIN "canonical_event_ledger" AS "cel"
  ON "cel"."source_evidence_id" = "mnd"."source_evidence_id"
WHERE "cel"."event_type" = 'note.internal.created';

DELETE FROM "contact_timeline_projection"
WHERE "canonical_event_id" IN (
  SELECT "id"
  FROM "canonical_event_ledger"
  WHERE "event_type" = 'note.internal.created'
);
