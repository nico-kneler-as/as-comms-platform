export const PLAINTEXT_HTML_TAG_PATTERN = /<[^>]+>/u;
export const TRAILING_WHITESPACE_PATTERN = /[^\S\r\n]+$/gmu;

export function trimTrailingWhitespace(value: string): string {
  return value.replace(TRAILING_WHITESPACE_PATTERN, "");
}

export function containsHtmlTags(value: string): boolean {
  return PLAINTEXT_HTML_TAG_PATTERN.test(value);
}
