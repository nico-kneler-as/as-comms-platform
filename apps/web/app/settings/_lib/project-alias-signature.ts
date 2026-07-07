import {
  containsHtmlTags,
  trimTrailingWhitespace,
} from "@/src/lib/plaintext-validation";

export const PROJECT_ALIAS_SIGNATURE_MAX_LENGTH = 2000;
export const PROJECT_ALIAS_SIGNATURE_OPERATOR_FIRST_NAME_TOKEN =
  "{{operatorFirstName}}";
export const PROJECT_ALIAS_SIGNATURE_PREVIEW_FIRST_NAME = "Nico";

const SIGNATURE_TOKEN_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/gu;
const ALLOWED_SIGNATURE_TOKENS = new Set(["operatorFirstName"]);

export function normalizeProjectAliasSignature(signature: string): string {
  return trimTrailingWhitespace(signature);
}

export function insertProjectAliasSignatureToken(input: {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}): { readonly nextValue: string; readonly nextCaret: number } {
  const nextValue =
    input.value.slice(0, input.selectionStart) +
    PROJECT_ALIAS_SIGNATURE_OPERATOR_FIRST_NAME_TOKEN +
    input.value.slice(input.selectionEnd);

  return {
    nextValue,
    nextCaret:
      input.selectionStart +
      PROJECT_ALIAS_SIGNATURE_OPERATOR_FIRST_NAME_TOKEN.length,
  };
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

  for (const match of signature.matchAll(SIGNATURE_TOKEN_PATTERN)) {
    const token = match[1];

    if (token !== undefined && !ALLOWED_SIGNATURE_TOKENS.has(token)) {
      return `Unknown signature token. Only ${PROJECT_ALIAS_SIGNATURE_OPERATOR_FIRST_NAME_TOKEN} is allowed.`;
    }
  }

  return null;
}
