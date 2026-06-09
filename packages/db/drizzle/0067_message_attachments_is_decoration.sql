-- is_decoration replaces the role the is_inline column has been playing
-- since PR #386/#472. PRD #502 collapses the three-layer
-- attachment-visibility pipeline into a single classifier that hides
-- only signature-graphic placeholders (image001.png, noname,
-- ATT0001.png, empty filename). Backfill of historical rows + drop of
-- is_inline lands in Brief 2 once the new classifier has been verified
-- against the live data.

ALTER TABLE "message_attachments"
  ADD COLUMN "is_decoration" boolean NOT NULL DEFAULT false;
