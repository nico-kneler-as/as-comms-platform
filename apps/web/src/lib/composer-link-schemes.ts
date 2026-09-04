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

/**
 * Automated email accepts a narrower set than the composer: renderAutomatedEmail
 * throws `invalid_link` on anything that is not http, https or mailto, and a
 * template carrying an `sms:` or `tel:` link cannot preview or send at all.
 * The editor must not let one be inserted in the first place.
 *
 * `automated-email-link-schemes.test.ts` checks this list against the renderer
 * itself, so the two cannot drift.
 */
export const AUTOMATED_EMAIL_LINK_SCHEMES = ["http", "https", "mailto"] as const;

export const AUTOMATED_EMAIL_LINK_SCHEME_PREFIXES_REGEX =
  /^(https?:\/\/|mailto:)/iu;

export function isAllowedAutomatedEmailLinkHref(
  value: string | null | undefined,
): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    AUTOMATED_EMAIL_LINK_SCHEME_PREFIXES_REGEX.test(trimmed)
  );
}

/**
 * Tiptap calls this through `isAllowedUri` with whatever the mark carries, and
 * a link mark whose `attrs` were lost has no href at all — so this receives
 * `null` at runtime despite the parameter type. Guarding here turns an
 * unopenable editor page into a link that simply fails validation.
 */
export function isAllowedComposerLinkHref(value: string | null | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  return (
    trimmed.length > 0 && COMPOSER_LINK_SCHEME_PREFIXES_REGEX.test(trimmed)
  );
}
