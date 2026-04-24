import { createHash, timingSafeEqual } from "node:crypto";

import { z, type ZodType } from "zod";

export interface CaptureServiceHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Headers | Record<string, string | string[] | undefined>;
  readonly bodyText: string;
}

export interface CaptureServiceHttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export class CaptureServiceBadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureServiceBadRequestError";
  }
}

export interface CursorMarker {
  readonly occurredAt: string;
  readonly recordType: string;
  readonly recordId: string;
}

const cursorMarkerSchema = z.object({
  occurredAt: z.string().datetime(),
  recordType: z.string().min(1),
  recordId: z.string().min(1),
});

const timestampSchema = z.string().datetime();

export function jsonResponse(
  status: number,
  body: unknown,
): CaptureServiceHttpResponse {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  };
}

export function readHeader(
  headers: CaptureServiceHttpRequest["headers"],
  name: string,
): string | null {
  const lowerName = name.toLowerCase();

  if (headers instanceof Headers) {
    return headers.get(lowerName);
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) {
      continue;
    }

    if (Array.isArray(value)) {
      return value.join(", ");
    }

    return value ?? null;
  }

  return null;
}

export function hasBearerToken(
  request: CaptureServiceHttpRequest,
  expectedBearerToken: string,
): boolean {
  const authorizationHeader = readHeader(request.headers, "authorization");

  if (authorizationHeader === null) {
    return false;
  }

  const actual = Buffer.from(authorizationHeader, "utf8");
  const expected = Buffer.from(`Bearer ${expectedBearerToken}`, "utf8");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function parseJsonRequestBody<TSchema extends ZodType<unknown>>(
  request: CaptureServiceHttpRequest,
  schema: TSchema,
): z.output<TSchema> {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(request.bodyText) as unknown;
  } catch {
    throw new CaptureServiceBadRequestError("Request body must be valid JSON.");
  }

  return schema.parse(parsedJson);
}

export function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function normalizeEmail(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 ? null : normalized;
}

export function normalizePhone(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const digits = trimmed.replace(/[^\d+]/gu, "");
  return digits.length === 0 ? null : digits;
}

export function uniqueValues(
  values: readonly (string | null | undefined)[],
): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter(
          (value): value is string => value !== undefined && value.length > 0,
        ),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

export function toIsoTimestamp(
  value: string | number | Date | null,
): string | null {
  if (value === null) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

export function encodeOpaqueCursor(value: CursorMarker): string {
  return Buffer.from(
    JSON.stringify(cursorMarkerSchema.parse(value)),
    "utf8",
  ).toString("base64url");
}

export function decodeOpaqueCursor(cursor: string | null): CursorMarker | null {
  if (cursor === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as unknown;
    return cursorMarkerSchema.parse(parsed);
  } catch {
    throw new Error("Cursor is not valid Stage 1 capture state.");
  }
}

function compareCursorMarkers(left: CursorMarker, right: CursorMarker): number {
  if (left.occurredAt !== right.occurredAt) {
    return left.occurredAt.localeCompare(right.occurredAt);
  }

  if (left.recordType !== right.recordType) {
    return left.recordType.localeCompare(right.recordType);
  }

  return left.recordId.localeCompare(right.recordId);
}

export function paginateCapturedRecords<TRecord>(
  records: readonly TRecord[],
  input: {
    readonly cursor: string | null;
    readonly maxRecords: number;
    readonly getMarker: (record: TRecord) => CursorMarker;
  },
): {
  readonly records: readonly TRecord[];
  readonly nextCursor: string | null;
} {
  const afterMarker = decodeOpaqueCursor(input.cursor);
  const filteredRecords =
    afterMarker === null
      ? records
      : records.filter(
          (record) =>
            compareCursorMarkers(input.getMarker(record), afterMarker) > 0,
        );
  const page = filteredRecords.slice(0, input.maxRecords);
  const hasMore = filteredRecords.length > page.length;
  const nextCursor =
    hasMore && page.length > 0
      ? encodeOpaqueCursor(input.getMarker(page.at(-1) as TRecord))
      : null;

  return {
    records: page,
    nextCursor,
  };
}

export function parseIsoWindow(input: {
  readonly recordIds: readonly string[];
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
}): {
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
} {
  if (input.recordIds.length > 0) {
    return {
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
    };
  }

  if (input.windowStart === null || input.windowEnd === null) {
    throw new CaptureServiceBadRequestError(
      "windowStart and windowEnd are required when recordIds are not provided.",
    );
  }

  const start = timestampSchema.parse(input.windowStart);
  const end = timestampSchema.parse(input.windowEnd);

  if (start >= end) {
    throw new CaptureServiceBadRequestError(
      "windowStart must be earlier than windowEnd.",
    );
  }

  return {
    windowStart: start,
    windowEnd: end,
  };
}

export function isTimestampWithinWindow(
  timestamp: string,
  input: {
    readonly windowStart: string | null;
    readonly windowEnd: string | null;
  },
): boolean {
  if (input.windowStart !== null && timestamp < input.windowStart) {
    return false;
  }

  if (input.windowEnd !== null && timestamp >= input.windowEnd) {
    return false;
  }

  return true;
}
