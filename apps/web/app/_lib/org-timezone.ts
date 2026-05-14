/**
 * Locked organization timezone (Adventure Scientists is HQ'd in Bozeman, MT;
 * America/Denver covers all of Mountain Time including Bozeman). Source of
 * truth: docs/01-core/product-core.md.
 *
 * Use this in every operator-facing timestamp formatter. Do NOT hardcode
 * `timeZone: "UTC"` for display — that displays the UTC clock and confuses
 * operators reading their local inbox.
 */
export const ORG_TIMEZONE = "America/Denver";
