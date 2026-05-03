import { describe, expect, it } from "vitest";

import { smsMetrics } from "../src/sms-segments.js";

describe("smsMetrics", () => {
  it("returns zero segments for an empty message", () => {
    expect(smsMetrics("")).toEqual({
      encoding: "GSM-7",
      length: 0,
      segments: 0,
      segmentCap: 160,
      remaining: 160,
    });
  });

  it("keeps 160 GSM-7 characters in one segment", () => {
    expect(smsMetrics("a".repeat(160))).toMatchObject({
      encoding: "GSM-7",
      length: 160,
      segments: 1,
      segmentCap: 160,
      remaining: 0,
    });
  });

  it("splits 161 GSM-7 characters into two segments", () => {
    expect(smsMetrics("a".repeat(161))).toMatchObject({
      encoding: "GSM-7",
      length: 161,
      segments: 2,
      segmentCap: 153,
      remaining: 145,
    });
  });

  it("keeps 70 Unicode characters including emoji in one segment", () => {
    expect(smsMetrics(`${"a".repeat(69)}😀`)).toMatchObject({
      encoding: "Unicode",
      length: 70,
      segments: 1,
      segmentCap: 70,
      remaining: 0,
    });
  });

  it("splits 71 Unicode characters into two segments", () => {
    expect(smsMetrics(`${"a".repeat(70)}😀`)).toMatchObject({
      encoding: "Unicode",
      length: 71,
      segments: 2,
      segmentCap: 67,
      remaining: 63,
    });
  });

  it("uses 153 character caps after the GSM-7 multi-segment threshold", () => {
    expect(smsMetrics("a".repeat(306))).toMatchObject({
      encoding: "GSM-7",
      length: 306,
      segments: 2,
      segmentCap: 153,
      remaining: 0,
    });
  });
});
