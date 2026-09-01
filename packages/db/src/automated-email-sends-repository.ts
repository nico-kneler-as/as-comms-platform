import { and, count, desc, eq, gte, inArray, lt, max, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type {
  AutomatedEmailRenderedPreview,
  AutomatedEmailSendRecord,
  AutomatedEmailSendStatus,
} from "@as-comms/contracts";

import {
  mapAutomatedEmailSendInsert,
  mapAutomatedEmailSendRow,
  type AutomatedEmailSendRow,
} from "./mappers.js";
import type { DatabaseSchema } from "./schema/index.js";
import { automatedEmailSends } from "./schema/index.js";

export type AutomatedEmailSendsDatabase = PgDatabase<
  PgQueryResultHKT,
  DatabaseSchema
>;

type AutomatedEmailSendCursorKey = Readonly<{
  receivedAt: string;
  id: string;
}>;

export interface CreateAutomatedEmailSendInput {
  readonly templateId: string;
  readonly projectId: string;
  readonly expeditionMemberId: string;
  readonly contactId: string | null;
  readonly payload: unknown;
}

export interface UpdateAutomatedEmailSendStatusInput {
  readonly status: Exclude<AutomatedEmailSendStatus, "received">;
  readonly statusReason?: string | null;
  readonly contactId?: string | null;
  readonly renderedPreview?: AutomatedEmailRenderedPreview | null;
  readonly ledgerEventId?: string | null;
  readonly providerMessageId?: string | null;
}

export interface ListAutomatedEmailSendsInput {
  readonly templateId: string;
  readonly limit: number;
  readonly cursor?: string | null;
}

export interface ListAutomatedEmailSendsResult {
  readonly items: readonly AutomatedEmailSendRecord[];
  readonly nextCursor: string | null;
}

export type AutomatedEmailSendStatusCounts = Readonly<
  Record<AutomatedEmailSendStatus, number>
>;

function encodeCursor(key: AutomatedEmailSendCursorKey): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): AutomatedEmailSendCursorKey {
  const parsed = JSON.parse(
    Buffer.from(cursor, "base64url").toString("utf8"),
  ) as Partial<AutomatedEmailSendCursorKey>;

  if (
    typeof parsed.id !== "string" ||
    parsed.id.length === 0 ||
    typeof parsed.receivedAt !== "string" ||
    Number.isNaN(Date.parse(parsed.receivedAt))
  ) {
    throw new Error("Invalid automated email send cursor.");
  }

  return { id: parsed.id, receivedAt: parsed.receivedAt };
}

function toAutomatedEmailSendRow(
  row: typeof automatedEmailSends.$inferSelect,
): AutomatedEmailSendRow {
  return {
    id: row.id,
    template_id: row.templateId,
    project_id: row.projectId,
    expedition_member_id: row.expeditionMemberId,
    contact_id: row.contactId,
    status: row.status,
    status_reason: row.statusReason,
    payload: row.payload,
    rendered_preview: row.renderedPreview,
    ledger_event_id: row.ledgerEventId,
    provider_message_id: row.providerMessageId,
    received_at: row.receivedAt,
    processed_at: row.processedAt,
  };
}

function mapSend(
  row: typeof automatedEmailSends.$inferSelect,
): AutomatedEmailSendRecord {
  return mapAutomatedEmailSendRow(toAutomatedEmailSendRow(row));
}

export async function createSendLogRow(
  db: AutomatedEmailSendsDatabase,
  input: CreateAutomatedEmailSendInput,
): Promise<AutomatedEmailSendRecord> {
  const [row] = await db
    .insert(automatedEmailSends)
    .values(mapAutomatedEmailSendInsert(input))
    .returning();

  if (row === undefined) {
    throw new Error("Failed to create automated email send log row.");
  }

  return mapSend(row);
}

export async function updateSendStatus(
  db: AutomatedEmailSendsDatabase,
  id: string,
  input: UpdateAutomatedEmailSendStatusInput,
): Promise<AutomatedEmailSendRecord> {
  const [row] = await db
    .update(automatedEmailSends)
    .set({
      status: input.status,
      ...(input.statusReason === undefined
        ? {}
        : { statusReason: input.statusReason }),
      ...(input.contactId === undefined ? {} : { contactId: input.contactId }),
      ...(input.renderedPreview === undefined
        ? {}
        : { renderedPreview: input.renderedPreview }),
      ...(input.ledgerEventId === undefined
        ? {}
        : { ledgerEventId: input.ledgerEventId }),
      ...(input.providerMessageId === undefined
        ? {}
        : { providerMessageId: input.providerMessageId }),
      processedAt: new Date(),
    })
    .where(eq(automatedEmailSends.id, id))
    .returning();

  if (row === undefined) {
    throw new Error(`Automated email send ${id} was not found.`);
  }

  return mapSend(row);
}

export async function getSendLogRow(
  db: AutomatedEmailSendsDatabase,
  id: string,
): Promise<AutomatedEmailSendRecord | null> {
  const [row] = await db
    .select()
    .from(automatedEmailSends)
    .where(eq(automatedEmailSends.id, id))
    .limit(1);

  return row === undefined ? null : mapSend(row);
}

export async function findRecentSendForDedupe(
  db: AutomatedEmailSendsDatabase,
  input: Readonly<{
    templateId: string;
    expeditionMemberId: string;
    since: Date;
  }>,
): Promise<AutomatedEmailSendRecord | null> {
  const [row] = await db
    .select()
    .from(automatedEmailSends)
    .where(
      and(
        eq(automatedEmailSends.templateId, input.templateId),
        eq(automatedEmailSends.expeditionMemberId, input.expeditionMemberId),
        eq(automatedEmailSends.status, "sent"),
        gte(automatedEmailSends.receivedAt, input.since),
      ),
    )
    .orderBy(desc(automatedEmailSends.receivedAt), desc(automatedEmailSends.id))
    .limit(1);

  return row === undefined ? null : mapSend(row);
}

export async function listSendsByTemplate(
  db: AutomatedEmailSendsDatabase,
  input: ListAutomatedEmailSendsInput,
): Promise<ListAutomatedEmailSendsResult> {
  const cursor =
    input.cursor === undefined || input.cursor === null
      ? null
      : decodeCursor(input.cursor);
  const rows = await db
    .select()
    .from(automatedEmailSends)
    .where(
      cursor === null
        ? eq(automatedEmailSends.templateId, input.templateId)
        : and(
            eq(automatedEmailSends.templateId, input.templateId),
            or(
              lt(automatedEmailSends.receivedAt, new Date(cursor.receivedAt)),
              and(
                eq(automatedEmailSends.receivedAt, new Date(cursor.receivedAt)),
                lt(automatedEmailSends.id, cursor.id),
              ),
            ),
          ),
    )
    .orderBy(desc(automatedEmailSends.receivedAt), desc(automatedEmailSends.id))
    .limit(input.limit + 1);
  const hasNextPage = rows.length > input.limit;
  const pageRows = hasNextPage ? rows.slice(0, input.limit) : rows;
  const items = pageRows.map(mapSend);
  const lastItem = items.at(-1) ?? null;

  return {
    items,
    nextCursor:
      hasNextPage && lastItem !== null
        ? encodeCursor({ id: lastItem.id, receivedAt: lastItem.receivedAt })
        : null,
  };
}

export async function getLastReceivedAtByTemplateIds(
  db: AutomatedEmailSendsDatabase,
  templateIds: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  const uniqueTemplateIds = [...new Set(templateIds)];
  const receivedAtByTemplateId = new Map<string, string | null>(
    uniqueTemplateIds.map((templateId): [string, string | null] => [
      templateId,
      null,
    ]),
  );

  if (receivedAtByTemplateId.size === 0) {
    return receivedAtByTemplateId;
  }

  const rows = await db
    .select({
      templateId: automatedEmailSends.templateId,
      receivedAt: max(automatedEmailSends.receivedAt),
    })
    .from(automatedEmailSends)
    .where(inArray(automatedEmailSends.templateId, uniqueTemplateIds))
    .groupBy(automatedEmailSends.templateId);

  for (const row of rows) {
    if (row.receivedAt instanceof Date) {
      receivedAtByTemplateId.set(row.templateId, row.receivedAt.toISOString());
    }
  }

  return receivedAtByTemplateId;
}

/**
 * Compact status summary for the template editor. The full send-log reader is
 * intentionally separate so the next UI brick can replace its content without
 * changing the editor shell's data contract.
 */
export async function getSendStatusCountsByTemplateId(
  db: AutomatedEmailSendsDatabase,
  templateId: string,
): Promise<AutomatedEmailSendStatusCounts> {
  const counts: Record<AutomatedEmailSendStatus, number> = {
    received: 0,
    sent: 0,
    duplicate: 0,
    held: 0,
    failed: 0,
  };
  const rows = await db
    .select({
      status: automatedEmailSends.status,
      count: count(),
    })
    .from(automatedEmailSends)
    .where(eq(automatedEmailSends.templateId, templateId))
    .groupBy(automatedEmailSends.status);

  for (const row of rows) {
    counts[row.status] = row.count;
  }

  return counts;
}
