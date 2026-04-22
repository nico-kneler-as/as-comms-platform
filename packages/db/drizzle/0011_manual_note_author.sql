ALTER TABLE "manual_note_details" ADD COLUMN "author_id" text REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX "manual_note_details_author_idx" ON "manual_note_details" ("author_id");
