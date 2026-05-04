import { describe, expect, it } from "vitest";

import { classifySyncFreshness } from "../../app/inbox/_lib/sync-freshness";

function date(value: string): Date {
  return new Date(value);
}

describe("classifySyncFreshness", () => {
  const now = date("2026-05-07T12:00:00.000Z");

  it.each([
    {
      label: "null becomes unknown",
      lastSuccessAt: null,
      expected: "unknown",
    },
    {
      label: "current success is fresh",
      lastSuccessAt: date("2026-05-07T12:00:00.000Z"),
      expected: "fresh",
    },
    {
      label: "exactly thirty minutes stays fresh",
      lastSuccessAt: date("2026-05-07T11:30:00.000Z"),
      expected: "fresh",
    },
    {
      label: "thirty minutes and one millisecond becomes stale-30m",
      lastSuccessAt: date("2026-05-07T11:29:59.999Z"),
      expected: "stale-30m",
    },
    {
      label: "exactly two hours stays stale-30m",
      lastSuccessAt: date("2026-05-07T10:00:00.000Z"),
      expected: "stale-30m",
    },
    {
      label: "two hours and one millisecond becomes stale-2h",
      lastSuccessAt: date("2026-05-07T09:59:59.999Z"),
      expected: "stale-2h",
    },
    {
      label: "future timestamps stay defensive-fresh",
      lastSuccessAt: date("2026-05-07T12:00:00.001Z"),
      expected: "fresh",
    },
  ])("$label", ({ lastSuccessAt, expected }) => {
    expect(
      classifySyncFreshness({
        lastSuccessAt,
        now,
      }),
    ).toBe(expected);
  });
});
