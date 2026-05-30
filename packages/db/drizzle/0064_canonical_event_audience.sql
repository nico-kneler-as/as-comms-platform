-- canonical_event_audience: junction table mapping each canonical event to every
-- contact who should see it on their timeline. See PRD #482.
--
-- One row per (canonical event × audience contact). The primary key prevents
-- duplicates. Replay is idempotent: re-deriving the audience from a canonical
-- event produces the same rows.
--
-- This table is additive — contact_timeline_projection stays 1-to-1 with
-- canonical events (its canonical_event_id unique invariant is preserved).
-- Contact-page reads will UNION anchor projection rows with audience rows
-- (a later brick).
--
-- This brick only creates the table. Writers and readers land in subsequent
-- bricks of the fan-out PRD.

CREATE TABLE "canonical_event_audience" (
  "canonical_event_id" text NOT NULL REFERENCES "canonical_event_ledger" ("id") ON DELETE CASCADE,
  "contact_id" text NOT NULL REFERENCES "contacts" ("id") ON DELETE CASCADE,
  "participant_role" text NOT NULL,
  "normalized_email" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "canonical_event_audience_pkey"
    PRIMARY KEY ("canonical_event_id", "contact_id"),
  CONSTRAINT "canonical_event_audience_role_check"
    CHECK ("participant_role" IN ('sender', 'direct_recipient', 'cc', 'bcc'))
);

-- Contact-direction index for the per-contact-page timeline read path
-- (a later brick will UNION-join through this).
CREATE INDEX "canonical_event_audience_contact_idx"
  ON "canonical_event_audience" ("contact_id", "canonical_event_id");
