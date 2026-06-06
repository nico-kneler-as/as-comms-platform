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
