import { and, asc, eq, gte, inArray } from "drizzle-orm";

import {
  canonicalEventLedger,
  gmailMessageDetails,
  type Stage1Database,
} from "@as-comms/db";

export interface GmailAliasHistoryDigestInput {
  readonly db: Stage1Database;
  readonly projectAlias: string;
  readonly monthsBack?: number;
  readonly now?: Date;
  readonly maxChars?: number;
}

export interface GmailAliasHistoryDigest {
  readonly digestMarkdown: string;
  readonly threadCount: number;
}

interface DigestRow {
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly eventType: string;
  readonly gmailThreadId: string | null;
  readonly subject: string | null;
  readonly fromHeader: string | null;
  readonly toHeader: string | null;
  readonly snippetClean: string;
  readonly bodyTextPreview: string;
}

function maskKnowledgeExample(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "{EMAIL}")
    .replace(/\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/gu, "{PHONE}")
    .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/gu, "{NAME}");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function bodyForRow(row: DigestRow): string {
  return normalizeWhitespace(row.bodyTextPreview || row.snippetClean);
}

function directionForRow(row: DigestRow): "inbound" | "outbound" | null {
  if (row.eventType === "communication.email.inbound") {
    return "inbound";
  }
  if (row.eventType === "communication.email.outbound") {
    return "outbound";
  }
  return null;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function buildThreadDigest(
  threadId: string,
  rows: readonly DigestRow[],
): string | null {
  const pairs: string[] = [];
  let pendingInbound: DigestRow | null = null;

  for (const row of rows) {
    const direction = directionForRow(row);
    if (direction === "inbound") {
      pendingInbound = row;
      continue;
    }

    if (direction === "outbound" && pendingInbound !== null) {
      const question = bodyForRow(pendingInbound);
      const answer = bodyForRow(row);
      if (question.length > 0 || answer.length > 0) {
        pairs.push(
          [
            `Q: ${question.length > 0 ? question : "(empty inbound preview)"}`,
            `A: ${answer.length > 0 ? answer : "(empty outbound preview)"}`,
          ].join("\n"),
        );
      }
      pendingInbound = null;
    }
  }

  if (pairs.length === 0) {
    return null;
  }

  const subject =
    rows.find((row) => row.subject !== null)?.subject ?? "No subject captured";
  return [`## Thread ${threadId}`, `Subject: ${subject}`, "", pairs.join("\n\n")].join(
    "\n",
  );
}

export async function digestAliasHistory(
  input: GmailAliasHistoryDigestInput,
): Promise<GmailAliasHistoryDigest> {
  const now = input.now ?? new Date();
  const monthsBack = input.monthsBack ?? 24;
  const maxChars = input.maxChars ?? 20_000;
  const since = new Date(now);
  since.setMonth(since.getMonth() - monthsBack);

  const rows = await input.db
    .select({
      eventId: canonicalEventLedger.id,
      occurredAt: canonicalEventLedger.occurredAt,
      eventType: canonicalEventLedger.eventType,
      gmailThreadId: gmailMessageDetails.gmailThreadId,
      subject: gmailMessageDetails.subject,
      fromHeader: gmailMessageDetails.fromHeader,
      toHeader: gmailMessageDetails.toHeader,
      snippetClean: gmailMessageDetails.snippetClean,
      bodyTextPreview: gmailMessageDetails.bodyTextPreview,
    })
    .from(canonicalEventLedger)
    .innerJoin(
      gmailMessageDetails,
      eq(canonicalEventLedger.sourceEvidenceId, gmailMessageDetails.sourceEvidenceId),
    )
    .where(
      and(
        eq(gmailMessageDetails.projectInboxAlias, input.projectAlias),
        inArray(canonicalEventLedger.eventType, [
          "communication.email.inbound",
          "communication.email.outbound",
        ]),
        gte(canonicalEventLedger.occurredAt, since),
      ),
    )
    .orderBy(
      asc(gmailMessageDetails.gmailThreadId),
      asc(canonicalEventLedger.occurredAt),
      asc(canonicalEventLedger.id),
    );

  const rowsByThread = new Map<string, DigestRow[]>();
  for (const row of rows) {
    const threadId = row.gmailThreadId ?? `event:${row.eventId}`;
    const threadRows = rowsByThread.get(threadId) ?? [];
    threadRows.push(row);
    rowsByThread.set(threadId, threadRows);
  }

  const threadDigests = [...rowsByThread.entries()]
    .map(([threadId, threadRows]) => buildThreadDigest(threadId, threadRows))
    .filter((value): value is string => value !== null);

  const digestMarkdown = maskKnowledgeExample(
    truncate(threadDigests.join("\n\n"), maxChars),
  );

  return {
    digestMarkdown,
    threadCount: threadDigests.length,
  };
}
