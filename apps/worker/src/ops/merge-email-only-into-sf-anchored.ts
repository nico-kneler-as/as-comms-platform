#!/usr/bin/env tsx
import process from "node:process";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  type Stage1Database,
} from "@as-comms/db";
import { sql as drizzleSql } from "drizzle-orm";

import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
} from "./helpers.js";

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

interface SqlRunner {
  unsafe<T extends readonly object[]>(query: string): Promise<T>;
}

interface IdRow {
  readonly id: string;
}

interface DupePairRow {
  readonly email_only_id: string;
  readonly primary_email: string;
  readonly sf_anchored_id: string;
}

interface MergeDupePair {
  readonly emailOnlyId: string;
  readonly sfAnchoredId: string;
  readonly primaryEmail: string;
}

interface MergePlan {
  readonly pair: MergeDupePair;
  readonly canonicalEventIds: readonly string[];
  readonly timelineRowIds: readonly string[];
  readonly noteIds: readonly string[];
  readonly routingRowIds: readonly string[];
  readonly identityCaseIds: readonly string[];
  readonly inboxProjectionContactIds: readonly string[];
}

interface MergeExecutionResult {
  readonly canonicalEventsRepointed: number;
  readonly timelineRowsRepointed: number;
  readonly notesRepointed: number;
  readonly routingRepointed: number;
  readonly identityCasesResolved: number;
  readonly contactsDeleted: number;
}

interface MergeSummary {
  readonly pairsProcessed: number;
  readonly pairsSkippedOnError: number;
  readonly canonicalEventsRepointed: number;
  readonly timelineRowsRepointed: number;
  readonly notesRepointed: number;
  readonly routingRepointed: number;
  readonly identityCasesResolved: number;
  readonly contactsDeleted: number;
  readonly errors: readonly {
    readonly emailOnlyId: string;
    readonly sfAnchoredId: string;
    readonly message: string;
  }[];
}

class DryRunRollback extends Error {
  constructor() {
    super("Dry run rollback");
  }
}

function chunkValues<TValue>(
  values: readonly TValue[],
  chunkSize: number,
): TValue[][] {
  const chunks: TValue[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function buildInClause(values: readonly string[]): string {
  return `(${values.map((value) => quoteSqlLiteral(value)).join(", ")})`;
}

function buildTextArray(values: readonly string[]): string {
  return `array[${values.map((value) => quoteSqlLiteral(value)).join(", ")}]::text[]`;
}

function normalizeQueryRows(result: unknown): readonly object[] {
  if (Array.isArray(result)) {
    return result as readonly object[];
  }

  return (result as { readonly rows: readonly object[] }).rows;
}

function createDbSqlRunner(db: Stage1Database): SqlRunner {
  return {
    async unsafe<T extends readonly object[]>(query: string): Promise<T> {
      const result = await db.execute(drizzleSql.raw(query));
      return normalizeQueryRows(result) as unknown as T;
    },
  };
}

function buildResolutionExplanation(pair: MergeDupePair): string {
  return `merged duplicate contact ${pair.emailOnlyId} into ${pair.sfAnchoredId} (architect cleanup 2026-05-02)`;
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const value =
    env.WORKER_DATABASE_URL ?? env.DATABASE_URL ?? env.DATABASE_PUBLIC_URL;

  if (value === undefined || value.trim().length === 0) {
    throw new Error(
      "DATABASE_PUBLIC_URL, DATABASE_URL, or WORKER_DATABASE_URL is required for this ops command.",
    );
  }

  return value.trim();
}

async function selectIds(sql: SqlRunner, query: string): Promise<string[]> {
  const rows = await sql.unsafe<readonly IdRow[]>(query);
  return rows.map((row) => row.id);
}

export async function loadDupePairs(
  sql: SqlRunner,
): Promise<readonly MergeDupePair[]> {
  const rows = await sql.unsafe<readonly DupePairRow[]>(`
    select
      eo.id as email_only_id,
      eo.primary_email,
      sf.id as sf_anchored_id
    from contacts eo
    join contacts sf
      on sf.primary_email = eo.primary_email
     and sf.id like 'contact:salesforce:%'
    where eo.id like 'contact:email:%'
      and eo.primary_email is not null
    order by eo.id
  `);

  return rows.map((row) => ({
    emailOnlyId: row.email_only_id,
    sfAnchoredId: row.sf_anchored_id,
    primaryEmail: row.primary_email,
  }));
}

export async function planMergeForPair(input: {
  readonly pair: MergeDupePair;
  readonly sql: SqlRunner;
}): Promise<MergePlan> {
  const emailOnlyId = quoteSqlLiteral(input.pair.emailOnlyId);
  const emailOnlyInClause = buildInClause([input.pair.emailOnlyId]);
  const emailOnlyArray = buildTextArray([input.pair.emailOnlyId]);

  const [canonicalEventIds, timelineRowIds, noteIds, routingRowIds, identityCaseIds] =
    await Promise.all([
      selectIds(
        input.sql,
        `
          select id
          from canonical_event_ledger
          where contact_id in ${emailOnlyInClause}
          order by id
        `,
      ),
      selectIds(
        input.sql,
        `
          select id
          from contact_timeline_projection
          where contact_id in ${emailOnlyInClause}
          order by id
        `,
      ),
      selectIds(
        input.sql,
        `
          select id
          from internal_notes
          where contact_id in ${emailOnlyInClause}
          order by id
        `,
      ),
      selectIds(
        input.sql,
        `
          select id
          from routing_review_queue
          where contact_id in ${emailOnlyInClause}
          order by id
        `,
      ),
      selectIds(
        input.sql,
        `
          select id
          from identity_resolution_queue
          where anchored_contact_id = ${emailOnlyId}
             or candidate_contact_ids && ${emailOnlyArray}
          order by id
        `,
      ),
    ]);

  const inboxProjectionContactIds = await selectIds(
    input.sql,
    `
      select contact_id as id
      from contact_inbox_projection
      where contact_id in ${emailOnlyInClause}
    `,
  );

  return {
    pair: input.pair,
    canonicalEventIds,
    timelineRowIds,
    noteIds,
    routingRowIds,
    identityCaseIds,
    inboxProjectionContactIds,
  };
}

function createEmptySummary(): MergeSummary {
  return {
    pairsProcessed: 0,
    pairsSkippedOnError: 0,
    canonicalEventsRepointed: 0,
    timelineRowsRepointed: 0,
    notesRepointed: 0,
    routingRepointed: 0,
    identityCasesResolved: 0,
    contactsDeleted: 0,
    errors: [],
  };
}

function addPairSuccess(
  summary: MergeSummary,
  result: MergeExecutionResult,
): MergeSummary {
  return {
    ...summary,
    pairsProcessed: summary.pairsProcessed + 1,
    canonicalEventsRepointed:
      summary.canonicalEventsRepointed + result.canonicalEventsRepointed,
    timelineRowsRepointed:
      summary.timelineRowsRepointed + result.timelineRowsRepointed,
    notesRepointed: summary.notesRepointed + result.notesRepointed,
    routingRepointed: summary.routingRepointed + result.routingRepointed,
    identityCasesResolved:
      summary.identityCasesResolved + result.identityCasesResolved,
    contactsDeleted: summary.contactsDeleted + result.contactsDeleted,
  };
}

function addPairError(
  summary: MergeSummary,
  input: {
    readonly pair: MergeDupePair;
    readonly error: Error;
  },
): MergeSummary {
  return {
    ...summary,
    pairsSkippedOnError: summary.pairsSkippedOnError + 1,
    errors: [
      ...summary.errors,
      {
        emailOnlyId: input.pair.emailOnlyId,
        sfAnchoredId: input.pair.sfAnchoredId,
        message: input.error.message,
      },
    ],
  };
}

function buildPlanResult(plan: MergePlan): MergeExecutionResult {
  return {
    canonicalEventsRepointed: plan.canonicalEventIds.length,
    timelineRowsRepointed: plan.timelineRowIds.length,
    notesRepointed: plan.noteIds.length,
    routingRepointed: plan.routingRowIds.length,
    identityCasesResolved: plan.identityCaseIds.length,
    contactsDeleted: 1,
  };
}

async function updateRowsAndReturnIds(
  sql: SqlRunner,
  query: string,
): Promise<string[]> {
  const rows = await sql.unsafe<readonly IdRow[]>(query);
  return rows.map((row) => row.id);
}

export async function applyMergeForPair(input: {
  readonly db: Stage1Database;
  readonly pair: MergeDupePair;
  readonly plan: MergePlan;
  readonly dryRun: boolean;
}): Promise<MergeExecutionResult> {
  const resolutionExplanation = buildResolutionExplanation(input.pair);
  const emailOnlyId = quoteSqlLiteral(input.pair.emailOnlyId);
  const sfAnchoredId = quoteSqlLiteral(input.pair.sfAnchoredId);
  const emailOnlyArray = buildTextArray([input.pair.emailOnlyId]);
  const explanationLiteral = quoteSqlLiteral(resolutionExplanation);

  const runInTransaction = async (tx: Stage1Database) => {
    const sql = createDbSqlRunner(tx);
    const canonicalEventIds = await updateRowsAndReturnIds(
      sql,
      `
        update canonical_event_ledger
        set
          contact_id = ${sfAnchoredId},
          updated_at = timezone('utc', now())
        where contact_id = ${emailOnlyId}
        returning id
      `,
    );
    const timelineRowIds = await updateRowsAndReturnIds(
      sql,
      `
        update contact_timeline_projection
        set
          contact_id = ${sfAnchoredId},
          updated_at = timezone('utc', now())
        where contact_id = ${emailOnlyId}
        returning id
      `,
    );
    const noteIds = await updateRowsAndReturnIds(
      sql,
      `
        update internal_notes
        set
          contact_id = ${sfAnchoredId},
          updated_at = timezone('utc', now())
        where contact_id = ${emailOnlyId}
        returning id
      `,
    );
    const routingRowIds = await updateRowsAndReturnIds(
      sql,
      `
        update routing_review_queue
        set
          contact_id = ${sfAnchoredId},
          updated_at = timezone('utc', now())
        where contact_id = ${emailOnlyId}
        returning id
      `,
    );
    const identityCaseIds = await updateRowsAndReturnIds(
      sql,
      `
        update identity_resolution_queue
        set
          anchored_contact_id = case
            when anchored_contact_id = ${emailOnlyId} then ${sfAnchoredId}
            else anchored_contact_id
          end,
          candidate_contact_ids = (
            select coalesce(
              array_agg(candidate_id order by candidate_id),
              array[]::text[]
            )
            from (
              select distinct candidate_id
              from unnest(
                case
                  when candidate_contact_ids && ${emailOnlyArray}
                    then array_replace(
                      candidate_contact_ids,
                      ${emailOnlyId},
                      ${sfAnchoredId}
                    )
                  else candidate_contact_ids
                end
              ) as candidate_id
              where candidate_id <> ${emailOnlyId}
            ) deduped_candidates
          ),
          status = 'resolved',
          resolved_at = coalesce(resolved_at, timezone('utc', now())),
          explanation = case
            when position(${explanationLiteral} in explanation) > 0 then explanation
            else explanation || ' ' || ${explanationLiteral}
          end,
          updated_at = timezone('utc', now())
        where anchored_contact_id = ${emailOnlyId}
           or candidate_contact_ids && ${emailOnlyArray}
        returning id
      `,
    );
    const deletedContactIds = await updateRowsAndReturnIds(
      sql,
      `
        delete from contacts
        where id = ${emailOnlyId}
        returning id
      `,
    );

    if (deletedContactIds.length !== 1) {
      throw new Error(
        `Expected to delete exactly one contact for ${input.pair.emailOnlyId}; deleted ${deletedContactIds.length.toString()}.`,
      );
    }

    if (input.dryRun) {
      throw new DryRunRollback();
    }

    return {
      canonicalEventsRepointed: canonicalEventIds.length,
      timelineRowsRepointed: timelineRowIds.length,
      notesRepointed: noteIds.length,
      routingRepointed: routingRowIds.length,
      identityCasesResolved: identityCaseIds.length,
      contactsDeleted: deletedContactIds.length,
    };
  };

  if (input.dryRun) {
    try {
      await input.db.transaction(runInTransaction);
    } catch (error) {
      if (!(error instanceof DryRunRollback)) {
        throw error;
      }
    }

    return buildPlanResult(input.plan);
  }

  return input.db.transaction(runInTransaction);
}

function printPlanHeader(input: {
  readonly logger: Logger;
  readonly dryRun: boolean;
  readonly pairs: readonly MergeDupePair[];
}): void {
  input.logger.log("merge-email-only-into-sf-anchored");
  input.logger.log(`Mode: ${input.dryRun ? "dry-run" : "execute"}`);
  input.logger.log(
    `Found ${input.pairs.length.toString()} email-only / Salesforce-anchored dupe pairs.`,
  );
}

function printPairAudit(input: {
  readonly logger: Logger;
  readonly dryRun: boolean;
  readonly plan: MergePlan;
  readonly status: "planned" | "applied" | "error";
  readonly errorMessage?: string;
}): void {
  input.logger.log(
    JSON.stringify({
      event: "merge_email_only_into_sf_anchored.pair",
      dryRun: input.dryRun,
      status: input.status,
      emailOnlyId: input.plan.pair.emailOnlyId,
      sfAnchoredId: input.plan.pair.sfAnchoredId,
      primaryEmail: input.plan.pair.primaryEmail,
      canonicalEventIds: input.plan.canonicalEventIds,
      timelineRowIds: input.plan.timelineRowIds,
      noteIds: input.plan.noteIds,
      routingRowIds: input.plan.routingRowIds,
      identityCaseIds: input.plan.identityCaseIds,
      inboxProjectionContactIds: input.plan.inboxProjectionContactIds,
      counts: {
        canonicalEvents: input.plan.canonicalEventIds.length,
        timelineRows: input.plan.timelineRowIds.length,
        notes: input.plan.noteIds.length,
        routingRows: input.plan.routingRowIds.length,
        identityCases: input.plan.identityCaseIds.length,
        inboxRows: input.plan.inboxProjectionContactIds.length,
      },
      ...(input.errorMessage === undefined
        ? {}
        : {
            error: input.errorMessage,
          }),
    }),
  );
}

function printSummary(input: {
  readonly logger: Logger;
  readonly dryRun: boolean;
  readonly summary: MergeSummary;
}): void {
  input.logger.log(
    JSON.stringify({
      event: "merge_email_only_into_sf_anchored.completed",
      dryRun: input.dryRun,
      pairsProcessed: input.summary.pairsProcessed,
      pairsSkippedOnError: input.summary.pairsSkippedOnError,
      canonicalEventsRepointed: input.summary.canonicalEventsRepointed,
      timelineRowsRepointed: input.summary.timelineRowsRepointed,
      notesRepointed: input.summary.notesRepointed,
      routingRepointed: input.summary.routingRepointed,
      identityCasesResolved: input.summary.identityCasesResolved,
      contactsDeleted: input.summary.contactsDeleted,
      errors: input.summary.errors,
    }),
  );
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  logger: Logger = console,
): Promise<void> {
  const flags = parseCliFlags(args);
  const dryRun = !readOptionalBooleanFlag(flags, "execute", false);
  const limit = readOptionalIntegerFlag(flags, "limit", 0);
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    const sql = connection.sql as unknown as SqlRunner;
    const allPairs = await loadDupePairs(sql);
    const pairs =
      limit === 0 ? allPairs : allPairs.slice(0, Math.min(limit, allPairs.length));
    let summary = createEmptySummary();

    printPlanHeader({
      logger,
      dryRun,
      pairs,
    });

    if (pairs.length === 0) {
      printSummary({
        logger,
        dryRun,
        summary,
      });
      return;
    }

    for (const pairChunk of chunkValues(pairs, 1)) {
      const pair = pairChunk[0];

      if (pair === undefined) {
        continue;
      }

      try {
        const plan = await planMergeForPair({
          pair,
          sql,
        });
        const result = await applyMergeForPair({
          db: connection.db,
          pair,
          plan,
          dryRun,
        });

        printPairAudit({
          logger,
          dryRun,
          plan,
          status: dryRun ? "planned" : "applied",
        });
        summary = addPairSuccess(summary, result);
      } catch (error) {
        const resolvedError =
          error instanceof Error ? error : new Error(String(error));
        const plan = {
          pair,
          canonicalEventIds: [],
          timelineRowIds: [],
          noteIds: [],
          routingRowIds: [],
          identityCaseIds: [],
          inboxProjectionContactIds: [],
        } satisfies MergePlan;

        printPairAudit({
          logger,
          dryRun,
          plan,
          status: "error",
          errorMessage: resolvedError.message,
        });
        logger.error(
          `Failed merging ${pair.emailOnlyId} into ${pair.sfAnchoredId}: ${resolvedError.message}`,
        );
        summary = addPairError(summary, {
          pair,
          error: resolvedError,
        });
      }
    }

    printSummary({
      logger,
      dryRun,
      summary,
    });
  } finally {
    await closeDatabaseConnection(connection);
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : "merge-email-only-into-sf-anchored failed.",
  );
  process.exitCode = 1;
});
