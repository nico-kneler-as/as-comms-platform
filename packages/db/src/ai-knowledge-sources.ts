import { createHash, randomUUID } from "node:crypto";

import {
  aiKnowledgeSourceSchema,
  aiKnowledgeSourcesSchema,
  type AiKnowledgeSource,
  type AiKnowledgeSourceSyncStatus,
} from "@as-comms/contracts";

const NOTION_HOST_PATTERN = /(^|\.)notion\.so$/u;
const NOTION_ID_PATTERN =
  /([0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/iu;

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeUrlInput(value: string): string {
  return value.trim();
}

function normalizeWebUrl(url: URL): string {
  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  return url.toString();
}

function normalizeNotionSourceId(value: string): string {
  const normalized = value.trim().replace(/-/gu, "").toLowerCase();

  if (!/^[0-9a-f]{32}$/u.test(normalized)) {
    throw new AiKnowledgeSourceValidationError({
      code: "invalid_url",
      message: `Invalid Notion page ID: ${value}`,
    });
  }

  return normalized;
}

function isNotionHost(hostname: string): boolean {
  return NOTION_HOST_PATTERN.test(hostname.toLowerCase());
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

export class AiKnowledgeSourceValidationError extends Error {
  readonly code:
    | "duplicate_source"
    | "invalid_url"
    | "source_not_found";

  constructor(input: {
    readonly code: AiKnowledgeSourceValidationError["code"];
    readonly message: string;
  }) {
    super(input.message);
    this.name = "AiKnowledgeSourceValidationError";
    this.code = input.code;
  }
}

export function parseSourceUrl(url: string): {
  readonly kind: "notion" | "web_page";
  readonly source_id: string | null;
  readonly normalized_url: string;
} {
  const trimmedUrl = normalizeUrlInput(url);

  if (trimmedUrl.length === 0) {
    throw new AiKnowledgeSourceValidationError({
      code: "invalid_url",
      message: "AI knowledge source URL is required.",
    });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new AiKnowledgeSourceValidationError({
      code: "invalid_url",
      message: `Invalid AI knowledge source URL: ${url}`,
    });
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new AiKnowledgeSourceValidationError({
      code: "invalid_url",
      message: `Unsupported AI knowledge source URL scheme: ${parsedUrl.protocol}`,
    });
  }

  if (isNotionHost(parsedUrl.hostname)) {
    const notionIdMatch = NOTION_ID_PATTERN.exec(parsedUrl.pathname);
    const notionId = notionIdMatch?.[1];

    if (notionId === undefined) {
      throw new AiKnowledgeSourceValidationError({
        code: "invalid_url",
        message: `Could not extract a Notion page ID from URL: ${url}`,
      });
    }

    const sourceId = normalizeNotionSourceId(notionId);
    return {
      kind: "notion",
      source_id: sourceId,
      normalized_url: `https://www.notion.so/${sourceId}`,
    };
  }

  const normalizedUrl = normalizeWebUrl(parsedUrl);
  return {
    kind: "web_page",
    source_id: hashText(normalizedUrl),
    normalized_url: normalizedUrl,
  };
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

  assertNoDuplicate(parsedSources, {
    kind: parsedUrl.kind,
    sourceId: parsedUrl.source_id,
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
    source_id: parsedUrl.source_id,
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
    nextSourceId = parsedUrl.source_id;
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
