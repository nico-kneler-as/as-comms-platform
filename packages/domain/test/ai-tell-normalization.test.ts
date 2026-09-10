import { describe, expect, it } from "vitest";

import { normalizeAiTellCharacters } from "../src/ai-tell-normalization.js";

describe("normalizeAiTellCharacters", () => {
  it("normalizes only AI-tell characters and punctuation created by dash replacement", () => {
    expect(
      normalizeAiTellCharacters(
        "Use 2–4 samples — not 3—5, then “don't” and it’s ready,.",
      ),
    ).toBe("Use 2-4 samples, not 3-5, then \"don't\" and it's ready.");
  });

  it("drops a replacement comma before a closing parenthesis or end of text", () => {
    expect(normalizeAiTellCharacters("Details — )")).toBe("Details )");
    expect(normalizeAiTellCharacters("Details — ")).toBe("Details ");
  });

  // Regression: the replacement used to emit a bare "," so the unspaced forms
  // lost the following space and produced "schedule,we". The unspaced em dash
  // is the shape models actually emit, so this is the common case, not an edge.
  it("emits one comma and one space for every dash spacing variant", () => {
    const expected = "I checked the schedule, we can fit you in next week.";

    expect(
      normalizeAiTellCharacters(
        "I checked the schedule — we can fit you in next week.",
      ),
    ).toBe(expected);
    expect(
      normalizeAiTellCharacters(
        "I checked the schedule—we can fit you in next week.",
      ),
    ).toBe(expected);
    expect(
      normalizeAiTellCharacters(
        "I checked the schedule -- we can fit you in next week.",
      ),
    ).toBe(expected);
    expect(
      normalizeAiTellCharacters(
        "The policy -- long overdue -- takes effect now.",
      ),
    ).toBe("The policy, long overdue, takes effect now.");
  });

  it("is idempotent", () => {
    const once = normalizeAiTellCharacters(
      "Pickup is Tuesday—bring the ARU (hex 09452 — signed out), 2–4 kits.",
    );

    expect(normalizeAiTellCharacters(once)).toBe(once);
  });
});
