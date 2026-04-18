import { describe, expect, it } from "vitest";

import type { CanonicalEventRecord } from "@as-comms/contracts";

import { isInboxDrivingCanonicalEvent } from "../src/inbox-driving.js";

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

describe("inbox-driving predicate", () => {
  it("treats Gmail transport evidence as inbox-driving even when historical messageKind is null", () => {
    expect(
      isInboxDrivingCanonicalEvent(
        buildEvent({
          primaryProvider: "gmail",
          sourceRecordType: "message",
          messageKind: null,
          direction: null
        })
      )
    ).toBe(true);
  });

  it("excludes legacy Salesforce task-only email when messageKind is ambiguous", () => {
    expect(
      isInboxDrivingCanonicalEvent(
        buildEvent({
          primaryProvider: "salesforce",
          sourceRecordType: "task_communication",
          messageKind: null,
          direction: "outbound"
        })
      )
    ).toBe(false);
  });

  it("excludes explicit internal-only forwarded staff messages", () => {
    expect(
      isInboxDrivingCanonicalEvent(
        buildEvent({
          primaryProvider: "gmail",
          sourceRecordType: "internal_only_message",
          messageKind: null
        })
      )
    ).toBe(false);
  });

  it("excludes canonical events flagged as forwarded chains from queue-driving behavior", () => {
    expect(
      isInboxDrivingCanonicalEvent(
        buildEvent({
          primaryProvider: "gmail",
          sourceRecordType: "message",
          messageKind: "one_to_one",
          inboxProjectionExclusionReason: "forwarded_chain"
        })
      )
    ).toBe(false);
  });
});
