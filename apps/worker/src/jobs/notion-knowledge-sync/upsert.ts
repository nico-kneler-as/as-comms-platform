import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { aiKnowledgeEntries, type Stage1Database } from "@as-comms/db";

export interface UpsertAiKnowledgeEntryInput {
  readonly scope: "global" | "project";
  readonly scopeKey: string | null;
  readonly sourceProvider: string;
  readonly sourceId: string;
  readonly sourceUrl: string | null;
  readonly title: string | null;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly sourceLastEditedAt: Date | null;
  readonly syncedAt: Date;
}

export interface UpsertAiKnowledgeEntryResult {
  readonly action: "inserted" | "updated" | "unchanged";
  readonly row: typeof aiKnowledgeEntries.$inferSelect;
}

function buildAiKnowledgeEntryId(input: {
  readonly sourceProvider: string;
  readonly sourceId: string;
}): string {
  return `ai_knowledge:${input.sourceProvider}:${input.sourceId}`;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right)
  );

  return `{${entries
    .map(([key, childValue]) => `${JSON.stringify(key)}:${stableStringify(childValue)}`)
    .join(",")}}`;
}

function hasStoredChanges(
  row: typeof aiKnowledgeEntries.$inferSelect,
  input: UpsertAiKnowledgeEntryInput,
  contentHash: string
): boolean {
  return (
    row.scope !== input.scope ||
    row.scopeKey !== input.scopeKey ||
    row.sourceUrl !== input.sourceUrl ||
    row.title !== input.title ||
    row.contentHash !== contentHash ||
    row.content !== input.content ||
    stableStringify(row.metadataJson) !== stableStringify(input.metadata) ||
    row.sourceLastEditedAt?.getTime() !== input.sourceLastEditedAt?.getTime()
  );
}

export async function upsertAiKnowledgeEntry(
  db: Stage1Database,
  input: UpsertAiKnowledgeEntryInput
): Promise<UpsertAiKnowledgeEntryResult> {
  const contentHash = sha256Text(input.content);
  const [existingRow] = await db
    .select()
    .from(aiKnowledgeEntries)
    .where(
      and(
        eq(aiKnowledgeEntries.sourceProvider, input.sourceProvider),
        eq(aiKnowledgeEntries.sourceId, input.sourceId)
      )
    )
    .limit(1);

  if (existingRow === undefined) {
    const [insertedRow] = await db
      .insert(aiKnowledgeEntries)
      .values({
        id: buildAiKnowledgeEntryId({
          sourceProvider: input.sourceProvider,
          sourceId: input.sourceId
        }),
        scope: input.scope,
        scopeKey: input.scopeKey,
        sourceProvider: input.sourceProvider,
        sourceId: input.sourceId,
        sourceUrl: input.sourceUrl,
        title: input.title,
        content: input.content,
        contentHash,
        metadataJson: input.metadata,
        sourceLastEditedAt: input.sourceLastEditedAt,
        syncedAt: input.syncedAt,
        updatedAt: input.syncedAt
      })
      .returning();

    if (insertedRow === undefined) {
      throw new Error("Expected inserted ai_knowledge_entries row to be returned.");
    }

    return {
      action: "inserted",
      row: insertedRow
    };
  }

  if (!hasStoredChanges(existingRow, input, contentHash)) {
    return {
      action: "unchanged",
      row: existingRow
    };
  }

  const [updatedRow] = await db
    .update(aiKnowledgeEntries)
    .set({
      scope: input.scope,
      scopeKey: input.scopeKey,
      sourceUrl: input.sourceUrl,
      title: input.title,
      content: input.content,
      contentHash,
      metadataJson: input.metadata,
      sourceLastEditedAt: input.sourceLastEditedAt,
      syncedAt: input.syncedAt,
      updatedAt: input.syncedAt
    })
    .where(eq(aiKnowledgeEntries.id, existingRow.id))
    .returning();

  if (updatedRow === undefined) {
    throw new Error("Expected updated ai_knowledge_entries row to be returned.");
  }

  return {
    action: "updated",
    row: updatedRow
  };
}
