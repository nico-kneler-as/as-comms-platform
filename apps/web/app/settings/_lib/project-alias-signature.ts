export const PROJECT_ALIAS_SIGNATURE_MAX_LENGTH = 2000;

const PROJECT_ALIAS_SIGNATURE_HTML_PATTERN = /<[^>]+>/u;
const TRAILING_WHITESPACE_PATTERN = /[^\S\r\n]+$/gmu;

export function normalizeProjectAliasSignature(signature: string): string {
  return signature.replace(TRAILING_WHITESPACE_PATTERN, "");
}

export function getProjectAliasSignatureValidationError(
  signature: string
): string | null {
  if (signature.length > PROJECT_ALIAS_SIGNATURE_MAX_LENGTH) {
    return `Signature must be ${String(PROJECT_ALIAS_SIGNATURE_MAX_LENGTH)} characters or fewer.`;
  }

  if (PROJECT_ALIAS_SIGNATURE_HTML_PATTERN.test(signature)) {
    return "Signature must be plain text only.";
  }

  return null;
}
