import type {
  CampaignKind,
  LaunchType,
  OrgSettingsRecord,
} from "@as-comms/contracts";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatBroadcastFromHeader(
  senderEmail: string,
  projectAlias: string | null,
): string {
  const trimmedAlias = projectAlias?.trim() ?? "";
  const displayName =
    trimmedAlias.length > 0
      ? `Adventure Scientists – ${trimmedAlias}`
      : "Adventure Scientists";
  return `"${displayName}" <${senderEmail}>`;
}

export function buildBroadcastPreheaderHtml(
  preheader: string | null,
): string {
  const trimmed = preheader?.trim() ?? "";
  if (trimmed.length === 0) {
    return "";
  }

  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:transparent;font-size:1px;line-height:1px;">${escapeHtml(trimmed)}</div>`;
}

export function buildPostmarkUnsubscribePlaceholderHtml(): string {
  return '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:transparent;font-size:1px;line-height:1px;">{{{ pm:unsubscribe }}}</div>';
}

export function buildBroadcastSignatureBlock(signature: string | null): {
  readonly text: string;
  readonly html: string;
} {
  const trimmed = signature?.trim() ?? "";
  if (trimmed.length === 0) {
    return {
      text: "",
      html: "",
    };
  }

  return {
    text: trimmed,
    html: `<p style="margin-top:16px;">${escapeHtml(trimmed).replaceAll("\n", "<br>")}</p>`,
  };
}

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

export function normalizeAliasEmail(value: string | null): string | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

export function buildBroadcastUnsubscribeUrls(input: {
  readonly appUrl: string;
  readonly unsubscribeToken: string;
}): { readonly scopedHref: string; readonly allHref: string } {
  const base = input.appUrl.replace(/\/+$/u, "");
  const encoded = encodeURIComponent(input.unsubscribeToken);
  return {
    scopedHref: `${base}/u/${encoded}`,
    allHref: `${base}/u/${encoded}/all`,
  };
}

export function buildBroadcastUnsubscribeFooter(input: {
  readonly kind: CampaignKind;
  readonly projectName: string | null;
  readonly projectAlias: string | null;
  readonly footerAddress: string | null;
  readonly scopedHref: string;
  readonly allHref: string;
}): {
  readonly html: string;
  readonly text: string;
} {
  const scopedLabel =
    input.kind === "newsletter"
      ? "Unsubscribe from the AS newsletter"
      : `Unsubscribe from ${input.projectAlias ?? input.projectName ?? "this project"} emails`;
  const allLabel = "Unsubscribe from all Adventure Scientists emails";
  const linkLabels =
    input.kind === "newsletter" ? [scopedLabel] : [scopedLabel, allLabel];
  const textLinks =
    input.kind === "newsletter"
      ? `${scopedLabel}: ${input.scopedHref}`
      : `${scopedLabel}: ${input.scopedHref}\n${allLabel}: ${input.allHref}`;
  const htmlLinks =
    input.kind === "newsletter"
      ? `<a href="${escapeHtml(input.scopedHref)}" target="_blank" rel="noreferrer noopener">${escapeHtml(scopedLabel)}</a>`
      : [
          `<a href="${escapeHtml(input.scopedHref)}" target="_blank" rel="noreferrer noopener">${escapeHtml(scopedLabel)}</a>`,
          `<a href="${escapeHtml(input.allHref)}" target="_blank" rel="noreferrer noopener">${escapeHtml(allLabel)}</a>`,
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
    text: [linkLabels.join(" · "), textLinks, input.footerAddress]
      .filter((part): part is string => part !== null && part.length > 0)
      .join("\n"),
  };
}

export interface BroadcastEmailRenderInput {
  readonly launchType: LaunchType;
  readonly kind: CampaignKind;
  readonly projectName: string | null;
  readonly projectAlias: string | null;
  readonly footerAddress: string | null;
  readonly preheader: string | null;
  readonly bodyHtmlTemplate: string;
  readonly bodyTextTemplate: string;
  readonly signature: string | null;
  readonly scopedUnsubscribeHref: string;
  readonly allUnsubscribeHref: string;
  readonly senderEmail: string;
  readonly webVersionHref?: string | null;
}

export interface BroadcastEmailRenderOutput {
  readonly fromHeader: string;
  readonly bodyHtml: string;
  readonly bodyText: string;
  readonly listUnsubscribeHeaderValue: string;
}

/**
 * Removes the in-canvas locked footer block the HTML composer injects into the
 * Unlayer canvas. The worker's renderBroadcastEmail appends the authoritative
 * footer via buildBroadcastUnsubscribeFooter regardless; without this dedup pass,
 * html_email broadcasts would ship with two footers. Safe to apply unconditionally
 * — if the markers aren't present (normal_email broadcasts), the function is a
 * no-op.
 */
export function stripLockedFooterBlock(html: string): string {
  return html.replace(
    /<!--\s*as-locked-footer-start\s*-->[\s\S]*?<!--\s*as-locked-footer-end\s*-->/giu,
    "",
  );
}

export function renderBroadcastEmail(
  input: BroadcastEmailRenderInput,
): BroadcastEmailRenderOutput {
  const fromHeader = formatBroadcastFromHeader(
    input.senderEmail,
    input.projectAlias,
  );
  const preheaderHtml = buildBroadcastPreheaderHtml(input.preheader);
  const signatureBlock =
    input.launchType === "html_email"
      ? { text: "", html: "" }
      : buildBroadcastSignatureBlock(input.signature);
  const footer = buildBroadcastUnsubscribeFooter({
    kind: input.kind,
    projectName: input.projectName,
    projectAlias: input.projectAlias,
    footerAddress: input.footerAddress,
    scopedHref: input.scopedUnsubscribeHref,
    allHref: input.allUnsubscribeHref,
  });
  const sanitizedBodyHtml = stripLockedFooterBlock(input.bodyHtmlTemplate);
  const webVersionHref = input.webVersionHref?.trim() ?? "";
  const webVersionHtml =
    webVersionHref.length === 0
      ? ""
      : `<div style="text-align:center;font-size:12px;line-height:1.6;color:#64748b;padding:8px 0 12px;">Having trouble viewing this email? <a href="${escapeHtml(webVersionHref)}" target="_blank" rel="noreferrer noopener" style="color:#64748b;text-decoration:underline;">View it in your browser</a>.</div>`;
  const bodyText = [input.bodyTextTemplate, signatureBlock.text, footer.text]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");

  return {
    fromHeader,
    bodyHtml: `${preheaderHtml}${webVersionHtml}${sanitizedBodyHtml}${signatureBlock.html}${footer.html}`,
    bodyText:
      webVersionHref.length === 0
        ? bodyText
        : `View in browser: ${webVersionHref}\n\n${bodyText}`,
    listUnsubscribeHeaderValue: `<${input.scopedUnsubscribeHref}>`,
  };
}
