-- Brief A2 adds Postmark as a source-evidence and record-source provider.
-- Both postgres ENUM types need the new value before any inserts succeed.

ALTER TYPE "provider" ADD VALUE IF NOT EXISTS 'postmark';
ALTER TYPE "record_source" ADD VALUE IF NOT EXISTS 'postmark';
