/**
 * Accepted URL schemes for composer link marks.
 *
 * Used by:
 * - `promptForLinkUrl` (composer toolbar) to validate operator input.
 * - `isAllowedHref` (html-sanitizer) to gate hrefs through persistence and
 *   outbound rendering.
 * - `Link.configure({ protocols })` (Tiptap) to let the link mark accept
 *   `sms:` / `tel:` at insertion time.
 */
export const COMPOSER_LINK_SCHEMES = [
  "http",
  "https",
  "mailto",
  "sms",
  "tel",
] as const;

export const COMPOSER_LINK_SCHEME_PREFIXES_REGEX =
  /^(https?:\/\/|mailto:|sms:|tel:)/iu;

export function isAllowedComposerLinkHref(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 && COMPOSER_LINK_SCHEME_PREFIXES_REGEX.test(trimmed)
  );
}
