import { describe, expect, it } from "vitest";

import {
  resolveNeedsFollowUp,
  toggleNeedsFollowUp
} from "../../app/inbox/_lib/follow-up-state";

describe("follow-up state helpers", () => {
  it("allows a seeded follow-up row to be cleared and restored", () => {
    const contactId = "contact_seeded";
    const seededNeedsFollowUp = true;

    const cleared = toggleNeedsFollowUp(
      contactId,
      seededNeedsFollowUp,
      new Map<string, boolean>()
    );

    expect(
      resolveNeedsFollowUp(contactId, seededNeedsFollowUp, cleared)
    ).toBe(false);

    const restored = toggleNeedsFollowUp(
      contactId,
      seededNeedsFollowUp,
      cleared
    );

    expect(
      resolveNeedsFollowUp(contactId, seededNeedsFollowUp, restored)
    ).toBe(true);
    expect(restored.size).toBe(0);
  });

  it("allows an unflagged row to be flagged without changing seeded state", () => {
    const contactId = "contact_unseeded";
    const seededNeedsFollowUp = false;

    const flagged = toggleNeedsFollowUp(
      contactId,
      seededNeedsFollowUp,
      new Map<string, boolean>()
    );

    expect(
      resolveNeedsFollowUp(contactId, seededNeedsFollowUp, flagged)
    ).toBe(true);
    expect(flagged.get(contactId)).toBe(true);
  });
});
