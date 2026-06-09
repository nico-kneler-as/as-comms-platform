const PLACEHOLDER_FILENAME_PATTERN =
  /^(noname|image\d*\.(?:png|jpe?g|gif|webp)|ATT\d+\.(?:png|jpe?g|gif|webp))$/iu;

export function classifyAttachment(input: {
  readonly filename: string | null;
  readonly mimeType: string;
}): { readonly isDecoration: boolean } {
  if (!input.mimeType.toLowerCase().startsWith("image/")) {
    return { isDecoration: false };
  }

  const trimmed = input.filename?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return { isDecoration: true };
  }

  return { isDecoration: PLACEHOLDER_FILENAME_PATTERN.test(trimmed) };
}
