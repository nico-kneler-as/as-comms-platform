import { describe, expect, it, vi } from "vitest";
import React, { createElement, type AnchorHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    readonly href: string;
  }) => createElement("a", { ...props, href }, children)
}));

import { IntegrationHealthBanner } from "../../app/inbox/_components/integration-health-banner";
import { buildInboxIntegrationHealthBannerViewModel } from "../../app/inbox/_lib/integration-health";
import type { IntegrationHealthRecord } from "@as-comms/contracts";

function buildHealthRecord(
  overrides: Partial<IntegrationHealthRecord>
): IntegrationHealthRecord {
  return {
    id: overrides.id ?? "gmail",
    serviceName: overrides.serviceName ?? overrides.id ?? "gmail",
    category: overrides.category ?? "messaging",
    status: overrides.status ?? "healthy",
    lastCheckedAt: overrides.lastCheckedAt ?? "2026-04-20T16:00:00.000Z",
    degradedSinceAt: overrides.degradedSinceAt ?? null,
    lastAlertSentAt: overrides.lastAlertSentAt ?? null,
    detail: overrides.detail ?? null,
    metadataJson: overrides.metadataJson ?? {},
    createdAt: overrides.createdAt ?? "2026-04-20T15:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-20T16:00:00.000Z"
  };
}

describe("Inbox integration health banner", () => {
  it("renders when an in-scope integration is degraded", () => {
    const banner = buildInboxIntegrationHealthBannerViewModel([
      buildHealthRecord({
        id: "gmail",
        serviceName: "gmail",
        status: "needs_attention"
      }),
      buildHealthRecord({
        id: "salesforce",
        serviceName: "salesforce",
        status: "healthy"
      })
    ]);

    const html = renderToStaticMarkup(
      <IntegrationHealthBanner banner={banner} />
    );

    expect(html).toContain("gmail integration is degraded");
    expect(html).toContain("Operators may not see new messages until resolved.");
    expect(html).toContain("href=\"/settings/integrations\"");
  });

  it("does not render when all in-scope integrations are healthy", () => {
    const banner = buildInboxIntegrationHealthBannerViewModel([
      buildHealthRecord({
        id: "gmail",
        serviceName: "gmail",
        status: "healthy"
      }),
      buildHealthRecord({
        id: "salesforce",
        serviceName: "salesforce",
        status: "healthy"
      }),
      buildHealthRecord({
        id: "mailchimp",
        serviceName: "mailchimp",
        status: "needs_attention"
      })
    ]);

    const html = renderToStaticMarkup(
      <IntegrationHealthBanner banner={banner} />
    );

    expect(banner).toBeNull();
    expect(html).toBe("");
  });
});
