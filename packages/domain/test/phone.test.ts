import { describe, expect, it } from "vitest";

import {
  normalizePhoneE164,
  parseAreaCode,
  PhoneE164NormalizationError,
  toE164,
  tryNormalizePhoneE164,
} from "../src/phone.js";

describe("phone normalization", () => {
  it.each([
    ["US local", "(406) 555-0142", undefined, "+14065550142"],
    ["US international", "+14065550142", undefined, "+14065550142"],
    ["formatted with dashes", "406-555-0142", undefined, "+14065550142"],
    ["leading one", "1-774-368-0124", undefined, "+17743680124"],
    ["malformed input", "not a phone", undefined, null],
    ["foreign explicit region", "020 7946 0018", "GB", "+442079460018"],
  ])("%s", (_label, input, region, expected) => {
    expect(toE164(input, region)).toBe(expected);
  });

  it.each([
    ["raw 10-digit", "7743680124", "+17743680124"],
    ["formatted", "(774) 368-0124", "+17743680124"],
    ["leading one", "17743680124", "+17743680124"],
    ["already e164", "+17743680124", "+17743680124"],
  ])("normalizes %s", (_label, input, expected) => {
    expect(normalizePhoneE164(input)).toBe(expected);
  });

  it.each([
    ["empty string", ""],
    ["whitespace", "   "],
    ["leading zeros", "07743680124"],
    ["too long", "1774368012400"],
    ["garbage", "not a phone"],
  ])("returns null for %s", (_label, input) => {
    expect(tryNormalizePhoneE164(input)).toBeNull();
  });

  it("throws a typed error when strict normalization fails", () => {
    expect(() => normalizePhoneE164("not a phone")).toThrow(
      PhoneE164NormalizationError,
    );
  });

  it.each([
    ["+14065550142", "406"],
    ["+442079460018", null],
  ])("parses NANP area code from %s", (input, expected) => {
    expect(parseAreaCode(input)).toBe(expected);
  });
});
