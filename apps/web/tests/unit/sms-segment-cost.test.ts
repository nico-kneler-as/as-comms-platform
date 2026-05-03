import { describe, expect, it } from "vitest";

import {
  estimateSmsCostUsd,
  formatSmsEstimatedCostUsd,
} from "../../src/lib/sms-pricing";

describe("sms pricing", () => {
  it("treats zero segments as no cost", () => {
    expect(estimateSmsCostUsd(0, 0.0079)).toBe(0);
  });

  it("computes one segment at the default Twilio rate", () => {
    expect(formatSmsEstimatedCostUsd(estimateSmsCostUsd(1, 0.0079))).toBe(
      "0.0079",
    );
  });

  it("computes multiple segments at the default Twilio rate", () => {
    expect(formatSmsEstimatedCostUsd(estimateSmsCostUsd(4, 0.0079))).toBe(
      "0.0316",
    );
  });

  it("uses a custom per-segment rate when configured", () => {
    expect(formatSmsEstimatedCostUsd(estimateSmsCostUsd(3, 0.0125))).toBe(
      "0.0375",
    );
  });
});
