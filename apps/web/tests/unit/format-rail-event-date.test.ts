import { describe, expect, it } from "vitest";

import { formatRailEventDate } from "../../app/inbox/_lib/format-date";

describe("formatRailEventDate", () => {
  it("renders month and day for events in the same Mountain Time calendar year", () => {
    expect(
      formatRailEventDate(
        "2026-04-23T15:00:00.000Z",
        "2026-08-01T12:00:00.000Z",
      ),
    ).toBe("Apr 23");
  });

  it("renders month, day, and year for events from an older Mountain Time calendar year", () => {
    expect(
      formatRailEventDate(
        "2025-04-23T15:00:00.000Z",
        "2026-08-01T12:00:00.000Z",
      ),
    ).toBe("Apr 23, 2025");
  });

  it("respects Mountain Time year boundaries", () => {
    expect(
      formatRailEventDate(
        "2025-12-31T23:30:00.000Z",
        "2026-01-15T12:00:00.000Z",
      ),
    ).toBe("Dec 31, 2025");
  });
});
