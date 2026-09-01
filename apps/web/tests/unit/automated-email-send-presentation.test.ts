import { describe, expect, it } from "vitest";

import {
  AUTOMATED_EMAIL_SEND_STATUS_META,
  formatAutomatedEmailSendReason,
} from "../../src/lib/automated-email-send-presentation";

describe("automated email send presentation", () => {
  it("gives every durable send status an operator-facing label and tone", () => {
    expect(AUTOMATED_EMAIL_SEND_STATUS_META).toEqual({
      received: { label: "Processing", tone: "slate" },
      sent: { label: "Sent", tone: "emerald" },
      duplicate: { label: "Duplicate", tone: "slate" },
      held: { label: "Held", tone: "amber" },
      failed: { label: "Failed", tone: "rose" },
    });
  });

  it("translates worker reason codes without leaking their implementation form", () => {
    expect(formatAutomatedEmailSendReason("inactive_dry_run")).toBe(
      "inactive (dry run)",
    );
    expect(formatAutomatedEmailSendReason("missing_required:projectName")).toBe(
      "missing: projectName",
    );
    expect(formatAutomatedEmailSendReason("postmark_rejected")).toBe(
      "Postmark rejected this email",
    );
    expect(formatAutomatedEmailSendReason("future_internal_code")).toBe(
      "unrecognized delivery issue",
    );
    expect(formatAutomatedEmailSendReason(null)).toBe("—");
  });
});
