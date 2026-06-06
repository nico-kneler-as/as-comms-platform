import type {
  CampaignKind,
  OrgSettingsRecord,
} from "@as-comms/contracts";
import {
  buildPostmarkUnsubscribePlaceholderHtml,
  escapeHtml,
} from "@as-comms/domain";

export function formatOrgAddress(input: OrgSettingsRecord): string | null {
  const line1 = input.physicalAddressLine1.trim();
  const line2 = input.physicalAddressLine2.trim();
  const city = input.physicalCity.trim();
  const state = input.physicalState.trim();
  const zip = input.physicalZip.trim();
  const country = input.physicalCountry.trim();
  const cityLine = [city, state, zip].filter((part) => part.length > 0).join(", ");
  const parts = [line1, line2, cityLine, country].filter((part) => part.length > 0);
  return parts.length === 0 ? null : parts.join(" • ");
}

export function buildCampaignFooterPreview(input: {
  readonly kind: CampaignKind;
  readonly projectName: string | null;
  readonly projectAlias: string | null;
  readonly footerAddress: string | null;
  readonly origin: string;
}): {
  readonly html: string;
  readonly text: string;
} {
  const scopedLabel =
    input.kind === "newsletter"
      ? "Unsubscribe from the AS newsletter"
      : `Unsubscribe from ${input.projectAlias ?? input.projectName ?? "this project"} emails`;
  const scopedHref = `${input.origin}/u/preview-${input.kind}`;
  const allHref = `${input.origin}/u/preview-all`;
  const linkLabels =
    input.kind === "newsletter"
      ? [scopedLabel]
      : [scopedLabel, "Unsubscribe from all Adventure Scientists emails"];
  const textLinks =
    input.kind === "newsletter"
      ? `${scopedLabel}: ${scopedHref}`
      : `${scopedLabel}: ${scopedHref}\nUnsubscribe from all Adventure Scientists emails: ${allHref}`;
  const htmlLinks =
    input.kind === "newsletter"
      ? `<a href="${escapeHtml(scopedHref)}" target="_blank" rel="noreferrer noopener">${escapeHtml(scopedLabel)}</a>`
      : [
          `<a href="${escapeHtml(scopedHref)}" target="_blank" rel="noreferrer noopener">${escapeHtml(scopedLabel)}</a>`,
          `<a href="${escapeHtml(allHref)}" target="_blank" rel="noreferrer noopener">Unsubscribe from all Adventure Scientists emails</a>`,
        ].join(" &middot; ");

  return {
    html: [
      '<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 16px;">',
      `<div style="color:#64748b;font-size:12px;line-height:1.6;">${htmlLinks}</div>`,
      input.footerAddress === null
        ? ""
        : `<div style="color:#64748b;font-size:12px;line-height:1.6;margin-top:8px;">${escapeHtml(input.footerAddress)}</div>`,
      buildPostmarkUnsubscribePlaceholderHtml(),
    ].join(""),
    text: [linkLabels.join(" · "), textLinks, input.footerAddress].filter(Boolean).join("\n"),
  };
}

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
