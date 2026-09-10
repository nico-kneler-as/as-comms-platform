import { describe, expect, it } from "vitest";

import { applyStylePass } from "../../../src/server/ai/style-pass";

const emailOptions = { targetChars: 600, ceilingChars: 900 } as const;

describe("applyStylePass", () => {
  it("normalizes every character substitution without changing numeric ranges", () => {
    const result = applyStylePass(
      "Plan 2–4 short paragraphs — then 10–15 minutes, “quoted” and don’t wait.",
      emailOptions,
    );

    expect(result.text).toBe(
      'Plan 2-4 short paragraphs, then 10-15 minutes, "quoted" and don\'t wait.',
    );
    expect(result.violations).toEqual([
      { category: "en_dash", detail: "–", autoFixed: true },
      { category: "en_dash", detail: "–", autoFixed: true },
      { category: "em_dash", detail: "—", autoFixed: true },
      { category: "curly_quote", detail: "“", autoFixed: true },
      { category: "curly_quote", detail: "”", autoFixed: true },
      { category: "curly_quote", detail: "’", autoFixed: true },
    ]);
  });

  // Every dash spacing variant must land as one comma plus one space. This
  // previously expected "One,two,three, four." — the unspaced and
  // double-hyphen forms were losing the following space, and the unspaced em
  // dash is the shape models actually emit, so that was the common path.
  it("converts unspaced and double-hyphen dashes, then collapses punctuation", () => {
    expect(
      applyStylePass("One—two -- three,, four,. —", emailOptions).text,
    ).toBe("One, two, three, four.");
  });

  it("returns text with no leading or trailing whitespace", () => {
    const result = applyStylePass("Pickup is Tuesday —", emailOptions).text;

    expect(result).toBe("Pickup is Tuesday");
    expect(result).toBe(result.trim());
  });

  it.each([
    "Great question!",
    "Good question.",
    "Thanks for reaching out!",
    "Thank you for reaching out.",
    "Certainly!",
    "Absolutely.",
    "Of course!",
    "I'd be happy to help.",
    "I would be happy to help!",
    "Happy to help.",
  ])("strips the leading stock opener %s and re-capitalizes", (opener) => {
    const result = applyStylePass(`${opener} here's the update.`, emailOptions);

    expect(result.text).toBe("Here's the update.");
    expect(result.violations).toEqual([
      { category: "stock_opener", detail: opener, autoFixed: true },
    ]);
  });

  it("does not strip a mid-draft or standalone stock opener", () => {
    expect(
      applyStylePass("We can help. Great question!", emailOptions).text,
    ).toBe("We can help. Great question!");
    expect(applyStylePass("Great question!", emailOptions).text).toBe(
      "Great question!",
    );
  });

  it.each([
    "It is worth noting that",
    "It's worth noting that",
    "It is important to note",
    "It's important to note",
    "That said,",
    "With that in mind,",
    "In essence,",
    "Ultimately,",
  ])("flags the filler bridge %s without rewriting it", (bridge) => {
    const text = `First sentence. ${bridge} keep this detail.`;
    const result = applyStylePass(text, emailOptions);

    expect(result.text).toBe(text);
    expect(result.violations).toEqual([
      { category: "filler_bridge", detail: bridge, autoFixed: false },
    ]);
  });

  it("flags post-substitution over-length text without rewriting it", () => {
    const text = "a".repeat(901);
    const result = applyStylePass(text, emailOptions);

    expect(result.text).toBe(text);
    expect(result.violations).toEqual([
      { category: "over_length", detail: "901", autoFixed: false },
    ]);
  });

  it("is idempotent", () => {
    const once = applyStylePass(
      "Great question! It’s 2–4 steps — ultimately, that’s enough.",
      emailOptions,
    );
    const twice = applyStylePass(once.text, emailOptions);

    expect(twice.text).toBe(once.text);
    expect(twice.violations).toEqual(
      once.violations.filter((violation) => !violation.autoFixed),
    );
  });
});
