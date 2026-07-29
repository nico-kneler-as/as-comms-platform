import { describe, expect, it } from "vitest";

import {
  audienceCriteriaSchema,
  campaignEmailActivityTypeValues,
  campaignEmailTimelineItemSchema,
  campaignRunRecordSchema,
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
    // 15 original Stage 1 + 3 Stage 5A additions
    // (campaign.email.delivered / .bounced / .complained, written by the
    // Postmark webhook handler in Brief A2)
    expect(canonicalEventTypeValues).toHaveLength(18);
    expect(resolveCanonicalChannel("communication.email.inbound")).toBe("email");
    expect(resolveCanonicalChannel("communication.sms.opt_out")).toBe("sms");
    expect(resolveCanonicalChannel("lifecycle.completed_training")).toBe(
      "lifecycle"
    );
    expect(resolveCanonicalChannel("campaign.email.clicked")).toBe(
      "campaign_email"
    );
    expect(resolveCanonicalChannel("campaign.email.bounced")).toBe(
      "campaign_email"
    );
    expect(resolveCanonicalChannel("note.internal.created")).toBe("note");
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
        winnerReason: "single_source",
        sourceRecordType: "message",
        sourceRecordId: "gmail-message-1",
        messageKind: "one_to_one",
        campaignRef: null,
        threadRef: null,
        direction: "inbound"
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
      consecutiveFailureCount: 0,
      leaseOwner: "worker:test",
      heartbeatAt: "2026-01-01T00:00:30.000Z",
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
      consecutiveFailureCount: 0,
      leaseOwner: null,
      heartbeatAt: null,
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
      consecutiveFailureCount: 0,
      leaseOwner: "worker:test",
      heartbeatAt: "2026-01-01T00:00:30.000Z",
      deadLetterCount: 0
    });

    expect(providerScoped.success).toBe(true);
    expect(orchestrationScoped.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  it("preserves the audience mode when provided and omits it otherwise", () => {
    const parsedWithMode = audienceCriteriaSchema.parse({
      projectIds: ["project-1"],
      statuses: ["Approved"],
      initialFilter: "specific",
    });
    const parsedWithoutMode = audienceCriteriaSchema.parse({
      projectIds: ["project-1"],
      statuses: ["Approved"],
    });
    const parsedUnknownMode = audienceCriteriaSchema.safeParse({
      projectIds: ["project-1"],
      statuses: ["Approved"],
      initialFilter: "invalid_mode",
    });
    const parsedCsvMode = audienceCriteriaSchema.parse({
      initialFilter: "csv_upload",
    });

    expect(parsedWithMode.initialFilter).toBe("specific");
    expect(parsedCsvMode.initialFilter).toBe("csv_upload");
    expect(parsedWithoutMode.initialFilter).toBeUndefined();
    expect(parsedUnknownMode.success).toBe(false);
  });

  it("accepts every campaign email activity type on a timeline item", () => {
    // The timeline schema used to keep its own narrower copy of this enum,
    // omitting delivered/bounced/complained. Once the Postmark webhook began
    // writing those events, parsing a contact's timeline threw and the whole
    // inbox contact page failed to render. Assert against the canonical list
    // so the two can never drift apart again.
    for (const activityType of campaignEmailActivityTypeValues) {
      const parsed = campaignEmailTimelineItemSchema.safeParse({
        id: `tli_${activityType}`,
        contactId: "contact_1",
        canonicalEventId: `evt_${activityType}`,
        family: "campaign_email",
        occurredAt: "2026-07-29T00:00:00.000Z",
        sortKey: `2026-07-29T00:00:00.000Z:${activityType}`,
        reviewState: "clear",
        primaryProvider: "postmark",
        summary: `Campaign email ${activityType}`,
        activityType,
        campaignName: "Beech Training Reminder",
        campaignId: "run_1",
        audienceId: null,
        snippet: "",
      });

      expect(parsed.success, `expected ${activityType} to parse`).toBe(true);
    }
  });

  it("allows a project-kind run with no project once its audience is a CSV", () => {
    // SMS runs are always kind='project', and a CSV audience defines its own
    // recipients with no project (PRD #674). The projectId requirement was
    // previously waived only for drafts, so the draft→scheduled transition at
    // send time failed validation and rolled the whole send back.
    const baseRun = {
      id: "run_csv_1",
      kind: "project" as const,
      launchType: "sms" as const,
      projectId: null,
      name: "Beech Training Reminder",
      bodyTextTemplate: "Hey {{firstName}}, training reminder.",
      audienceCriteria: { initialFilter: "csv_upload" as const },
      createdAt: "2026-07-28T16:12:25.525Z",
      updatedAt: "2026-07-28T16:12:25.525Z",
    };

    const scheduledCsvRun = campaignRunRecordSchema.safeParse({
      ...baseRun,
      state: "scheduled",
      scheduledAt: "2026-07-29T18:00:00.000Z",
    });
    const completeCsvRun = campaignRunRecordSchema.safeParse({
      ...baseRun,
      state: "complete",
      completedAt: "2026-07-29T18:05:00.000Z",
    });
    // A project-status audience still requires a project outside draft state.
    const scheduledProjectRun = campaignRunRecordSchema.safeParse({
      ...baseRun,
      state: "scheduled",
      audienceCriteria: { initialFilter: "project_status" as const },
    });

    expect(scheduledCsvRun.success).toBe(true);
    expect(completeCsvRun.success).toBe(true);
    expect(scheduledProjectRun.success).toBe(false);
  });
});
