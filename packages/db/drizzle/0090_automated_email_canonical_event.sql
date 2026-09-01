-- migrate:no-transaction
-- Postgres forbids ALTER TYPE ... ADD VALUE inside a transaction block.
ALTER TYPE "canonical_event_type" ADD VALUE 'automated.email.sent';
