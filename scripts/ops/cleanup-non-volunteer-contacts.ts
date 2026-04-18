#!/usr/bin/env tsx
/**
 * cleanup-non-volunteer-contacts
 *
 * Usage:
 *   pnpm ops:cleanup-non-volunteer-contacts
 *   pnpm ops:cleanup-non-volunteer-contacts --confirm
 *
 * Dry-run by default. Prints the Salesforce-anchored contacts that have no
 * expedition memberships plus the dependent rows that would be removed.
 *
 * This script is an ops tool, not part of `apps/web`. The repo boundary rule
 * that restricts direct `@as-comms/db` imports to the Stage 1 composition
 * root only applies to workspace packages under `apps/` and `packages/`.
 */
import {
  closeDatabaseConnection,
  createDatabaseConnection
} from "@as-comms/db";

type ContactSampleRow = {
  readonly id: string;
  readonly display_name: string;
  readonly email: string | null;
  readonly sf_id: string | null;
};

type IdRow = {
  readonly id: string;
};

type CanonicalEventRow = {
  readonly id: string;
  readonly source_evidence_id: string;
};

type ReviewCaseRow = {
  readonly id: string;
  readonly source_evidence_id: string;
};

type CleanupSummary = {
  readonly contactCount: number;
  readonly canonicalEventCount: number;
  readonly inboxProjectionCount: number;
  readonly timelineProjectionCount: number;
  readonly sourceEvidenceCount: number;
  readonly identityReviewCount: number;
  readonly routingReviewCount: number;
};

type SqlRunner = {
  unsafe<T extends readonly object[]>(query: string): Promise<T>;
  begin<T>(callback: (sql: SqlRunner) => Promise<T>): Promise<T>;
};

function chunkValues<TValue>(
  values: readonly TValue[],
  chunkSize: number
): TValue[][] {
  const chunks: TValue[][] = [];

  for (let index = 0; index < values.length; index += 1) {
    if (index % chunkSize === 0) {
      chunks.push(values.slice(index, index + chunkSize));
    }
  }

  return chunks;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right)
  );
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

function printSummary(summary: CleanupSummary): void {
  console.log("Affected rows:");
  console.log(`- contacts: ${summary.contactCount}`);
  console.log(`- canonical_event_ledger: ${summary.canonicalEventCount}`);
  console.log(`- contact_inbox_projection: ${summary.inboxProjectionCount}`);
  console.log(`- contact_timeline_projection: ${summary.timelineProjectionCount}`);
  console.log(`- source_evidence_log: ${summary.sourceEvidenceCount}`);
  console.log(`- identity_resolution_queue: ${summary.identityReviewCount}`);
  console.log(`- routing_review_queue: ${summary.routingReviewCount}`);
}

async function selectIds(
  sql: SqlRunner,
  query: string
): Promise<string[]> {
  const rows = await sql.unsafe<readonly IdRow[]>(query);
  return rows.map((row) => row.id);
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exitCode = 1;
    return;
  }

  const confirm = process.argv.slice(2).includes("--confirm");
  const connection = createDatabaseConnection({ connectionString });
  const sql = connection.sql as unknown as SqlRunner;

  try {
    const targetContacts = await sql.unsafe<readonly ContactSampleRow[]>(`
      select
        c.id,
        c.display_name,
        c.primary_email as email,
        c.salesforce_contact_id as sf_id
      from contacts c
      where c.salesforce_contact_id is not null
        and not exists (
          select 1
          from contact_memberships cm
          where cm.contact_id = c.id
        )
      order by c.id asc
    `);
    const contactIds = targetContacts.map((contact) => contact.id);

    console.log("cleanup-non-volunteer-contacts");
    console.log(`Mode: ${confirm ? "confirm" : "dry-run"}`);
    console.log(
      `Found ${targetContacts.length} Salesforce contacts without expedition memberships.`
    );

    if (targetContacts.length > 0) {
      console.log("Sample contacts (first 10):");
      for (const contact of targetContacts.slice(0, 10)) {
        console.log(
          `- ${JSON.stringify({
            id: contact.id,
            display_name: contact.display_name,
            email: contact.email,
            sf_id: contact.sf_id
          })}`
        );
      }
    }

    if (contactIds.length === 0) {
      console.log("Nothing to clean up.");
      return;
    }

    const contactIdInClause = buildInClause(contactIds);
    const contactIdTextArray = buildTextArray(contactIds);

    const canonicalEvents = await sql.unsafe<readonly CanonicalEventRow[]>(`
      select id, source_evidence_id
      from canonical_event_ledger
      where contact_id in ${contactIdInClause}
    `);
    const canonicalEventIds = canonicalEvents.map((event) => event.id);
    const canonicalSourceEvidenceIds = uniqueStrings(
      canonicalEvents.map((event) => event.source_evidence_id)
    );

    const inboxProjectionIds = await selectIds(
      sql,
      `
        select contact_id as id
        from contact_inbox_projection
        where contact_id in ${contactIdInClause}
      `
    );
    const timelineProjectionIds = await selectIds(
      sql,
      `
        select id
        from contact_timeline_projection
        where contact_id in ${contactIdInClause}
      `
    );

    const sourceEvidenceClause =
      canonicalSourceEvidenceIds.length === 0
        ? ""
        : ` or source_evidence_id in ${buildInClause(canonicalSourceEvidenceIds)}`;

    const identityCases = await sql.unsafe<readonly ReviewCaseRow[]>(`
      select distinct id, source_evidence_id
      from identity_resolution_queue
      where anchored_contact_id in ${contactIdInClause}
         or candidate_contact_ids && ${contactIdTextArray}
         ${sourceEvidenceClause}
    `);
    const identityCaseIds = identityCases.map((record) => record.id);

    const routingCases = await sql.unsafe<readonly ReviewCaseRow[]>(`
      select distinct id, source_evidence_id
      from routing_review_queue
      where contact_id in ${contactIdInClause}
         ${sourceEvidenceClause}
    `);
    const routingCaseIds = routingCases.map((record) => record.id);

    const sourceEvidenceIds = uniqueStrings([
      ...canonicalSourceEvidenceIds,
      ...identityCases.map((record) => record.source_evidence_id),
      ...routingCases.map((record) => record.source_evidence_id)
    ]);

    const summary: CleanupSummary = {
      contactCount: targetContacts.length,
      canonicalEventCount: canonicalEventIds.length,
      inboxProjectionCount: inboxProjectionIds.length,
      timelineProjectionCount: timelineProjectionIds.length,
      sourceEvidenceCount: sourceEvidenceIds.length,
      identityReviewCount: identityCaseIds.length,
      routingReviewCount: routingCaseIds.length
    };

    printSummary(summary);

    if (!confirm) {
      console.log("Dry run complete. Re-run with --confirm to delete these rows.");
      return;
    }

    await sql.begin(async (tx) => {
      for (const ids of chunkValues(inboxProjectionIds, 500)) {
        await tx.unsafe(`
          delete from contact_inbox_projection
          where contact_id in ${buildInClause(ids)}
        `);
      }

      for (const ids of chunkValues(routingCaseIds, 500)) {
        await tx.unsafe(`
          delete from routing_review_queue
          where id in ${buildInClause(ids)}
        `);
      }

      for (const ids of chunkValues(identityCaseIds, 500)) {
        await tx.unsafe(`
          delete from identity_resolution_queue
          where id in ${buildInClause(ids)}
        `);
      }

      for (const ids of chunkValues(canonicalEventIds, 500)) {
        await tx.unsafe(`
          delete from canonical_event_ledger
          where id in ${buildInClause(ids)}
        `);
      }

      for (const ids of chunkValues(sourceEvidenceIds, 500)) {
        await tx.unsafe(`
          delete from source_evidence_log
          where id in ${buildInClause(ids)}
        `);
      }

      for (const ids of chunkValues(contactIds, 500)) {
        await tx.unsafe(`
          delete from contacts
          where id in ${buildInClause(ids)}
        `);
      }
    });

    console.log("Delete complete.");
    printSummary(summary);
  } finally {
    await closeDatabaseConnection(connection);
  }
}

await main();
