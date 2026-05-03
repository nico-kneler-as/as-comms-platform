import { describe, expect, it } from "vitest";

import { parseAreaCode, toE164 } from "../src/phone.js";

describe("phone normalization", () => {
  it.each([
    ["US local", "(406) 555-0142", undefined, "+14065550142"],
    ["US international", "+14065550142", undefined, "+14065550142"],
    ["formatted with dashes", "406-555-0142", undefined, "+14065550142"],
    ["malformed input", "not a phone", undefined, null],
    ["foreign explicit region", "020 7946 0018", "GB", "+442079460018"],
  ])("%s", (_label, input, region, expected) => {
    expect(toE164(input, region)).toBe(expected);
  });

  it.each([
    ["+14065550142", "406"],
    ["+442079460018", null],
  ])("parses NANP area code from %s", (input, expected) => {
    expect(parseAreaCode(input)).toBe(expected);
  });
});
