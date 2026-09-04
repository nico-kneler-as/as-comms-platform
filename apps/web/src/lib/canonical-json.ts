/**
 * Order-insensitive JSON comparison for rich-text documents.
 *
 * Key order is not part of a document's meaning, and Postgres `jsonb` does not
 * preserve it — a node written as `{type, text}` reads back as `{text, type}`.
 * Comparing a local editor document against one that has round-tripped through
 * the database with plain `JSON.stringify` therefore always reported a
 * difference, which left the automated-email editor permanently convinced the
 * draft was unsaved.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    sorted[key] = sortKeysDeep(source[key]);
  }

  return sorted;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}
