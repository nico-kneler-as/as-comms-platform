#!/usr/bin/env tsx
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  like,
  ne,
  or,
  sql,
} from "drizzle-orm";

import {
  canonicalEventLedger,
  closeDatabaseConnection,
  contactIdentities,
  contacts,
  createDatabaseConnection,
  gmailMessageDetails,
  projectAliases,
  type Stage1Database,
} from "@as-comms/db";

import { parseCliFlags, readRequiredFlag } from "./helpers.js";

type SuggestedDirection =
  | "inbound"
  | "outbound"
  | "unknown"
  | "no_signal"
  | "excluded";
type Confidence = "high" | "medium" | "low";

interface Logger {
  info(message: string): void;
  error(message: string): void;
}

interface CandidateRow {
  readonly canonicalEventId: string;
  readonly contactId: string;
  readonly contactDisplayName: string;
  readonly capturedMailbox: string;
  readonly currentDirection: string;
  readonly occurredAt: string;
  readonly subject: string | null;
  readonly bodyTextPreview: string;
  readonly snippetClean: string;
}

interface TeamDirectory {
  readonly projectAliases: readonly string[];
  readonly teamEmails: readonly string[];
  readonly teamNameVariants: ReadonlySet<string>;
}

export interface DirectionReportRow {
  readonly canonicalEventId: string;
  readonly contactId: string;
  readonly contactDisplayName: string;
  readonly capturedMailbox: string;
  readonly currentDirection: string;
  readonly suggestedDirection: SuggestedDirection;
  readonly confidence: Confidence;
  readonly signalsMatched: readonly string[];
  readonly occurredAt: string;
  readonly subject: string;
  readonly bodyFirst120Chars: string;
}

export interface DetectionSummary {
  readonly candidateRows: number;
  readonly suggestedOutboundHigh: number;
  readonly suggestedInboundHigh: number;
  readonly suggestedOutboundMedium: number;
  readonly suggestedUnknownLow: number;
  readonly noSignal: number;
  readonly campaignAutomatedExcluded: number;
}

export interface DetectionReport {
  readonly outputPath: string;
  readonly summary: DetectionSummary;
  readonly rows: readonly DirectionReportRow[];
}

const SIGNATURE_REGION_LENGTH = 400;
const BODY_PREVIEW_LENGTH = 120;
const GREETING_SCAN_LENGTH = 30;
const CAMPAIGN_MARKERS = [
  "unsubscribe",
  "view in browser",
  "[image:",
  "sent from my iphone",
  "sent from my ipad",
  "manage preferences",
];

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or WORKER_DATABASE_URL is required for Stage 1 ops commands.",
    );
  }

  return connectionString.trim();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function normalizeNameToken(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z\s'-]/gu, "")
    .trim();
}

function buildNameVariants(displayName: string): string[] {
  const normalized = normalizeNameToken(displayName);

  if (normalized.length === 0) {
    return [];
  }

  const variants = new Set<string>([normalized]);
  const parts = normalized.split(/\s+/u).filter((part) => part.length > 0);

  if (parts[0] !== undefined) {
    variants.add(parts[0]);
  }

  return [...variants];
}

function bodyForClassification(candidate: CandidateRow): string {
  const preferred = normalizeWhitespace(candidate.bodyTextPreview);

  if (preferred.length > 0) {
    return preferred;
  }

  return normalizeWhitespace(candidate.snippetClean);
}

function extractGreetingName(body: string): string | null {
  const opening = body.slice(0, GREETING_SCAN_LENGTH);
  const match = /^\s*(?:hey|hi)\s+([a-z][a-z' -]*)/iu.exec(opening);

  if (match?.[1] === undefined) {
    return null;
  }

  return normalizeNameToken(match[1]);
}

function containsCampaignMarker(bodyLower: string): string | null {
  for (const marker of CAMPAIGN_MARKERS) {
    if (bodyLower.includes(marker)) {
      return marker;
    }
  }

  return null;
}

function containsInternalReference(
  bodyLower: string,
  teamEmails: readonly string[],
): string | null {
  if (bodyLower.includes("https://www.adventurescientists.org")) {
    return "internal_url_reference";
  }

  const matchedTeamEmail = teamEmails.find((teamEmail) =>
    bodyLower.includes(teamEmail),
  );

  if (matchedTeamEmail !== undefined) {
    return `internal_email_reference:${matchedTeamEmail}`;
  }

  const genericEmailMatch =
    /\b[a-z0-9._%+-]+@adventurescientists\.org\b/iu.exec(bodyLower);

  if (genericEmailMatch?.[0] !== undefined) {
    return `internal_email_reference:${genericEmailMatch[0].toLowerCase()}`;
  }

  return null;
}

function classifyCandidate(
  candidate: CandidateRow,
  directory: TeamDirectory,
): DirectionReportRow {
  const body = bodyForClassification(candidate);
  const bodyLower = body.toLowerCase();
  const signatureRegion = bodyLower.slice(
    Math.max(0, bodyLower.length - SIGNATURE_REGION_LENGTH),
  );

  for (const teamEmail of directory.teamEmails) {
    if (bodyLower.includes(teamEmail) && signatureRegion.includes(teamEmail)) {
      return {
        canonicalEventId: candidate.canonicalEventId,
        contactId: candidate.contactId,
        contactDisplayName: candidate.contactDisplayName,
        capturedMailbox: candidate.capturedMailbox,
        currentDirection: candidate.currentDirection,
        suggestedDirection: "outbound",
        confidence: "high",
        signalsMatched: [`signature_email:${teamEmail}`],
        occurredAt: candidate.occurredAt,
        subject: candidate.subject ?? "",
        bodyFirst120Chars: body.slice(0, BODY_PREVIEW_LENGTH),
      };
    }
  }

  const greetingName = extractGreetingName(body);
  if (greetingName !== null) {
    const contactVariants = buildNameVariants(candidate.contactDisplayName);

    if (contactVariants.includes(greetingName)) {
      return {
        canonicalEventId: candidate.canonicalEventId,
        contactId: candidate.contactId,
        contactDisplayName: candidate.contactDisplayName,
        capturedMailbox: candidate.capturedMailbox,
        currentDirection: candidate.currentDirection,
        suggestedDirection: "outbound",
        confidence: "high",
        signalsMatched: [`greeting_contact:${greetingName}`],
        occurredAt: candidate.occurredAt,
        subject: candidate.subject ?? "",
        bodyFirst120Chars: body.slice(0, BODY_PREVIEW_LENGTH),
      };
    }

    if (directory.teamNameVariants.has(greetingName)) {
      return {
        canonicalEventId: candidate.canonicalEventId,
        contactId: candidate.contactId,
        contactDisplayName: candidate.contactDisplayName,
        capturedMailbox: candidate.capturedMailbox,
        currentDirection: candidate.currentDirection,
        suggestedDirection: "inbound",
        confidence: "high",
        signalsMatched: [`greeting_team:${greetingName}`],
        occurredAt: candidate.occurredAt,
        subject: candidate.subject ?? "",
        bodyFirst120Chars: body.slice(0, BODY_PREVIEW_LENGTH),
      };
    }
  }

  const internalReference = containsInternalReference(bodyLower, directory.teamEmails);
  if (internalReference !== null) {
    return {
      canonicalEventId: candidate.canonicalEventId,
      contactId: candidate.contactId,
      contactDisplayName: candidate.contactDisplayName,
      capturedMailbox: candidate.capturedMailbox,
      currentDirection: candidate.currentDirection,
      suggestedDirection: "unknown",
      confidence: "low",
      signalsMatched: [internalReference],
      occurredAt: candidate.occurredAt,
      subject: candidate.subject ?? "",
      bodyFirst120Chars: body.slice(0, BODY_PREVIEW_LENGTH),
    };
  }

  const campaignMarker = containsCampaignMarker(bodyLower);
  if (campaignMarker !== null) {
    return {
      canonicalEventId: candidate.canonicalEventId,
      contactId: candidate.contactId,
      contactDisplayName: candidate.contactDisplayName,
      capturedMailbox: candidate.capturedMailbox,
      currentDirection: candidate.currentDirection,
      suggestedDirection: "excluded",
      confidence: "low",
      signalsMatched: [`campaign_marker:${campaignMarker}`],
      occurredAt: candidate.occurredAt,
      subject: candidate.subject ?? "",
      bodyFirst120Chars: body.slice(0, BODY_PREVIEW_LENGTH),
    };
  }

  return {
    canonicalEventId: candidate.canonicalEventId,
    contactId: candidate.contactId,
    contactDisplayName: candidate.contactDisplayName,
    capturedMailbox: candidate.capturedMailbox,
    currentDirection: candidate.currentDirection,
    suggestedDirection: "no_signal",
    confidence: "low",
    signalsMatched: ["no_signal"],
    occurredAt: candidate.occurredAt,
    subject: candidate.subject ?? "",
    bodyFirst120Chars: body.slice(0, BODY_PREVIEW_LENGTH),
  };
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/u.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}

function buildCsv(rows: readonly DirectionReportRow[]): string {
  const header = [
    "canonical_event_id",
    "contact_id",
    "contact_display_name",
    "captured_mailbox",
    "current_direction",
    "suggested_direction",
    "confidence",
    "signals_matched",
    "occurred_at",
    "subject",
    "body_first_120_chars",
  ];
  const lines = [header.join(",")];

  for (const row of rows) {
    lines.push(
      [
        row.canonicalEventId,
        row.contactId,
        row.contactDisplayName,
        row.capturedMailbox,
        row.currentDirection,
        row.suggestedDirection,
        row.confidence,
        row.signalsMatched.join("|"),
        row.occurredAt,
        row.subject,
        row.bodyFirst120Chars,
      ]
        .map((value) => escapeCsvCell(value))
        .join(","),
    );
  }

  return `${lines.join("\n")}\n`;
}

function summarizeRows(rows: readonly DirectionReportRow[]): DetectionSummary {
  let suggestedOutboundHigh = 0;
  let suggestedInboundHigh = 0;
  let suggestedOutboundMedium = 0;
  let suggestedUnknownLow = 0;
  let noSignal = 0;
  let campaignAutomatedExcluded = 0;

  for (const row of rows) {
    if (
      row.suggestedDirection === "outbound" &&
      row.confidence === "high"
    ) {
      suggestedOutboundHigh += 1;
      continue;
    }

    if (row.suggestedDirection === "inbound" && row.confidence === "high") {
      suggestedInboundHigh += 1;
      continue;
    }

    if (
      row.suggestedDirection === "outbound" &&
      row.confidence === "medium"
    ) {
      suggestedOutboundMedium += 1;
      continue;
    }

    if (row.suggestedDirection === "unknown" && row.confidence === "low") {
      suggestedUnknownLow += 1;
      continue;
    }

    if (row.suggestedDirection === "excluded") {
      campaignAutomatedExcluded += 1;
      continue;
    }

    if (row.suggestedDirection === "no_signal") {
      noSignal += 1;
    }
  }

  return {
    candidateRows: rows.length,
    suggestedOutboundHigh,
    suggestedInboundHigh,
    suggestedOutboundMedium,
    suggestedUnknownLow,
    noSignal,
    campaignAutomatedExcluded,
  };
}

async function loadProjectAliases(
  db: Stage1Database,
): Promise<readonly string[]> {
  const rows = await db
    .select({
      alias: sql<string>`lower(trim(${projectAliases.alias}))`,
    })
    .from(projectAliases)
    .where(ne(sql`coalesce(trim(${projectAliases.alias}), '')`, sql`''`))
    .orderBy(asc(projectAliases.alias));

  return Array.from(
    new Set(
      rows
        .map((row) => row.alias.trim())
        .filter((alias) => alias.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

async function loadTeamDirectory(
  db: Stage1Database,
  aliases: readonly string[],
): Promise<TeamDirectory> {
  const identityRows = await db
    .select({
      normalizedValue: contactIdentities.normalizedValue,
    })
    .from(contactIdentities)
    .where(
      and(
        eq(contactIdentities.kind, "email"),
        or(
          eq(contactIdentities.source, "gmail"),
          eq(contactIdentities.source, "salesforce"),
        ),
        like(contactIdentities.normalizedValue, "%@adventurescientists.org"),
      ),
    );

  const contactRows = await db
    .select({
      displayName: contacts.displayName,
      primaryEmail: contacts.primaryEmail,
    })
    .from(contacts)
    .where(
      and(
        like(contacts.id, "contact:salesforce:%"),
        isNotNull(contacts.primaryEmail),
        like(sql`lower(${contacts.primaryEmail})`, "%@adventurescientists.org"),
      ),
    );

  const aliasSet = new Set(aliases.map((alias) => alias.toLowerCase()));
  const teamEmails = Array.from(
    new Set(
      [
        ...identityRows.map((row) => row.normalizedValue.toLowerCase()),
        ...contactRows
          .map((row) => row.primaryEmail?.toLowerCase() ?? "")
          .filter((email) => email.length > 0),
      ].filter((email) => !aliasSet.has(email)),
    ),
  ).sort((left, right) => left.localeCompare(right));

  const teamNameVariants = new Set<string>();
  for (const row of contactRows) {
    for (const variant of buildNameVariants(row.displayName)) {
      teamNameVariants.add(variant);
    }
  }

  return {
    projectAliases: aliases,
    teamEmails,
    teamNameVariants,
  };
}

async function loadCandidates(
  db: Stage1Database,
  aliases: readonly string[],
): Promise<readonly CandidateRow[]> {
  if (aliases.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      canonicalEventId: canonicalEventLedger.id,
      contactId: canonicalEventLedger.contactId,
      contactDisplayName: contacts.displayName,
      capturedMailbox: gmailMessageDetails.capturedMailbox,
      currentDirection: gmailMessageDetails.direction,
      occurredAt: canonicalEventLedger.occurredAt,
      subject: gmailMessageDetails.subject,
      bodyTextPreview: gmailMessageDetails.bodyTextPreview,
      snippetClean: gmailMessageDetails.snippetClean,
    })
    .from(gmailMessageDetails)
    .innerJoin(
      canonicalEventLedger,
      eq(canonicalEventLedger.sourceEvidenceId, gmailMessageDetails.sourceEvidenceId),
    )
    .innerJoin(contacts, eq(contacts.id, canonicalEventLedger.contactId))
    .where(
      and(
        inArray(gmailMessageDetails.capturedMailbox, [...aliases]),
        or(
          sql`${gmailMessageDetails.fromHeader} is null`,
          eq(gmailMessageDetails.fromHeader, ""),
        ),
      ),
    )
    .orderBy(asc(canonicalEventLedger.occurredAt), asc(canonicalEventLedger.id));

  return rows.map((row) => ({
    canonicalEventId: row.canonicalEventId,
    contactId: row.contactId,
    contactDisplayName: row.contactDisplayName,
    capturedMailbox: row.capturedMailbox ?? "",
    currentDirection: row.currentDirection,
    occurredAt: row.occurredAt.toISOString(),
    subject: row.subject,
    bodyTextPreview: row.bodyTextPreview,
    snippetClean: row.snippetClean,
  }));
}

export async function detectMboxDirectionMisclassification(input: {
  readonly db: Stage1Database;
  readonly reportTimestamp: string;
  readonly outputDir?: string;
  readonly logger?: Logger;
}): Promise<DetectionReport> {
  const logger = input.logger ?? {
    info(message: string) {
      console.log(message);
    },
    error(message: string) {
      console.error(message);
    },
  };
  const outputDir = input.outputDir ?? path.resolve(process.cwd(), "tmp");
  const outputPath = path.join(
    outputDir,
    `mbox-direction-report-${input.reportTimestamp}.csv`,
  );

  const aliases = await loadProjectAliases(input.db);
  const directory = await loadTeamDirectory(input.db, aliases);
  const candidates = await loadCandidates(input.db, aliases);
  const rows = candidates.map((candidate) =>
    classifyCandidate(candidate, directory),
  );
  const summary = summarizeRows(rows);

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, buildCsv(rows), "utf8");

  logger.info(`[mbox-direction] candidate rows: ${String(summary.candidateRows)}`);
  logger.info(
    `[mbox-direction] suggested outbound (high conf): ${String(summary.suggestedOutboundHigh)}`,
  );
  logger.info(
    `[mbox-direction] suggested inbound (high conf): ${String(summary.suggestedInboundHigh)}`,
  );
  logger.info(
    `[mbox-direction] suggested outbound (medium): ${String(summary.suggestedOutboundMedium)}`,
  );
  logger.info(
    `[mbox-direction] suggested unknown (low): ${String(summary.suggestedUnknownLow)}`,
  );
  logger.info(`[mbox-direction] no_signal: ${String(summary.noSignal)}`);
  logger.info(
    `[mbox-direction] campaign/automated (excluded): ${String(summary.campaignAutomatedExcluded)}`,
  );
  logger.info(`[mbox-direction] wrote report to ${outputPath}`);

  return {
    outputPath,
    summary,
    rows,
  };
}

export async function runDetectMboxDirectionMisclassificationCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const flags = parseCliFlags(args);
  const reportTimestamp = readRequiredFlag(flags, "timestamp");
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    await detectMboxDirectionMisclassification({
      db: connection.db as Stage1Database,
      reportTimestamp,
    });
  } finally {
    await closeDatabaseConnection(connection);
  }
}

async function main(): Promise<void> {
  await runDetectMboxDirectionMisclassificationCommand(
    process.argv.slice(2),
    process.env,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error: unknown) => {
    if (error instanceof Error) {
      console.error("Mbox direction detection failed.");
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
      console.error("Mbox direction detection failed:", error);
    }
    process.exitCode = 1;
  });
}
