import {
  containsHtmlTags,
  trimTrailingWhitespace,
} from "./plaintext-validation";

export const INTERNAL_NOTE_MAX_LENGTH = 10_000;

export function normalizeInternalNoteBody(body: string): string {
  return trimTrailingWhitespace(body);
}

export function getInternalNoteValidationError(body: string): string | null {
  const normalized = normalizeInternalNoteBody(body);

  if (normalized.trim().length === 0) {
    return "Note body is required.";
  }

  if (normalized.length > INTERNAL_NOTE_MAX_LENGTH) {
    return `Note body must be ${String(INTERNAL_NOTE_MAX_LENGTH)} characters or fewer.`;
  }

  if (containsHtmlTags(normalized)) {
    return "Note body must be plain text only.";
  }

  return null;
}
