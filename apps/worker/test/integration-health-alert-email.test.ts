/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { describe, expect, it, vi } from "vitest";

import type * as IntegrationsModule from "@as-comms/integrations";

const sendGmailMessage = vi.hoisted(() => vi.fn());

vi.mock("@as-comms/integrations", async (importOriginal) => {
  const actual = await importOriginal<typeof IntegrationsModule>();

  return {
    ...actual,
    sendGmailMessage,
  };
});

import { createIntegrationHealthAlertSender } from "../src/jobs/integration-health/email.js";

describe("integration health alert email", () => {
  it("sends the configured alert email through the shared Gmail sender", async () => {
    sendGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-id",
      gmailThreadId: "gmail-thread-id",
      rfc822MessageId: "<alert@example.test>"
    });

    const sender = createIntegrationHealthAlertSender(
      {
        GMAIL_LIVE_ACCOUNT: "volunteers@adventurescientists.org",
        GMAIL_GOOGLE_OAUTH_CLIENT_ID: "client-id",
        GMAIL_GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
        GMAIL_GOOGLE_OAUTH_REFRESH_TOKEN: "refresh-token",
        INTEGRATION_HEALTH_ALERT_RECIPIENT: "ops@example.test",
        INTEGRATION_HEALTH_ALERT_FROM_ALIAS: "alerts@example.test",
        INBOX_REVALIDATE_BASE_URL: "https://comms.example.test"
      },
      vi.fn() as unknown as typeof fetch
    );

    const result = await sender.send({
      service: "gmail",
      fromStatus: "healthy",
      occurredAt: "2026-04-20T16:00:00.000Z",
      record: {
        id: "gmail",
        serviceName: "gmail",
        category: "messaging",
        status: "needs_attention",
        lastCheckedAt: "2026-04-20T16:00:00.000Z",
        degradedSinceAt: null,
        lastAlertSentAt: null,
        detail: "OAuth token expired.",
        metadataJson: {
          checkedAt: "2026-04-20T16:00:00.000Z",
          reason: "invalid_grant"
        },
        createdAt: "2026-04-20T15:00:00.000Z",
        updatedAt: "2026-04-20T16:00:00.000Z"
      }
    });

    expect(result).toMatchObject({ kind: "success" });
    expect(sendGmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        fromAlias: "alerts@example.test",
        to: "ops@example.test",
        subject: "[AS Comms] gmail integration degraded — needs_attention",
        bodyPlaintext: expect.stringContaining(
          "gmail status flipped from healthy to needs_attention at 2026-04-20T16:00:00.000Z."
        ),
        bodyHtml: expect.stringContaining(
          "https://comms.example.test/settings/integrations"
        ),
        attachments: []
      }),
      expect.objectContaining({
        liveAccount: "volunteers@adventurescientists.org",
        oauthClient: expect.objectContaining({
          clientId: "client-id",
          clientSecret: "client-secret"
        }),
        oauthRefreshToken: "refresh-token"
      })
    );
    expect(sendGmailMessage.mock.calls[0]?.[0].bodyPlaintext).toContain(
      '"reason": "invalid_grant"'
    );
  });
});
