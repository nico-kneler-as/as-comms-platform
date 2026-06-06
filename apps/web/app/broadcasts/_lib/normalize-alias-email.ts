export function normalizeAliasEmail(value: string | null): string | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}
