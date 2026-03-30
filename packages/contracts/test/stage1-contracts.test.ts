import { describe, expect, it } from "vitest";

import {
  canonicalEventSchema,
  canonicalEventTypeValues,
  identityResolutionReasonCodeValues,
  inboxDrivingEventTypeValues,
  quarantineReasonCodeValues,
  resolveCanonicalChannel,
  routingReviewReasonCodeValues,
  sourceEvidenceSchema,
  syncStateSchema
} from "../src/index.js";

describe("Stage 1 contracts", () => {
  it("keeps the canonical event taxonomy and channel mapping aligned", () => {
    expect(canonicalEventTypeValues).toHaveLength(14);
    expect(resolveCanonicalChannel("communication.email.inbound")).toBe("email");
    expect(resolveCanonicalChannel("communication.sms.opt_out")).toBe("sms");
    expect(resolveCanonicalChannel("lifecycle.completed_training")).toBe(
      "lifecycle"
    );
    expect(resolveCanonicalChannel("campaign.email.clicked")).toBe(
      "campaign_email"
    );
  });

  it("rejects canonical events whose channel disagrees with the taxonomy", () => {
    const sourceEvidence = sourceEvidenceSchema.parse({
      id: "sev_1",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-message-1",
      receivedAt: "2026-01-01T00:00:00.000Z",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payloadRef: "payloads/gmail/gmail-message-1.json",
      idempotencyKey: "gmail:message:gmail-message-1",
      checksum: "abc123"
    });

    const result = canonicalEventSchema.safeParse({
      id: "evt_1",
      contactId: "contact_1",
      eventType: "communication.email.inbound",
      channel: "sms",
      occurredAt: "2026-01-01T00:00:00.000Z",
      sourceEvidenceId: sourceEvidence.id,
      idempotencyKey: "canonical:gmail-message-1",
      provenance: {
        primaryProvider: "gmail",
        primarySourceEvidenceId: sourceEvidence.id,
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source"
      },
      reviewState: "clear"
    });

    expect(result.success).toBe(false);
  });

  it("keeps review reason codes intentionally small and stable", () => {
    expect(identityResolutionReasonCodeValues).toEqual([
      "identity_missing_anchor",
      "identity_multi_candidate",
      "identity_conflict",
      "identity_anchor_mismatch"
    ]);
    expect(routingReviewReasonCodeValues).toEqual([
      "routing_missing_membership",
      "routing_multiple_memberships",
      "routing_context_conflict"
    ]);
    expect(quarantineReasonCodeValues).toEqual([
      "replay_checksum_mismatch",
      "duplicate_collapse_conflict"
    ]);
    expect(inboxDrivingEventTypeValues).toEqual([
      "communication.email.inbound",
      "communication.email.outbound",
      "communication.sms.inbound",
      "communication.sms.outbound"
    ]);
  });

  it("distinguishes provider-scoped and orchestration-scoped sync state explicitly", () => {
    const providerScoped = syncStateSchema.safeParse({
      id: "sync:gmail:live:1",
      scope: "provider",
      provider: "gmail",
      jobType: "live_ingest",
      cursor: "cursor-1",
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-01-01T01:00:00.000Z",
      status: "running",
      parityPercent: null,
      freshnessP95Seconds: 60,
      freshnessP99Seconds: 120,
      lastSuccessfulAt: null,
      deadLetterCount: 0
    });
    const orchestrationScoped = syncStateSchema.safeParse({
      id: "sync:projection:rebuild:1",
      scope: "orchestration",
      provider: null,
      jobType: "projection_rebuild",
      cursor: null,
      windowStart: null,
      windowEnd: null,
      status: "succeeded",
      parityPercent: null,
      freshnessP95Seconds: null,
      freshnessP99Seconds: null,
      lastSuccessfulAt: "2026-01-01T01:00:00.000Z",
      deadLetterCount: 0
    });
    const invalid = syncStateSchema.safeParse({
      id: "sync:cutover:1",
      scope: "orchestration",
      provider: "salesforce",
      jobType: "final_delta_sync",
      cursor: null,
      windowStart: null,
      windowEnd: null,
      status: "running",
      parityPercent: null,
      freshnessP95Seconds: null,
      freshnessP99Seconds: null,
      lastSuccessfulAt: null,
      deadLetterCount: 0
    });

    expect(providerScoped.success).toBe(true);
    expect(orchestrationScoped.success).toBe(true);
    expect(invalid.success).toBe(false);
  });
});
