import { describe, expect, it } from "vitest";

import {
  getDailyTotal,
  isOverBudget,
  record,
  resetForNewDay,
} from "../../../src/server/ai/cost-counter";

describe("cost counter", () => {
  it("accumulates across multiple records", () => {
    resetForNewDay(new Date("2026-04-24T00:00:00.000Z"));
    record(0.5, new Date("2026-04-24T10:00:00.000Z"));
    record(1.25, new Date("2026-04-24T11:00:00.000Z"));

    expect(getDailyTotal(new Date("2026-04-24T12:00:00.000Z"))).toBe(1.75);
  });

  it("reports over-budget state at the threshold", () => {
    resetForNewDay(new Date("2026-04-24T00:00:00.000Z"));
    record(20, new Date("2026-04-24T10:00:00.000Z"));

    expect(isOverBudget(20, new Date("2026-04-24T12:00:00.000Z"))).toBe(true);
  });

  it("resets on a new day", () => {
    resetForNewDay(new Date("2026-04-24T00:00:00.000Z"));
    record(5, new Date("2026-04-24T10:00:00.000Z"));

    expect(getDailyTotal(new Date("2026-04-25T08:00:00.000Z"))).toBe(0);
  });
});
