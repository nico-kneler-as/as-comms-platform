export function deriveInitials(label: string | null, fallbackEmail: string): string {
  const source = (label?.trim().length ?? 0) > 0 ? label ?? "" : fallbackEmail;
  const parts = source
    .trim()
    .split(/\s+/u)
    .filter((part) => part.length > 0)
    .slice(0, 2);

  if (parts.length === 0) {
    return "??";
  }

  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}
