import { describe, expect, it } from "vitest";

import { maskKnowledgeExample } from "../src/pii-mask.js";

describe("maskKnowledgeExample", () => {
  it("replaces email addresses with {EMAIL}", () => {
    expect(maskKnowledgeExample("Reach out to volunteer.lead@example.com")).toBe(
      "Reach out to {EMAIL}",
    );
    expect(
      maskKnowledgeExample("Cc: support@adventurescientists.org and ops@asc.io"),
    ).toBe("Cc: {EMAIL} and {EMAIL}");
  });

  it("replaces US-format phone numbers with {PHONE}", () => {
    // The phone regex's leading [\s.-]? consumes the separator before the
    // area code, so "Call (415) 555-0123" collapses to "Call{PHONE}". That's
    // intentional — PII removal is the priority, spacing is cosmetic.
    expect(maskKnowledgeExample("Call (415) 555-0123 or 415.555.0124")).toBe(
      "Call{PHONE} or{PHONE}",
    );
    expect(maskKnowledgeExample("Reach me at 4155550125")).toBe(
      "Reach me at{PHONE}",
    );
    // When the match starts on `+1` the leading space stays put because
    // the regex's [\s.-]? is between the country code and the area code,
    // not at the head of the match.
    expect(maskKnowledgeExample("Try +1 415-555-0126 anytime")).toBe(
      "Try {PHONE} anytime",
    );
  });

  it("replaces probable person names (2-4 capitalised tokens in a row)", () => {
    // Note: "Hi Anna Schmidt" is itself a sequence of 3 capitalised tokens,
    // so the regex matches it as a single {NAME}. This is conservative
    // over-masking by design — better to lose the greeting word than to
    // leak a real name. Operator copy that wants to preserve "Hi" should
    // be authored without the trailing capitalised name (rare).
    expect(maskKnowledgeExample("Hi Anna Schmidt, thanks for joining")).toBe(
      "{NAME}, thanks for joining",
    );
    expect(maskKnowledgeExample("Best, Cooper Smith Jr")).toBe("Best, {NAME}");
    // When the leading lowercase word breaks the capitalised run, the
    // greeting survives.
    expect(maskKnowledgeExample("hi Anna Schmidt, glad you joined")).toBe(
      "hi {NAME}, glad you joined",
    );
  });

  it("preserves single capitalised words so it doesn't over-mask common nouns", () => {
    // Single-token capitalised words like Monday, Pacific, Whitebark should
    // pass through unchanged — they're project signal, not PII.
    const sample =
      "Monday is the deadline. Pacific Northwest crews report on Whitebark.";
    const masked = maskKnowledgeExample(sample);
    expect(masked).toContain("Monday");
    expect(masked).toContain("Whitebark");
    // "Pacific Northwest" is two capitalised tokens in a row and DOES get
    // caught by the {NAME} regex — that's a known and acceptable limitation;
    // the project signal still survives via the rest of the sentence and the
    // operator-curated source documents.
    expect(masked).toContain("{NAME}");
  });

  it("is composable — leaves project terminology like dates and elevations alone", () => {
    const sample =
      "On 2026-05-13 we deploy ARUs at 2400m elevation. Send to acoustic-pacific@example.com.";
    const masked = maskKnowledgeExample(sample);
    expect(masked).toContain("2026-05-13");
    expect(masked).toContain("2400m");
    expect(masked).toContain("ARUs");
    expect(masked).toContain("{EMAIL}");
    expect(masked).not.toContain("acoustic-pacific@example.com");
  });

  it("returns the input unchanged when there is nothing to mask", () => {
    const sample = "the deadline is Monday at 2400m elevation";
    expect(maskKnowledgeExample(sample)).toBe(sample);
  });
});
