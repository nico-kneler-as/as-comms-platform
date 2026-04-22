import {
  containsHtmlTags,
  trimTrailingWhitespace,
} from "@/src/lib/plaintext-validation";

export const PROJECT_ALIAS_SIGNATURE_MAX_LENGTH = 2000;

export function normalizeProjectAliasSignature(signature: string): string {
  return trimTrailingWhitespace(signature);
}

export function getProjectAliasSignatureValidationError(
  signature: string,
): string | null {
  if (signature.length > PROJECT_ALIAS_SIGNATURE_MAX_LENGTH) {
    return `Signature must be ${String(PROJECT_ALIAS_SIGNATURE_MAX_LENGTH)} characters or fewer.`;
  }

  if (containsHtmlTags(signature)) {
    return "Signature must be plain text only.";
  }

  return null;
}
