-- migrate:no-transaction
-- Postgres forbids ALTER TYPE ... ADD VALUE inside a transaction block.
-- The migrator honors this directive and runs the file outside sql.begin().
ALTER TYPE "provider" ADD VALUE IF NOT EXISTS 'twilio';
ALTER TYPE "record_source" ADD VALUE IF NOT EXISTS 'twilio';
