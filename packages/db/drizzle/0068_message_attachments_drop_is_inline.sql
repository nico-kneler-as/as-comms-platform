-- Drops the is_inline column now that PRD #502 / PR #503 introduced
-- is_decoration as the single attachment-visibility flag, and Brief 2's
-- ops:recompute-attachment-decoration op has backfilled is_decoration
-- for all historical rows. The migrator sentinel flips to
-- message_attachments.id in the same change (see migrator.ts) so that
-- future schema evolution doesn't depend on this column existing.

ALTER TABLE "message_attachments"
  DROP COLUMN "is_inline";
