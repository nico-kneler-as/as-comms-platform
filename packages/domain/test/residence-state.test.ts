import { describe, expect, it } from "vitest";

import {
  residenceStateNames,
  residenceStateValues,
  type ResidenceStateCode,
} from "@as-comms/contracts";

import { normalizeStateOfResidence } from "../src/residence-state.js";

describe("state-of-residence normalization", () => {
  it.each<readonly [string, string | null | undefined, ResidenceStateCode | null]>([
    ["US code", "MT", "MT"],
    ["US name", "Montana", "MT"],
    ["trimmed US name", "montana ", "MT"],
    ["trailing comma", "Montana,", "MT"],
    ["comma-separated DC", "Washington, D.C.", "DC"],
    ["Washington", "Washington", "WA"],
    ["Oregon", "Oregon", "OR"],
    ["California", "California", "CA"],
    ["uppercase California", "CALIFORNIA", "CA"],
    ["Texas", "TEXAS", "TX"],
    ["Wyoming", "WYOMING", "WY"],
    ["Washington DC", "Washington DC", "DC"],
    ["punctuated DC code", "D.C.", "DC"],
    ["comma-separated DC", "Washington, D.C.", "DC"],
    ["District of Columbia", "District Of Columbia", "DC"],
    ["DC code", "DC", "DC"],
    ["Mass abbreviation", "MAss", "MA"],
    ["Mass abbreviation lowercase", "Mass", "MA"],
    ["California abbreviation", "calif", "CA"],
    ["Pennsylvania abbreviations", "penn", "PA"],
    ["Pennsylvania abbreviation", "penna", "PA"],
    ["Washington abbreviation", "wash", "WA"],
    ["Ontario", "Ontario", "ON"],
    ["Ontario code", "ON", "ON"],
    ["British Columbia code", "BC", "BC"],
    ["British Columbia", "British Columbia", "BC"],
    ["Quebec code", "QC", "QC"],
    ["Newfoundland and Labrador code", "NL", "NL"],
    ["Newfoundland alias", "newfoundland", "NL"],
    ["Labrador alias", "labrador", "NL"],
    ["Prince Edward Island", "Prince Edward Island", "PE"],
    ["Prince Edward Island abbreviation", "pei", "PE"],
    ["Northwest Territories abbreviation", "nwt", "NT"],
    ["Yukon alias", "yukon territory", "YT"],
    ["Puerto Rico code", "PR", "PR"],
    ["Puerto Rico", "Puerto Rico", "PR"],
    ["diacritic Quebec", "Québec", "QC"],
    ["NSW", "NSW", null],
    ["Queensland", "QUEENSLAND", null],
    ["Bali", "Bali", null],
    ["UK", "UK", null],
    ["London", "London", null],
    ["Kerala", "Kerala", null],
    ["Tokyo", "Tokyo", null],
    ["Western Australia", "Western Australia", null],
    ["Switzerland", "Switzerland", null],
    ["Canada", "Canada", null],
    ["punctuation", "-", null],
    ["period", ".", null],
    ["not applicable", "N/A", null],
    ["none", "none", null],
    ["empty", "", null],
    ["null", null, null],
  ])("normalizes %s", (_label, raw, expected) => {
    expect(normalizeStateOfResidence(raw)).toBe(expected);
  });

  it("round-trips every canonical code and display name", () => {
    for (const code of residenceStateValues) {
      expect(normalizeStateOfResidence(code)).toBe(code);
      expect(normalizeStateOfResidence(residenceStateNames[code])).toBe(code);
    }
  });
});
