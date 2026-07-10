import { describe, expect, it } from "vitest";

import { classifyBroadcastActivity } from "../src/broadcast-activity-classifier.js";

const FAR_DELIVERED_AT = "2026-07-10T12:00:00.000Z";
const FAR_OCCURRED_AT = "2026-07-10T12:10:00.000Z";

function buildInput(
  overrides: Partial<Parameters<typeof classifyBroadcastActivity>[0]> = {},
): Parameters<typeof classifyBroadcastActivity>[0] {
  return {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    platform: "Desktop",
    deliveredAt: FAR_DELIVERED_AT,
    occurredAt: FAR_OCCURRED_AT,
    ...overrides,
  };
}

describe("classifyBroadcastActivity", () => {
  it("classifies representative machine user agents as machine_user_agent", () => {
    const machineUserAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Microsoft Office/16.0 (Microsoft Outlook 16.0.17029; ProPlus) SafeLinks",
      "Proofpoint URL Defense Service / urldefense",
      "Mozilla/5.0 (compatible; Mimecast Image Analyzer)",
      "Barracuda Sentinel Link Protect",
      "GoogleImageProxy",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "curl/8.7.1",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36",
      "python-requests/2.32.3",
    ];

    for (const userAgent of machineUserAgents) {
      expect(
        classifyBroadcastActivity(buildInput({ userAgent })),
        userAgent,
      ).toEqual({
        isBot: true,
        reason: "machine_user_agent",
      });
    }
  });

  it("matches machine user agents case-insensitively", () => {
    expect(
      classifyBroadcastActivity(
        buildInput({
          userAgent: "MOZILLA/5.0 SAFELINKS",
        }),
      ),
    ).toEqual({
      isBot: true,
      reason: "machine_user_agent",
    });

    expect(
      classifyBroadcastActivity(
        buildInput({
          userAgent: "PyThOn-ReQuEsTs/2.32.3",
        }),
      ),
    ).toEqual({
      isBot: true,
      reason: "machine_user_agent",
    });
  });

  it("keeps representative human user agents classified as human", () => {
    const humanUserAgents = [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.122 Mobile Safari/537.36 Gmail/2024.06.23.645612345.Release",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; Outlook 16.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    ];

    for (const userAgent of humanUserAgents) {
      expect(
        classifyBroadcastActivity(buildInput({ userAgent })),
        userAgent,
      ).toEqual({
        isBot: false,
        reason: null,
      });
    }
  });

  it("classifies near-instant activity as fast_activity at and under the threshold", () => {
    expect(
      classifyBroadcastActivity(
        buildInput({
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
          deliveredAt: "2026-07-10T12:00:00.000Z",
          occurredAt: "2026-07-10T12:00:00.500Z",
        }),
      ),
    ).toEqual({
      isBot: true,
      reason: "fast_activity",
    });

    expect(
      classifyBroadcastActivity(
        buildInput({
          userAgent: null,
          deliveredAt: "2026-07-10T12:00:00.000Z",
          occurredAt: "2026-07-10T12:00:02.000Z",
        }),
      ),
    ).toEqual({
      isBot: true,
      reason: "fast_activity",
    });
  });

  it("does not classify activity over the threshold as fast", () => {
    expect(
      classifyBroadcastActivity(
        buildInput({
          deliveredAt: "2026-07-10T12:00:00.000Z",
          occurredAt: "2026-07-10T12:00:02.001Z",
        }),
      ),
    ).toEqual({
      isBot: false,
      reason: null,
    });

    expect(
      classifyBroadcastActivity(
        buildInput({
          deliveredAt: "2026-07-10T12:00:00.000Z",
          occurredAt: "2026-07-10T12:05:00.000Z",
        }),
      ),
    ).toEqual({
      isBot: false,
      reason: null,
    });
  });

  it("does not fire the fast signal when timing inputs are missing, reversed, or invalid", () => {
    expect(
      classifyBroadcastActivity(
        buildInput({
          deliveredAt: null,
          occurredAt: "2026-07-10T12:00:00.500Z",
        }),
      ),
    ).toEqual({
      isBot: false,
      reason: null,
    });

    expect(
      classifyBroadcastActivity(
        buildInput({
          deliveredAt: "2026-07-10T12:00:01.000Z",
          occurredAt: "2026-07-10T12:00:00.500Z",
        }),
      ),
    ).toEqual({
      isBot: false,
      reason: null,
    });

    expect(
      classifyBroadcastActivity(
        buildInput({
          deliveredAt: "not-a-date",
          occurredAt: "2026-07-10T12:00:00.500Z",
        }),
      ),
    ).toEqual({
      isBot: false,
      reason: null,
    });

    expect(
      classifyBroadcastActivity(
        buildInput({
          deliveredAt: "2026-07-10T12:00:00.000Z",
          occurredAt: "not-a-date",
        }),
      ),
    ).toEqual({
      isBot: false,
      reason: null,
    });
  });

  it("prefers machine_user_agent when both signals fire", () => {
    expect(
      classifyBroadcastActivity(
        buildInput({
          userAgent: "Slackbot-LinkExpanding 1.0",
          deliveredAt: "2026-07-10T12:00:00.000Z",
          occurredAt: "2026-07-10T12:00:00.500Z",
        }),
      ),
    ).toEqual({
      isBot: true,
      reason: "machine_user_agent",
    });
  });

  it("does not treat null or blank user agents as machine matches", () => {
    expect(classifyBroadcastActivity(buildInput({ userAgent: null }))).toEqual({
      isBot: false,
      reason: null,
    });

    expect(classifyBroadcastActivity(buildInput({ userAgent: "" }))).toEqual({
      isBot: false,
      reason: null,
    });

    expect(classifyBroadcastActivity(buildInput({ userAgent: "   " }))).toEqual(
      {
        isBot: false,
        reason: null,
      },
    );
  });

  it("behaves the same for Date objects and ISO strings", () => {
    const dateInput = buildInput({
      userAgent: null,
      deliveredAt: new Date("2026-07-10T12:00:00.000Z"),
      occurredAt: new Date("2026-07-10T12:00:00.500Z"),
    });
    const stringInput = buildInput({
      userAgent: null,
      deliveredAt: "2026-07-10T12:00:00.000Z",
      occurredAt: "2026-07-10T12:00:00.500Z",
    });

    expect(classifyBroadcastActivity(dateInput)).toEqual(
      classifyBroadcastActivity(stringInput),
    );
  });
});
