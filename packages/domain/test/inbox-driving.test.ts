import { describe, expect, it } from "vitest";

import type { CanonicalEventRecord } from "@as-comms/contracts";

import { qualifiesForInboxProjection } from "../src/inbox-driving.js";

function buildEvent(
  overrides: Partial<CanonicalEventRecord["provenance"]> & {
    readonly eventType?: CanonicalEventRecord["eventType"];
  } = {}
): Pick<CanonicalEventRecord, "eventType" | "provenance"> {
  return {
    eventType: overrides.eventType ?? "communication.email.inbound",
    provenance: {
      primaryProvider: overrides.primaryProvider ?? "gmail",
      primarySourceEvidenceId:
        overrides.primarySourceEvidenceId ?? "source-evidence:test",
      supportingSourceEvidenceIds:
        overrides.supportingSourceEvidenceIds ?? [],
      winnerReason: overrides.winnerReason ?? "single_source",
      sourceRecordType: overrides.sourceRecordType ?? null,
      sourceRecordId: overrides.sourceRecordId ?? null,
      messageKind: overrides.messageKind ?? null,
      campaignRef: overrides.campaignRef ?? null,
      threadRef: overrides.threadRef ?? null,
      direction: overrides.direction ?? null,
      inboxProjectionExclusionReason:
        overrides.inboxProjectionExclusionReason ?? null,
      notes: overrides.notes ?? null
    }
  };
}

describe("qualifiesForInboxProjection", () => {
  it("includes auto outbound email events", () => {
    expect(
      qualifiesForInboxProjection(
        buildEvent({
          eventType: "communication.email.outbound",
          messageKind: "auto",
          direction: "outbound",
        })
      )
    ).toBe(true);
  });

  it("includes campaign message-kind events", () => {
    expect(
      qualifiesForInboxProjection(
        buildEvent({
          eventType: "communication.email.outbound",
          messageKind: "campaign",
          direction: "outbound",
        })
      )
    ).toBe(true);
  });

  it("includes lifecycle events", () => {
    expect(
      qualifiesForInboxProjection(
        buildEvent({
          eventType: "lifecycle.signed_up",
        })
      )
    ).toBe(true);
  });

  it("includes campaign email sent events", () => {
    expect(
      qualifiesForInboxProjection(
        buildEvent({
          eventType: "campaign.email.sent",
        })
      )
    ).toBe(true);
  });

  it("includes internal notes", () => {
    expect(
      qualifiesForInboxProjection(
        buildEvent({
          eventType: "note.internal.created",
        })
      )
    ).toBe(true);
  });

  it("excludes forwarded chains", () => {
    expect(
      qualifiesForInboxProjection(
        buildEvent({
          inboxProjectionExclusionReason: "forwarded_chain",
        })
      )
    ).toBe(false);
  });

  it("excludes internal-only messages", () => {
    expect(
      qualifiesForInboxProjection(
        buildEvent({
          sourceRecordType: "internal_only_message",
        })
      )
    ).toBe(false);
  });
});
