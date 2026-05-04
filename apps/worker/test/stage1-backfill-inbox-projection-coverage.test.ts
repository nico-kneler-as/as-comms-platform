import { describe, expect, it } from "vitest";

import {
  canonicalEventSchema,
  resolveCanonicalChannel,
  type CanonicalEventRecord,
  type SourceEvidenceRecord
} from "@as-comms/contracts";

import {
  backfillInboxProjectionCoverage,
  loadBackfillInboxProjectionCoverageCandidateContactIdsFromDb
} from "../src/ops/backfill-inbox-projection-coverage.js";
import { createTestWorkerContext, type TestWorkerContext } from "./helpers.js";

async function seedContact(input: {
  readonly context: TestWorkerContext;
  readonly contactId: string;
  readonly salesforceContactId: string | null;
  readonly email: string;
  readonly displayName: string;
}): Promise<void> {
  await input.context.normalization.upsertNormalizedContactGraph({
    contact: {
      id: input.contactId,
      salesforceContactId: input.salesforceContactId,
      displayName: input.displayName,
      primaryEmail: input.email,
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    identities: [
      {
        id: `identity:${input.contactId}:email`,
        contactId: input.contactId,
        kind: "email",
        normalizedValue: input.email,
        isPrimary: true,
        source: "salesforce",
        verifiedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    memberships:
      input.salesforceContactId === null
        ? []
        : [
            {
              id: `membership:${input.contactId}:default`,
              contactId: input.contactId,
              salesforceMembershipId: `membership:${input.contactId}:default:sf`,
              projectId: "project_default",
              expeditionId: "expedition_default",
              role: "volunteer",
              status: "active",
              source: "salesforce",
              createdAt: "2026-01-01T00:00:00.000Z"
            }
          ]
  });
}

function buildSourceEvidence(input: {
  readonly key: string;
  readonly provider: SourceEvidenceRecord["provider"];
  readonly providerRecordType: string;
  readonly occurredAt: string;
}): SourceEvidenceRecord {
  return {
    id: `sev_${input.key}`,
    provider: input.provider,
    providerRecordType: input.providerRecordType,
    providerRecordId: `${input.provider}:${input.key}`,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/${input.provider}/${input.key}.json`,
    idempotencyKey: `${input.provider}:${input.providerRecordType}:${input.key}`,
    checksum: `checksum:${input.key}`
  };
}

function buildCanonicalEvent(input: {
  readonly key: string;
  readonly contactId: string;
  readonly eventType: CanonicalEventRecord["eventType"];
  readonly occurredAt: string;
  readonly primaryProvider: CanonicalEventRecord["provenance"]["primaryProvider"];
  readonly sourceRecordType: string;
  readonly direction: CanonicalEventRecord["provenance"]["direction"];
  readonly messageKind: CanonicalEventRecord["provenance"]["messageKind"];
  readonly inboxProjectionExclusionReason?: "forwarded_chain" | null;
}): CanonicalEventRecord {
  return canonicalEventSchema.parse({
    id: `evt_${input.key}`,
    contactId: input.contactId,
    eventType: input.eventType,
    channel: resolveCanonicalChannel(input.eventType),
    occurredAt: input.occurredAt,
    contentFingerprint: null,
    sourceEvidenceId: `sev_${input.key}`,
    idempotencyKey: `canonical:${input.key}`,
    provenance: {
      primaryProvider: input.primaryProvider,
      primarySourceEvidenceId: `sev_${input.key}`,
      supportingSourceEvidenceIds: [],
      winnerReason:
        input.primaryProvider === "salesforce"
          ? "salesforce_only_best_evidence"
          : "single_source",
      sourceRecordType: input.sourceRecordType,
      sourceRecordId: `${input.primaryProvider}:${input.key}`,
      messageKind: input.messageKind,
      campaignRef: null,
      threadRef: null,
      direction: input.direction,
      inboxProjectionExclusionReason:
        input.inboxProjectionExclusionReason ?? null,
      notes: null
    },
    reviewState: "clear"
  });
}

async function seedCanonicalEventOnly(input: {
  readonly context: TestWorkerContext;
  readonly event: CanonicalEventRecord;
}): Promise<void> {
  await input.context.repositories.sourceEvidence.append(
    buildSourceEvidence({
      key: input.event.id.replace("evt_", ""),
      provider: input.event.provenance.primaryProvider,
      providerRecordType: input.event.provenance.sourceRecordType ?? "message",
      occurredAt: input.event.occurredAt
    })
  );
  await input.context.repositories.canonicalEvents.upsert(input.event);
}

async function runForCurrentCandidates(input: {
  readonly context: TestWorkerContext;
  readonly dryRun: boolean;
}): Promise<Awaited<ReturnType<typeof backfillInboxProjectionCoverage>>> {
  const candidateContactIds =
    await loadBackfillInboxProjectionCoverageCandidateContactIdsFromDb(
      input.context.db
    );

  return backfillInboxProjectionCoverage({
    candidateContactIds,
    services: {
      persistence: input.context.persistence,
      orchestration: input.context.orchestration
    },
    dryRun: input.dryRun,
    batchSize: 2,
    logger: {
      log(..._args) {
        void _args;
      },
      error(..._args) {
        void _args;
      }
    }
  });
}

describe("Stage 1 inbox projection coverage backfill ops", () => {
  it("creates projections for auto-only, campaign-only, and lifecycle-only contacts while skipping excluded-only contacts", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        contactId: "contact_auto",
        salesforceContactId: "003-auto",
        email: "auto@example.org",
        displayName: "Auto Only"
      });
      await seedContact({
        context,
        contactId: "contact_campaign",
        salesforceContactId: "003-campaign",
        email: "campaign@example.org",
        displayName: "Campaign Only"
      });
      await seedContact({
        context,
        contactId: "contact_lifecycle",
        salesforceContactId: "003-lifecycle",
        email: "lifecycle@example.org",
        displayName: "Lifecycle Only"
      });
      await seedContact({
        context,
        contactId: "contact_excluded",
        salesforceContactId: "003-excluded",
        email: "excluded@example.org",
        displayName: "Excluded Only"
      });

      await seedCanonicalEventOnly({
        context,
        event: buildCanonicalEvent({
          key: "auto_older",
          contactId: "contact_auto",
          eventType: "communication.email.outbound",
          occurredAt: "2026-04-24T14:45:00.000Z",
          primaryProvider: "salesforce",
          sourceRecordType: "task_communication",
          direction: "outbound",
          messageKind: "auto"
        })
      });
      await seedCanonicalEventOnly({
        context,
        event: buildCanonicalEvent({
          key: "auto_newer",
          contactId: "contact_auto",
          eventType: "communication.email.outbound",
          occurredAt: "2026-04-24T14:50:00.000Z",
          primaryProvider: "salesforce",
          sourceRecordType: "task_communication",
          direction: "outbound",
          messageKind: "auto"
        })
      });
      await seedCanonicalEventOnly({
        context,
        event: buildCanonicalEvent({
          key: "campaign_older",
          contactId: "contact_campaign",
          eventType: "campaign.email.sent",
          occurredAt: "2026-04-24T15:00:00.000Z",
          primaryProvider: "mailchimp",
          sourceRecordType: "campaign_activity",
          direction: null,
          messageKind: "campaign"
        })
      });
      await seedCanonicalEventOnly({
        context,
        event: buildCanonicalEvent({
          key: "campaign_newer",
          contactId: "contact_campaign",
          eventType: "campaign.email.sent",
          occurredAt: "2026-04-24T15:05:00.000Z",
          primaryProvider: "mailchimp",
          sourceRecordType: "campaign_activity",
          direction: null,
          messageKind: "campaign"
        })
      });
      await seedCanonicalEventOnly({
        context,
        event: buildCanonicalEvent({
          key: "campaign_opened",
          contactId: "contact_campaign",
          eventType: "campaign.email.opened",
          occurredAt: "2026-04-24T15:08:00.000Z",
          primaryProvider: "mailchimp",
          sourceRecordType: "campaign_activity",
          direction: null,
          messageKind: "campaign"
        })
      });
      await seedCanonicalEventOnly({
        context,
        event: buildCanonicalEvent({
          key: "lifecycle_received_training",
          contactId: "contact_lifecycle",
          eventType: "lifecycle.received_training",
          occurredAt: "2026-04-24T15:10:00.000Z",
          primaryProvider: "salesforce",
          sourceRecordType: "contact_membership",
          direction: null,
          messageKind: null
        })
      });
      await seedCanonicalEventOnly({
        context,
        event: buildCanonicalEvent({
          key: "excluded_forwarded_chain",
          contactId: "contact_excluded",
          eventType: "communication.email.outbound",
          occurredAt: "2026-04-24T15:12:00.000Z",
          primaryProvider: "gmail",
          sourceRecordType: "message",
          direction: "outbound",
          messageKind: "one_to_one",
          inboxProjectionExclusionReason: "forwarded_chain"
        })
      });
      await seedCanonicalEventOnly({
        context,
        event: buildCanonicalEvent({
          key: "excluded_internal_only",
          contactId: "contact_excluded",
          eventType: "communication.email.outbound",
          occurredAt: "2026-04-24T15:15:00.000Z",
          primaryProvider: "gmail",
          sourceRecordType: "internal_only_message",
          direction: "outbound",
          messageKind: "one_to_one"
        })
      });

      const result = await runForCurrentCandidates({
        context,
        dryRun: false
      });

      expect(result).toMatchObject({
        dryRun: false,
        candidateCount: 4,
        scannedCount: 4,
        insertedCount: 3,
        skippedCount: 1,
        errorCount: 0
      });

      await expect(
        context.repositories.inboxProjection.findByContactId("contact_auto")
      ).resolves.toMatchObject({
        bucket: "Opened",
        lastInboundAt: null,
        lastOutboundAt: "2026-04-24T14:50:00.000Z",
        lastActivityAt: "2026-04-24T14:50:00.000Z",
        lastEventType: "communication.email.outbound"
      });
      await expect(
        context.repositories.inboxProjection.findByContactId("contact_campaign")
      ).resolves.toMatchObject({
        bucket: "Opened",
        lastInboundAt: null,
        lastOutboundAt: "2026-04-24T15:05:00.000Z",
        lastActivityAt: "2026-04-24T15:08:00.000Z",
        lastEventType: "campaign.email.opened"
      });
      await expect(
        context.repositories.inboxProjection.findByContactId("contact_lifecycle")
      ).resolves.toMatchObject({
        bucket: "Opened",
        lastInboundAt: null,
        lastOutboundAt: null,
        lastActivityAt: "2026-04-24T15:10:00.000Z",
        lastEventType: "lifecycle.received_training"
      });
      await expect(
        context.repositories.inboxProjection.findByContactId("contact_excluded")
      ).resolves.toBeNull();
    } finally {
      await context.dispose();
    }
  });

  it("is idempotent because the candidate query excludes contacts once projections exist", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        contactId: "contact_idempotent",
        salesforceContactId: "003-idempotent",
        email: "idempotent@example.org",
        displayName: "Idempotent Contact"
      });
      await seedCanonicalEventOnly({
        context,
        event: buildCanonicalEvent({
          key: "idempotent_campaign",
          contactId: "contact_idempotent",
          eventType: "campaign.email.sent",
          occurredAt: "2026-04-24T15:20:00.000Z",
          primaryProvider: "mailchimp",
          sourceRecordType: "campaign_activity",
          direction: null,
          messageKind: "campaign"
        })
      });

      const first = await runForCurrentCandidates({
        context,
        dryRun: false
      });
      const second = await runForCurrentCandidates({
        context,
        dryRun: false
      });

      expect(first).toMatchObject({
        candidateCount: 1,
        scannedCount: 1,
        insertedCount: 1,
        skippedCount: 0,
        errorCount: 0
      });
      expect(second).toMatchObject({
        candidateCount: 0,
        scannedCount: 0,
        insertedCount: 0,
        skippedCount: 0,
        errorCount: 0
      });
    } finally {
      await context.dispose();
    }
  });

  it("does not write projections in dry-run mode", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        contactId: "contact_dry_run",
        salesforceContactId: "003-dry-run",
        email: "dryrun@example.org",
        displayName: "Dry Run Contact"
      });
      await seedCanonicalEventOnly({
        context,
        event: buildCanonicalEvent({
          key: "dry_run_auto",
          contactId: "contact_dry_run",
          eventType: "communication.email.outbound",
          occurredAt: "2026-04-24T15:25:00.000Z",
          primaryProvider: "salesforce",
          sourceRecordType: "task_communication",
          direction: "outbound",
          messageKind: "auto"
        })
      });

      const result = await runForCurrentCandidates({
        context,
        dryRun: true
      });

      expect(result).toMatchObject({
        dryRun: true,
        candidateCount: 1,
        scannedCount: 1,
        insertedCount: 1,
        skippedCount: 0,
        errorCount: 0
      });
      await expect(
        context.repositories.inboxProjection.findByContactId("contact_dry_run")
      ).resolves.toBeNull();
    } finally {
      await context.dispose();
    }
  });
});
