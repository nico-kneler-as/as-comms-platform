import { describe, expect, it } from "vitest";

import {
  computeContentFingerprint,
  computePendingComposerOutboundFingerprint,
  normalizeContentFingerprintSubject
} from "../src/outbound-email-dedup.js";

describe("content fingerprint helpers", () => {
  it("normalizes reply, arrow, and external subject prefixes", () => {
    expect(
      normalizeContentFingerprintSubject(
        "[External Email] Re: ARU pickup details"
      )
    ).toBe("aru pickup details");
    expect(
      normalizeContentFingerprintSubject("→ Email: Re: ARU pickup details")
    ).toBe("aru pickup details");
    expect(
      normalizeContentFingerprintSubject("FW:   ARU pickup details")
    ).toBe("aru pickup details");
  });

  it("uses the occurredAt minute bucket in the fingerprint input", () => {
    const first = computeContentFingerprint({
      subject: "ARU pickup details",
      occurredAt: "2026-04-20T21:27:03.000Z",
      contactId: "contact_1",
      channel: "email",
      direction: "outbound",
      previewText: "Thanks again. Your ARU pickup details are all set."
    });
    const second = computeContentFingerprint({
      subject: "ARU pickup details",
      occurredAt: "2026-04-20T21:27:41.000Z",
      contactId: "contact_1",
      channel: "email",
      direction: "outbound",
      previewText: "Thanks again. Your ARU pickup details are all set."
    });
    const third = computeContentFingerprint({
      subject: "ARU pickup details",
      occurredAt: "2026-04-20T21:28:01.000Z",
      contactId: "contact_1",
      channel: "email",
      direction: "outbound",
      previewText: "Thanks again. Your ARU pickup details are all set."
    });

    expect(first).toBe(second);
    expect(third).not.toBe(first);
  });

  it("keeps distinct same-subject messages apart when the preview text differs", () => {
    const first = computeContentFingerprint({
      subject: "Re: Hex 12345",
      occurredAt: "2026-04-20T21:27:03.000Z",
      contactId: "contact_1",
      channel: "email",
      direction: "outbound",
      previewText: "First draft with the pickup link and meeting notes."
    });
    const second = computeContentFingerprint({
      subject: "Re: Hex 12345",
      occurredAt: "2026-04-20T21:27:45.000Z",
      contactId: "contact_1",
      channel: "email",
      direction: "outbound",
      previewText:
        "Second draft with a different call to action and follow-up wording."
    });

    expect(first).not.toBe(second);
  });

  it("keeps the pending composer fingerprint aligned with Gmail outbound ingest", () => {
    const pending = computePendingComposerOutboundFingerprint({
      contactId: "contact_1",
      subject: "Re: Field logistics",
      bodyPlaintext:
        "Thanks again.\n\nWe are all set for the field logistics follow-up.",
      sentAt: "2026-04-20T21:27:41.000Z"
    });
    const gmailIngested = computeContentFingerprint({
      subject: "Re: Field logistics",
      occurredAt: "2026-04-20T21:27:12.000Z",
      contactId: "contact_1",
      channel: "email",
      direction: "outbound",
      previewText:
        "Thanks again.\n\nWe are all set for the field logistics follow-up."
    });

    expect(pending).toBe(gmailIngested);
  });
});
