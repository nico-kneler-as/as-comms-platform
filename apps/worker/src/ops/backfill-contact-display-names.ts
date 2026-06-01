#!/usr/bin/env tsx
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  closeDatabaseConnection,
  contacts,
  createDatabaseConnection,
  type Stage1Database,
} from "@as-comms/db";
import { parseHeaderDisplayNameForEmail } from "@as-comms/integrations";
import { and, eq, or, sql } from "drizzle-orm";

import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
  readOptionalStringFlag,
} from "./helpers.js";

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

type SkipReason =
  | "no_header_match"
  | "no_display_name_in_header"
  | "display_name_equals_email_local_part";

interface CandidateContactRow {
  readonly id: string;
  readonly primaryEmail: string;
  readonly displayName: string | null;
}

interface HeaderMatchRow {
  readonly occurredAt: Date;
  readonly fromHeader: string | null;
  readonly toHeader: string | null;
  readonly ccHeader: string | null;
}

export interface BackfillContactDisplayNamesLogEntry {
  readonly action: "dryRun" | "updated" | "skipped";
  readonly contactId: string;
  readonly primaryEmail: string;
  readonly displayName?: string;
  readonly dryRun?: boolean;
  readonly reason?: SkipReason;
}

export interface BackfillContactDisplayNamesResult {
  readonly dryRun: boolean;
  readonly since: string;
  readonly until: string;
  readonly candidates: number;
  readonly updated: number;
  readonly skipped: number;
  readonly truncated: boolean;
  readonly byReason: Readonly<Record<SkipReason, number>>;
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or WORKER_DATABASE_URL is required for Stage 1 ops commands.",
    );
  }

  return connectionString;
}

function parseWindowTimestamp(value: string, flagName: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Flag --${flagName} must be a valid ISO-8601 timestamp.`);
  }

  return parsed.toISOString();
}

function buildDefaultSince(): string {
  return "2024-01-01T00:00:00.000Z";
}

function buildDefaultUntil(): string {
  return new Date().toISOString();
}

function logEntry(
  logger: Logger,
  entry: BackfillContactDisplayNamesLogEntry,
): void {
  logger.log(JSON.stringify(entry));
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 ? null : normalized;
}

function splitHeaderEntries(value: string): string[] {
  return value
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/gu)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseHeaderEntry(value: string): {
  readonly email: string | null;
  readonly displayName: string | null;
} {
  const bracketMatch = /^(.*?)(?:<([^>]+)>)$/u.exec(value);

  if (bracketMatch !== null) {
    const [, rawDisplayName = "", rawEmail = ""] = bracketMatch;
    return {
      email: normalizeEmail(rawEmail),
      displayName: rawDisplayName.trim().length > 0 ? rawDisplayName.trim() : null,
    };
  }

  const emailMatch = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.exec(value);

  if (emailMatch === null) {
    return {
      email: null,
      displayName: null,
    };
  }

  const rawEmail = emailMatch[0];
  const displayName = value.replace(rawEmail, "").trim();

  return {
    email: normalizeEmail(rawEmail),
    displayName: displayName.length > 0 ? displayName : null,
  };
}

function headerMatchClassification(
  header: string | null,
  targetEmail: string,
):
  | { readonly kind: "no_match" }
  | { readonly kind: "missing_display_name" }
  | { readonly kind: "equals_email_or_local_part" }
  | { readonly kind: "display_name"; readonly displayName: string } {
  if (typeof header !== "string" || header.trim().length === 0) {
    return { kind: "no_match" };
  }

  const normalizedTargetEmail = normalizeEmail(targetEmail);

  if (normalizedTargetEmail === null) {
    return { kind: "no_match" };
  }

  for (const entry of splitHeaderEntries(header)) {
    const parsed = parseHeaderEntry(entry);

    if (parsed.email !== normalizedTargetEmail) {
      continue;
    }

    const displayName = parseHeaderDisplayNameForEmail(entry, targetEmail);

    if (displayName !== null) {
      return {
        kind: "display_name",
        displayName,
      };
    }

    if (parsed.displayName === null) {
      return { kind: "missing_display_name" };
    }

    const normalizedDisplayName = parsed.displayName
      .trim()
      .replace(/^"(.*)"$/u, "$1")
      .trim()
      .toLowerCase();
    const localPart =
      normalizedTargetEmail.split("@", 1)[0] ?? normalizedTargetEmail;

    if (
      normalizedDisplayName === normalizedTargetEmail ||
      normalizedDisplayName === localPart
    ) {
      return { kind: "equals_email_or_local_part" };
    }

    return { kind: "missing_display_name" };
  }

  return { kind: "no_match" };
}

async function loadCandidateRows(input: {
  readonly db: Stage1Database;
  readonly limit: number;
}): Promise<{
  readonly candidates: readonly CandidateContactRow[];
  readonly truncated: boolean;
}> {
  const result = await input.db.execute(sql<CandidateContactRow>`
    select
      id,
      primary_email as "primaryEmail",
      display_name as "displayName"
    from contacts
    where primary_email is not null
      and (
        display_name is null
        or lower(btrim(display_name)) = lower(btrim(primary_email))
      )
    order by id asc
    limit ${input.limit + 1}
  `);

  // postgres-js (Railway prod) returns `db.execute(sql\`…\`)` as an Array
  // directly; PGlite (tests) wraps the rows under `{ rows }`. Normalize
  // before reading or `.map` throws "Cannot read properties of undefined".
  const rawRows = Array.isArray(result)
    ? (result as readonly CandidateContactRow[])
    : ((result as { readonly rows?: readonly CandidateContactRow[] }).rows ?? []);
  const rows = rawRows.map((row) => ({
    id: row.id,
    primaryEmail: row.primaryEmail,
    displayName:
      typeof row.displayName === "string" ? row.displayName : null,
  }));

  return {
    candidates: rows.slice(0, input.limit),
    truncated: rows.length > input.limit,
  };
}

async function loadHeaderMatchesForContact(input: {
  readonly db: Stage1Database;
  readonly contactId: string;
  readonly emailPattern: string;
  readonly since: string;
  readonly until: string;
}): Promise<readonly HeaderMatchRow[]> {
  const result = await input.db.execute(sql<HeaderMatchRow>`
    (
      select
        cel.occurred_at as "occurredAt",
        gmd.from_header as "fromHeader",
        gmd.to_header as "toHeader",
        gmd.cc_header as "ccHeader"
      from canonical_event_ledger cel
      inner join source_evidence_log sel
        on sel.id = cel.source_evidence_id
      inner join gmail_message_details gmd
        on gmd.source_evidence_id = cel.source_evidence_id
      where sel.provider = 'gmail'
        and cel.contact_id = ${input.contactId}
        and cel.occurred_at >= ${input.since}
        and cel.occurred_at <= ${input.until}
        and (
          lower(coalesce(gmd.from_header, '')) like ${input.emailPattern}
          or lower(coalesce(gmd.to_header, '')) like ${input.emailPattern}
          or lower(coalesce(gmd.cc_header, '')) like ${input.emailPattern}
        )
    )
    union
    (
      select
        cel.occurred_at as "occurredAt",
        gmd.from_header as "fromHeader",
        gmd.to_header as "toHeader",
        gmd.cc_header as "ccHeader"
      from canonical_event_audience cea
      inner join canonical_event_ledger cel
        on cel.id = cea.canonical_event_id
      inner join source_evidence_log sel
        on sel.id = cel.source_evidence_id
      inner join gmail_message_details gmd
        on gmd.source_evidence_id = cel.source_evidence_id
      where sel.provider = 'gmail'
        and cea.contact_id = ${input.contactId}
        and cel.occurred_at >= ${input.since}
        and cel.occurred_at <= ${input.until}
        and (
          lower(coalesce(gmd.from_header, '')) like ${input.emailPattern}
          or lower(coalesce(gmd.to_header, '')) like ${input.emailPattern}
          or lower(coalesce(gmd.cc_header, '')) like ${input.emailPattern}
        )
    )
    order by "occurredAt" desc
  `);

  // Same Array-vs-{rows} normalization as loadCandidateContacts above.
  const rawRows = Array.isArray(result)
    ? (result as readonly HeaderMatchRow[])
    : ((result as { readonly rows?: readonly HeaderMatchRow[] }).rows ?? []);
  return rawRows.map((row) => ({
    occurredAt: row.occurredAt,
    fromHeader: row.fromHeader,
    toHeader: row.toHeader,
    ccHeader: row.ccHeader,
  }));
}

async function resolveObservedDisplayName(input: {
  readonly db: Stage1Database;
  readonly contactId: string;
  readonly primaryEmail: string;
  readonly since: string;
  readonly until: string;
}):
  Promise<
    | { readonly outcome: "display_name"; readonly displayName: string }
    | { readonly outcome: "skipped"; readonly reason: SkipReason }
  > {
  const matches = await loadHeaderMatchesForContact({
    db: input.db,
    contactId: input.contactId,
    emailPattern: `%${input.primaryEmail.toLowerCase()}%`,
    since: input.since,
    until: input.until,
  });

  if (matches.length === 0) {
    return {
      outcome: "skipped",
      reason: "no_header_match",
    };
  }

  let sawLocalPartEquivalent = false;
  let sawMatchedHeaderWithoutDisplayName = false;

  for (const match of matches) {
    for (const header of [match.fromHeader, match.toHeader, match.ccHeader]) {
      const classification = headerMatchClassification(header, input.primaryEmail);

      if (classification.kind === "display_name") {
        return {
          outcome: "display_name",
          displayName: classification.displayName,
        };
      }

      if (classification.kind === "equals_email_or_local_part") {
        sawLocalPartEquivalent = true;
      }

      if (classification.kind === "missing_display_name") {
        sawMatchedHeaderWithoutDisplayName = true;
      }
    }
  }

  if (sawLocalPartEquivalent) {
    return {
      outcome: "skipped",
      reason: "display_name_equals_email_local_part",
    };
  }

  if (sawMatchedHeaderWithoutDisplayName) {
    return {
      outcome: "skipped",
      reason: "no_display_name_in_header",
    };
  }

  return {
    outcome: "skipped",
    reason: "no_header_match",
  };
}

async function updateContactDisplayName(input: {
  readonly db: Stage1Database;
  readonly contactId: string;
  readonly displayName: string;
}): Promise<void> {
  await input.db
    .update(contacts)
    .set({
      displayName: input.displayName,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(contacts.id, input.contactId),
        or(
          sql`${contacts.displayName} is null`,
          sql`lower(btrim(${contacts.displayName})) = lower(btrim(${contacts.primaryEmail}))`,
        ),
      ),
    );
}

export async function backfillContactDisplayNames(input: {
  readonly db: Stage1Database;
  readonly since: string;
  readonly until: string;
  readonly execute: boolean;
  readonly limit: number;
  readonly logger?: Logger;
}): Promise<BackfillContactDisplayNamesResult> {
  const logger = input.logger ?? console;
  const { candidates, truncated } = await loadCandidateRows({
    db: input.db,
    limit: input.limit,
  });
  const byReason: Record<SkipReason, number> = {
    no_header_match: 0,
    no_display_name_in_header: 0,
    display_name_equals_email_local_part: 0,
  };
  let updated = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const resolution = await resolveObservedDisplayName({
      db: input.db,
      contactId: candidate.id,
      primaryEmail: candidate.primaryEmail,
      since: input.since,
      until: input.until,
    });

    if (resolution.outcome === "skipped") {
      skipped += 1;
      byReason[resolution.reason] += 1;
      logEntry(logger, {
        action: "skipped",
        contactId: candidate.id,
        primaryEmail: candidate.primaryEmail,
        reason: resolution.reason,
      });
      continue;
    }

    if (input.execute) {
      await updateContactDisplayName({
        db: input.db,
        contactId: candidate.id,
        displayName: resolution.displayName,
      });
    }

    updated += 1;
    logEntry(logger, {
      action: input.execute ? "updated" : "dryRun",
      contactId: candidate.id,
      primaryEmail: candidate.primaryEmail,
      displayName: resolution.displayName,
      dryRun: !input.execute,
    });
  }

  return {
    dryRun: !input.execute,
    since: input.since,
    until: input.until,
    candidates: candidates.length,
    updated,
    skipped,
    truncated,
    byReason,
  };
}

export async function runBackfillContactDisplayNamesCommand(
  args: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  logger: Logger = console,
): Promise<void> {
  const flags = parseCliFlags(args);
  const since = parseWindowTimestamp(
    readOptionalStringFlag(flags, "since") ?? buildDefaultSince(),
    "since",
  );
  const until = parseWindowTimestamp(
    readOptionalStringFlag(flags, "until") ?? buildDefaultUntil(),
    "until",
  );
  const execute = readOptionalBooleanFlag(flags, "execute", false);
  const limit = readOptionalIntegerFlag(flags, "limit", 5000);

  if (new Date(since).getTime() > new Date(until).getTime()) {
    throw new Error("Flag --since must be earlier than or equal to --until.");
  }

  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    const result = await backfillContactDisplayNames({
      db: connection.db,
      since,
      until,
      execute,
      limit,
      logger,
    });

    logger.log(JSON.stringify(result, null, 2));
  } finally {
    await closeDatabaseConnection(connection);
  }
}

async function main(): Promise<void> {
  await runBackfillContactDisplayNamesCommand();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error: unknown) => {
    if (error instanceof Error) {
      console.error("Contact display-name backfill failed.");
      console.error("message:", error.message);
      const errAny = error as unknown as Record<string, unknown>;
      for (const key of [
        "name",
        "code",
        "severity",
        "detail",
        "hint",
        "where",
        "table",
        "column",
        "constraint",
      ]) {
        if (errAny[key] !== undefined) {
          console.error(`${key}:`, errAny[key]);
        }
      }
      if (error.cause !== undefined) {
        console.error("cause:", error.cause);
      }
    } else {
      console.error("Contact display-name backfill failed:", error);
    }
    process.exitCode = 1;
  });
}
