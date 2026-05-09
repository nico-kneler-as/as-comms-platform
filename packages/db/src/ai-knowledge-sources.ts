import { createHash, randomUUID } from "node:crypto";

import {
  aiKnowledgeSourceSchema,
  aiKnowledgeSourcesSchema,
  type AiKnowledgeSource,
  type AiKnowledgeSourceSyncStatus,
} from "@as-comms/contracts";

import {
  AiKnowledgeSourceValidationError,
  parseSourceUrl,
} from "./parse-source-url.js";
import { hashSourceId } from "./source-id.js";

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function findSourceIndex(
  sources: readonly AiKnowledgeSource[],
  sourceId: string,
): number {
  return sources.findIndex((source) => source.id === sourceId);
}

function assertSourceExists(
  sources: readonly AiKnowledgeSource[],
  sourceId: string,
): number {
  const index = findSourceIndex(sources, sourceId);

  if (index === -1) {
    throw new AiKnowledgeSourceValidationError({
      code: "source_not_found",
      message: `AI knowledge source ${sourceId} was not found.`,
    });
  }

  return index;
}

function assertNoDuplicate(
  sources: readonly AiKnowledgeSource[],
  candidate: { readonly kind: string; readonly sourceId: string | null },
  ignoreId?: string,
): void {
  const duplicate = sources.find(
    (source) =>
      source.id !== ignoreId &&
      source.kind === candidate.kind &&
      source.source_id === candidate.sourceId,
  );

  if (duplicate !== undefined) {
    throw new AiKnowledgeSourceValidationError({
      code: "duplicate_source",
      message: `AI knowledge source ${duplicate.id} already exists for this project.`,
    });
  }
}

function replaceSourceAt(
  sources: readonly AiKnowledgeSource[],
  index: number,
  nextSource: AiKnowledgeSource,
): readonly AiKnowledgeSource[] {
  return sources.map((source, sourceIndex) =>
    sourceIndex === index ? nextSource : source,
  );
}

export interface AddAiKnowledgeSourceInput {
  readonly url: string;
  readonly label?: string | null;
  readonly enabled?: boolean;
  readonly now?: string;
}

export function addSource(
  sources: readonly AiKnowledgeSource[],
  input: AddAiKnowledgeSourceInput,
): readonly AiKnowledgeSource[] {
  const parsedSources = aiKnowledgeSourcesSchema.parse(sources);
  const parsedUrl = parseSourceUrl(input.url);
  const sourceId =
    parsedUrl.kind === "web_page" && parsedUrl.source_id !== null
      ? hashSourceId(parsedUrl.source_id)
      : parsedUrl.source_id;

  assertNoDuplicate(parsedSources, {
    kind: parsedUrl.kind,
    sourceId,
  });

  const now = input.now ?? new Date().toISOString();
  const nextSource = aiKnowledgeSourceSchema.parse({
    id: randomUUID(),
    url: parsedUrl.normalized_url,
    kind: parsedUrl.kind,
    label: input.label ?? null,
    enabled: input.enabled ?? true,
    last_synced_at: null,
    last_sync_status: null,
    last_sync_error: null,
    source_id: sourceId,
    source_content_hash: null,
    created_at: now,
    updated_at: now,
  });

  return [...parsedSources, nextSource];
}

export function updateSource(
  sources: readonly AiKnowledgeSource[],
  sourceId: string,
  patch: Partial<Omit<AiKnowledgeSource, "id" | "created_at" | "updated_at">>,
): readonly AiKnowledgeSource[] {
  const parsedSources = aiKnowledgeSourcesSchema.parse(sources);
  const index = assertSourceExists(parsedSources, sourceId);
  const existing = parsedSources[index];
  if (existing === undefined) {
    throw new AiKnowledgeSourceValidationError({
      code: "source_not_found",
      message: `AI knowledge source ${sourceId} was not found.`,
    });
  }
  const nextUpdatedAt = new Date().toISOString();

  let nextUrl = existing.url;
  let nextKind = existing.kind;
  let nextSourceId = existing.source_id;

  if (patch.url !== undefined) {
    const parsedUrl = parseSourceUrl(patch.url);
    nextUrl = parsedUrl.normalized_url;
    nextKind = parsedUrl.kind;
    nextSourceId =
      parsedUrl.kind === "web_page" && parsedUrl.source_id !== null
        ? hashSourceId(parsedUrl.source_id)
        : parsedUrl.source_id;
    assertNoDuplicate(
      parsedSources,
      { kind: nextKind, sourceId: nextSourceId },
      existing.id,
    );
  }

  const nextSource = aiKnowledgeSourceSchema.parse({
    ...existing,
    ...patch,
    url: nextUrl,
    kind: nextKind,
    source_id: nextSourceId,
    updated_at: nextUpdatedAt,
  });

  return replaceSourceAt(parsedSources, index, nextSource);
}

export function removeSource(
  sources: readonly AiKnowledgeSource[],
  sourceId: string,
): readonly AiKnowledgeSource[] {
  const parsedSources = aiKnowledgeSourcesSchema.parse(sources);
  return parsedSources.filter((source) => source.id !== sourceId);
}

export function setSourceEnabled(
  sources: readonly AiKnowledgeSource[],
  sourceId: string,
  enabled: boolean,
): readonly AiKnowledgeSource[] {
  return updateSource(sources, sourceId, { enabled });
}

export interface MarkAiKnowledgeSourceSyncResultInput {
  readonly last_synced_at?: string;
  readonly last_sync_status: AiKnowledgeSourceSyncStatus;
  readonly last_sync_error: string | null;
  readonly source_content_hash: string | null;
}

export function markSourceSyncResult(
  sources: readonly AiKnowledgeSource[],
  sourceId: string,
  result: MarkAiKnowledgeSourceSyncResultInput,
): readonly AiKnowledgeSource[] {
  return updateSource(sources, sourceId, {
    last_synced_at: result.last_synced_at ?? new Date().toISOString(),
    last_sync_status: result.last_sync_status,
    last_sync_error: result.last_sync_error,
    source_content_hash: result.source_content_hash,
  });
}

export function inputHashFromSources(
  sources: readonly AiKnowledgeSource[],
): string | null {
  const parsedSources = aiKnowledgeSourcesSchema.parse(sources);
  const enabledHashes = parsedSources
    .filter((source) => source.enabled && source.source_content_hash !== null)
    .map((source) => source.source_content_hash);

  if (enabledHashes.length === 0) {
    return null;
  }

  return hashText(enabledHashes.join("\n"));
}
