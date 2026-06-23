import { and, desc, eq, lt, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type {
  ComposerDraftChannel,
  ComposerDraftForwardContext,
  ComposerDraftRecipientKind,
} from "@as-comms/contracts";

import {
  mapComposerDraftInsert,
  mapComposerDraftRow,
  type ComposerDraftPaneMode,
  type ComposerDraftRecord,
  type ComposerDraftRow,
} from "./mappers.js";
import type { DatabaseSchema } from "./schema/index.js";
import { composerDrafts } from "./schema/index.js";

type ComposerDraftDatabase = PgDatabase<PgQueryResultHKT, DatabaseSchema>;

type ComposerDraftCursorKey = Readonly<{
  updatedAt: string;
  id: string;
}>;

export interface UpsertComposerDraftInput {
  readonly id?: string | null;
  readonly actorId: string;
  readonly paneMode: ComposerDraftPaneMode;
  readonly channel: ComposerDraftChannel;
  readonly recipientAnchorKind: ComposerDraftRecipientKind | null;
  readonly recipientContactId: string | null;
  readonly recipientEmail: string | null;
  readonly recipientPhone: string | null;
  readonly subject: string;
  readonly bodyPlaintext: string;
  readonly bodyHtml: string;
  readonly selectedAlias: string | null;
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly attachments: readonly {
    readonly filename: string;
    readonly size: number;
    readonly contentType: string;
  }[];
  readonly aiDirective: string;
  readonly replyContextThreadCursor: string | null;
  readonly forwardContext: ComposerDraftForwardContext | null;
}

export interface ListComposerDraftsByActorInput {
  readonly actorId: string;
  readonly limit: number;
  readonly cursor?: string | null;
}

export interface DeleteComposerDraftInput {
  readonly id: string;
  readonly actorId: string;
}

export interface ListComposerDraftsByActorResult {
  readonly drafts: readonly ComposerDraftRecord[];
  readonly nextCursor: string | null;
}

function encodeCursor(key: ComposerDraftCursorKey): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): ComposerDraftCursorKey {
  const parsed = JSON.parse(
    Buffer.from(cursor, "base64url").toString("utf8"),
  ) as Partial<ComposerDraftCursorKey>;

  if (
    typeof parsed.id !== "string" ||
    parsed.id.length === 0 ||
    typeof parsed.updatedAt !== "string" ||
    Number.isNaN(Date.parse(parsed.updatedAt))
  ) {
    throw new Error("Invalid composer draft cursor.");
  }

  return {
    id: parsed.id,
    updatedAt: parsed.updatedAt,
  };
}

function toInsertValues(input: UpsertComposerDraftInput) {
  return mapComposerDraftInsert({
    actor_id: input.actorId,
    pane_mode: input.paneMode,
    channel: input.channel,
    recipient_anchor_kind: input.recipientAnchorKind,
    recipient_contact_id: input.recipientContactId,
    recipient_email: input.recipientEmail,
    recipient_phone: input.recipientPhone,
    subject: input.subject,
    body_plaintext: input.bodyPlaintext,
    body_html: input.bodyHtml,
    selected_alias: input.selectedAlias,
    cc: [...input.cc],
    bcc: [...input.bcc],
    attachments: [...input.attachments],
    ai_directive: input.aiDirective,
    reply_context_thread_cursor: input.replyContextThreadCursor,
    forward_context: input.forwardContext,
  });
}

function toComposerDraftRow(
  row: typeof composerDrafts.$inferSelect,
): ComposerDraftRow {
  return {
    id: row.id,
    actor_id: row.actorId,
    pane_mode: row.paneMode,
    channel: row.channel,
    recipient_anchor_kind: row.recipientAnchorKind,
    recipient_contact_id: row.recipientContactId,
    recipient_email: row.recipientEmail,
    recipient_phone: row.recipientPhone,
    subject: row.subject,
    body_plaintext: row.bodyPlaintext,
    body_html: row.bodyHtml,
    selected_alias: row.selectedAlias,
    cc: row.cc,
    bcc: row.bcc,
    attachments: row.attachments,
    ai_directive: row.aiDirective,
    reply_context_thread_cursor: row.replyContextThreadCursor,
    forward_context: row.forwardContext,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function upsertComposerDraft(
  db: ComposerDraftDatabase,
  input: UpsertComposerDraftInput,
): Promise<ComposerDraftRecord | null> {
  const values = toInsertValues(input);

  if (input.id) {
    const [row] = await db
      .update(composerDrafts)
      .set({
        paneMode: values.paneMode,
        channel: values.channel,
        recipientAnchorKind: values.recipientAnchorKind,
        recipientContactId: values.recipientContactId,
        recipientEmail: values.recipientEmail,
        recipientPhone: values.recipientPhone,
        subject: values.subject,
        bodyPlaintext: values.bodyPlaintext,
        bodyHtml: values.bodyHtml,
        selectedAlias: values.selectedAlias,
        cc: values.cc,
        bcc: values.bcc,
        attachments: values.attachments,
        aiDirective: values.aiDirective,
        replyContextThreadCursor: values.replyContextThreadCursor,
        forwardContext: values.forwardContext ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(composerDrafts.id, input.id),
          eq(composerDrafts.actorId, input.actorId),
        ),
      )
      .returning();

    return row === undefined ? null : mapComposerDraftRow(toComposerDraftRow(row));
  }

  const [row] = await db.insert(composerDrafts).values(values).returning();
  return row === undefined ? null : mapComposerDraftRow(toComposerDraftRow(row));
}

export async function listComposerDraftsByActor(
  db: ComposerDraftDatabase,
  input: ListComposerDraftsByActorInput,
): Promise<ListComposerDraftsByActorResult> {
  const cursor =
    input.cursor === undefined || input.cursor === null
      ? null
      : decodeCursor(input.cursor);

  const rows = await db
    .select()
    .from(composerDrafts)
    .where(
      cursor === null
        ? eq(composerDrafts.actorId, input.actorId)
        : and(
            eq(composerDrafts.actorId, input.actorId),
            or(
              lt(composerDrafts.updatedAt, new Date(cursor.updatedAt)),
              and(
                eq(composerDrafts.updatedAt, new Date(cursor.updatedAt)),
                lt(composerDrafts.id, cursor.id),
              ),
            ),
          ),
    )
    .orderBy(desc(composerDrafts.updatedAt), desc(composerDrafts.id))
    .limit(input.limit + 1);

  const hasNextPage = rows.length > input.limit;
  const pageRows = hasNextPage ? rows.slice(0, input.limit) : rows;
  const drafts = pageRows.map((row) => mapComposerDraftRow(toComposerDraftRow(row)));
  const lastDraft = drafts.at(-1) ?? null;

  return {
    drafts,
    nextCursor:
      hasNextPage && lastDraft !== null
        ? encodeCursor({
            id: lastDraft.id,
            updatedAt: lastDraft.updatedAt,
          })
        : null,
  };
}

export async function deleteComposerDraft(
  db: ComposerDraftDatabase,
  input: DeleteComposerDraftInput,
): Promise<number> {
  const rows = await db
    .delete(composerDrafts)
    .where(
      and(
        eq(composerDrafts.id, input.id),
        eq(composerDrafts.actorId, input.actorId),
      ),
    )
    .returning({ id: composerDrafts.id });

  return rows.length;
}
