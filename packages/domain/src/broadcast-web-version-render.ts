import type { CampaignKind, LaunchType } from "@as-comms/contracts";

import {
  buildBroadcastSignatureBlock,
  escapeHtml,
  stripLockedFooterBlock,
} from "./broadcast-email-render.js";
import { createMergeRenderer } from "./merge-renderer.js";

export function buildBroadcastWebVersionUrl(input: {
  readonly appUrl: string;
  readonly token: string;
}): string {
  return `${input.appUrl.replace(/\/+$/u, "")}/b/${encodeURIComponent(input.token)}`;
}

export interface BroadcastWebVersionRenderInput {
  readonly launchType: LaunchType;
  readonly kind: CampaignKind;
  readonly subject: string;
  readonly bodyHtmlTemplate: string;
  readonly projectName: string | null;
  readonly projectAlias: string | null;
  readonly senderEmail: string;
  readonly signature: string | null;
  readonly footerAddress: string | null;
  readonly pageUrl: string;
  readonly subscribeUrl: string;
}

function removePostmarkUnsubscribePlaceholder(html: string): string {
  return html.replace(/\{\{\{\s*pm\s*:\s*unsubscribe\s*\}\}\}/giu, "");
}

function buildFooter(input: BroadcastWebVersionRenderInput): string {
  const address = input.footerAddress?.trim() ?? "";
  const subscribe =
    input.kind === "newsletter"
      ? `<div style="color:#64748b;font-size:12px;line-height:1.6;margin-top:8px;"><a href="${escapeHtml(input.subscribeUrl)}" target="_blank" rel="noreferrer noopener">Subscribe to the Adventure Scientists newsletter</a></div>`
      : "";
  const addressHtml =
    address.length === 0
      ? ""
      : `<div style="color:#64748b;font-size:12px;line-height:1.6;">${escapeHtml(address)}</div>`;
  return `<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 16px;">${addressHtml}${subscribe}`;
}

function injectBeforeBodyClose(html: string, content: string): string {
  if (/<\/body\s*>/iu.test(html)) {
    return html.replace(/<\/body\s*>/iu, `${content}</body>`);
  }
  return `${html}${content}`;
}

function setDocumentTitle(html: string, title: string): string {
  const titleTag = `<title>${escapeHtml(title)}</title>`;
  if (/<title\b[^>]*>[\s\S]*?<\/title\s*>/iu.test(html)) {
    return html.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/iu, titleTag);
  }
  if (/<head\b[^>]*>/iu.test(html)) {
    return html.replace(/<head\b[^>]*>/iu, (head) => `${head}${titleTag}`);
  }
  return `${titleTag}${html}`;
}

function addViewport(html: string): string {
  if (/<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/iu.test(html)) {
    return html;
  }
  const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1">';
  if (/<head\b[^>]*>/iu.test(html)) {
    return html.replace(/<head\b[^>]*>/iu, (head) => `${head}${viewport}`);
  }
  return `${viewport}${html}`;
}

export function renderBroadcastWebVersion(
  input: BroadcastWebVersionRenderInput,
): { readonly html: string; readonly title: string } {
  const renderer = createMergeRenderer();
  const merged = renderer.render(
    {
      subject: input.subject,
      bodyHtml: removePostmarkUnsubscribePlaceholder(
        stripLockedFooterBlock(input.bodyHtmlTemplate),
      ),
      bodyText: "",
    },
    {
      firstName: "friend",
      projectName: input.projectName,
      aliasEmail: input.senderEmail,
      viewInBrowserUrl: input.pageUrl,
    },
  );
  const title =
    merged.subject.trim().length === 0 ? "Adventure Scientists" : merged.subject;
  const signature =
    input.launchType === "normal_email"
      ? buildBroadcastSignatureBlock(input.signature).html
      : "";
  const appended = `${signature}${buildFooter(input)}`;
  const body = removePostmarkUnsubscribePlaceholder(merged.html);

  if (/<html\b/iu.test(body)) {
    return {
      html: addViewport(setDocumentTitle(injectBeforeBodyClose(body, appended), title)),
      title,
    };
  }

  return {
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#f1f5f9;font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#0f172a"><div style="max-width:640px;margin:0 auto;background:#fff;padding:24px;">${body}${appended}</div></body></html>`,
    title,
  };
}
