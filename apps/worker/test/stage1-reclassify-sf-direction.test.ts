import { describe, expect, it } from "vitest";

import {
  planSfDirectionReclassifications,
  type SfDirectionCandidate
} from "../src/ops/reclassify-sf-direction.js";

function buildCandidate(input: {
  readonly index: number;
  readonly eventType?: "communication.email.inbound" | "communication.email.outbound";
  readonly subject?: string | null;
  readonly crossProviderCollapseKey?: string | null;
}): SfDirectionCandidate {
  return {
    canonicalEventId: `evt:${String(input.index)}`,
    contactId: `contact:${String(Math.ceil(input.index / 5))}`,
    sourceEvidenceId: `sev:${String(input.index)}`,
    eventType: input.eventType ?? "communication.email.outbound",
    subject: input.subject ?? `← Email: Field update ${String(input.index)}`,
    crossProviderCollapseKey: input.crossProviderCollapseKey ?? null
  };
}

describe("reclassify-sf-direction planning", () => {
  it("plans the expected dry-run counts across a 50-row mock batch", () => {
    const inboundCandidates = Array.from({ length: 25 }, (_, index) =>
      buildCandidate({
        index: index + 1
      })
    );
    const outboundCleanupOnly = Array.from({ length: 24 }, (_, index) =>
      buildCandidate({
        index: index + 26,
        subject: `→ Outbound follow-up ${String(index + 26)}`
      })
    );
    const skippedCrossProvider = buildCandidate({
      index: 50,
      crossProviderCollapseKey: "rfc822:message-50@example.org"
    });
    const plan = planSfDirectionReclassifications([
      ...inboundCandidates,
      ...outboundCleanupOnly,
      skippedCrossProvider
    ]);

    expect(plan.scannedCount).toBe(50);
    expect(plan.reclassifiedCount).toBe(25);
    expect(plan.cleanedSubjectCount).toBe(49);
    expect(plan.affectedContactIds).toEqual([
      "contact:1",
      "contact:2",
      "contact:3",
      "contact:4",
      "contact:5"
    ]);
    expect(plan.skippedCrossProviderRows).toEqual(["evt:50"]);
    expect(plan.changes[0]).toEqual(
      expect.objectContaining({
        canonicalEventId: "evt:1",
        previousEventType: "communication.email.outbound",
        nextEventType: "communication.email.inbound",
        nextSubject: "Field update 1",
        direction: "inbound",
        reclassifiesEventType: true
      })
    );
    expect(plan.changes[30]).toEqual(
      expect.objectContaining({
        previousEventType: "communication.email.outbound",
        nextEventType: "communication.email.outbound",
        direction: "outbound",
        reclassifiesEventType: false
      })
    );
  });
});
