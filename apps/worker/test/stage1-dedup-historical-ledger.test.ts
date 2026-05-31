import { describe, expect, it } from "vitest";

import {
  canonicalEventSchema,
  resolveCanonicalChannel,
  type CanonicalEventRecord
} from "@as-comms/contracts";

import {
  dedupHistoricalLedger,
  planHistoricalLedgerDedup,
  type HistoricalLedgerDedupResult
} from "../src/ops/dedup-historical-ledger.js";
import { createTestWorkerContext } from "./helpers.js";

function buildCandidateEvent(input: {
  readonly id: string;
  readonly contactId: string;
  readonly occurredAt: string;
  readonly primaryProvider: "gmail" | "salesforce";
  readonly sourceEvidenceId: string;
  readonly idempotencyKey: string;
  readonly winnerReason: CanonicalEventRecord["provenance"]["winnerReason"];
  readonly messageKind: "one_to_one" | "auto";
}) {
  return canonicalEventSchema.parse({
    id: input.id,
    contactId: input.contactId,
    eventType: "communication.email.outbound",
    channel: resolveCanonicalChannel("communication.email.outbound"),
    occurredAt: input.occurredAt,
    sourceEvidenceId: input.sourceEvidenceId,
    idempotencyKey: input.idempotencyKey,
    provenance: {
      primaryProvider: input.primaryProvider,
      primarySourceEvidenceId: input.sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: input.winnerReason,
      sourceRecordType:
        input.primaryProvider === "gmail" ? "message" : "task_communication",
      sourceRecordId: input.id.replace("evt_", ""),
      messageKind: input.messageKind,
      campaignRef: null,
      threadRef: null,
      direction: "outbound",
      notes: null
    },
    reviewState: "clear"
  });
}

async function seedContact(input: {
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly contactId: string;
  readonly salesforceContactId: string;
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
    memberships: [
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

async function seedDirtyOutboundEmail(input: {
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly contactId: string;
  readonly key: string;
  readonly provider: "gmail" | "salesforce";
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly subject: string;
  readonly body: string;
  readonly messageKind: "one_to_one" | "auto";
}): Promise<CanonicalEventRecord> {
  const sourceEvidenceId = `sev_${input.key}`;
  const providerRecordId =
    input.provider === "gmail" ? `gmail-${input.key}` : `task-${input.key}`;

  await input.context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: input.provider,
    providerRecordType:
      input.provider === "gmail" ? "message" : "task_communication",
    providerRecordId,
    receivedAt: input.receivedAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/${input.provider}/${input.key}.json`,
    idempotencyKey: `${input.provider}:${providerRecordId}`,
    checksum: `checksum:${input.key}`
  });

  if (input.provider === "gmail") {
    await input.context.repositories.gmailMessageDetails.upsert({
      sourceEvidenceId,
      providerRecordId,
      gmailThreadId: `thread-${input.key}`,
      rfc822MessageId: `<${input.key}@example.org>`,
      direction: "outbound",
      subject: input.subject,
      fromHeader: "Adventure Scientists <volunteers@example.org>",
      toHeader: "Volunteer <volunteer@example.org>",
      ccHeader: null,
      fromEmails: [],
      toEmails: [],
      ccEmails: [],
      bccEmails: [],
      snippetClean: input.body,
      bodyTextPreview: input.body,
      capturedMailbox: "volunteers@example.org",
      projectInboxAlias: null
    });
  } else {
    await input.context.repositories.salesforceCommunicationDetails.upsert({
      sourceEvidenceId,
      providerRecordId,
      channel: "email",
      messageKind: input.messageKind,
      subject: input.subject,
      snippet: input.body,
      sourceLabel:
        input.messageKind === "auto" ? "Salesforce Flow" : "Salesforce Task"
    });
  }

  const canonicalEvent = buildCandidateEvent({
    id: `evt_${input.key}`,
    contactId: input.contactId,
    occurredAt: input.occurredAt,
    primaryProvider: input.provider,
    sourceEvidenceId,
    idempotencyKey: `canonical:${input.key}`,
    winnerReason:
      input.provider === "gmail" ? "single_source" : "salesforce_only_best_evidence",
    messageKind: input.messageKind
  });
  await input.context.repositories.canonicalEvents.upsert(canonicalEvent);
  await input.context.repositories.timelineProjection.upsert({
    id: `timeline:${canonicalEvent.id}`,
    contactId: input.contactId,
    canonicalEventId: canonicalEvent.id,
    occurredAt: input.occurredAt,
    sortKey: `${input.occurredAt}::${canonicalEvent.id}`,
    eventType: canonicalEvent.eventType,
    summary:
      input.provider === "gmail" ? "Outbound email sent" : "Outbound email logged",
    channel: canonicalEvent.channel,
    primaryProvider: input.provider,
    reviewState: canonicalEvent.reviewState
  });

  return canonicalEvent;
}

async function seedHistoricalDuplicates(
  context: Awaited<ReturnType<typeof createTestWorkerContext>>
): Promise<void> {
  await seedContact({
    context,
    contactId: "contact_tori",
    salesforceContactId: "003-tori",
    email: "tori@example.org",
    displayName: "Tori Rogers"
  });
  const toriSalesforce = await seedDirtyOutboundEmail({
    context,
    contactId: "contact_tori",
    key: "tori-salesforce",
    provider: "salesforce",
    occurredAt: "2026-04-20T14:40:57.000Z",
    receivedAt: "2026-04-20T14:45:00.000Z",
    subject: "Re: Confirmed: Hex 13174",
    body: "Confirmed. You are all set for Hex 13174.",
    messageKind: "auto"
  });
  await seedDirtyOutboundEmail({
    context,
    contactId: "contact_tori",
    key: "tori-gmail",
    provider: "gmail",
    occurredAt: "2026-04-20T14:40:57.000Z",
    receivedAt: "2026-04-20T14:41:05.000Z",
    subject: "Re: Confirmed: Hex 13174",
    body: "Confirmed. You are all set for Hex 13174.",
    messageKind: "one_to_one"
  });
  await context.repositories.inboxProjection.upsert({
    contactId: "contact_tori",
    bucket: "Opened",
    needsFollowUp: false,
    hasUnresolved: false,
    lastInboundAt: null,
    lastOutboundAt: toriSalesforce.occurredAt,
    lastActivityAt: toriSalesforce.occurredAt,
    snippet: "Confirmed. You are all set for Hex 13174.",
    archivedAt: null,
    lastCanonicalEventId: toriSalesforce.id,
    lastEventType: "communication.email.outbound"
  });

  await seedContact({
    context,
    contactId: "contact_rosie",
    salesforceContactId: "003-rosie",
    email: "rosie@example.org",
    displayName: "Rosie Yacoub"
  });
  await seedDirtyOutboundEmail({
    context,
    contactId: "contact_rosie",
    key: "rosie-gmail-1",
    provider: "gmail",
    occurredAt: "2026-04-20T14:54:44.000Z",
    receivedAt: "2026-04-20T14:54:50.000Z",
    subject: "Re: still time to get involved?",
    body: "There is still time to get involved if you want a spot on the next training.",
    messageKind: "one_to_one"
  });
  const rosieGmail2 = await seedDirtyOutboundEmail({
    context,
    contactId: "contact_rosie",
    key: "rosie-gmail-2",
    provider: "gmail",
    occurredAt: "2026-04-20T14:55:46.000Z",
    receivedAt: "2026-04-20T14:55:52.000Z",
    subject: "Re: still time to get involved?",
    body: "There is still time to get involved if you want a spot on the next training.\n\nSent from my iPhone",
    messageKind: "one_to_one"
  });
  await seedDirtyOutboundEmail({
    context,
    contactId: "contact_rosie",
    key: "rosie-salesforce",
    provider: "salesforce",
    occurredAt: "2026-04-20T14:56:32.000Z",
    receivedAt: "2026-04-20T15:00:00.000Z",
    subject: "Re: still time to get involved?",
    body: "There is still time to get involved if you want a spot on the next training.",
    messageKind: "auto"
  });
  await context.repositories.inboxProjection.upsert({
    contactId: "contact_rosie",
    bucket: "Opened",
    needsFollowUp: false,
    hasUnresolved: false,
    lastInboundAt: null,
    lastOutboundAt: rosieGmail2.occurredAt,
    lastActivityAt: rosieGmail2.occurredAt,
    snippet: "There is still time to get involved if you want a spot on the next training.",
    archivedAt: null,
    lastCanonicalEventId: rosieGmail2.id,
    lastEventType: "communication.email.outbound"
  });

  await seedContact({
    context,
    contactId: "contact_tani",
    salesforceContactId: "003-tani",
    email: "tani@example.org",
    displayName: "Tani Thomas"
  });
  await seedDirtyOutboundEmail({
    context,
    contactId: "contact_tani",
    key: "tani-gmail-1",
    provider: "gmail",
    occurredAt: "2026-04-20T14:42:48.000Z",
    receivedAt: "2026-04-20T14:42:55.000Z",
    subject: "Re: Hex 31476: Were You Able to Pick Up Your ARU?",
    body: "Were you able to pick up your ARU? Here is the link: https://example.org/aru?utm_source=gmail&utm_campaign=follow-up",
    messageKind: "one_to_one"
  });
  await seedDirtyOutboundEmail({
    context,
    contactId: "contact_tani",
    key: "tani-gmail-2",
    provider: "gmail",
    occurredAt: "2026-04-20T14:43:14.000Z",
    receivedAt: "2026-04-20T14:43:18.000Z",
    subject: "Re: Hex 31476: Were You Able to Pick Up Your ARU?",
    body: "Were you able to pick up your ARU? Here is the link: https://example.org/aru?utm_medium=email&utm_campaign=follow-up",
    messageKind: "one_to_one"
  });
  const taniSalesforce = await seedDirtyOutboundEmail({
    context,
    contactId: "contact_tani",
    key: "tani-salesforce",
    provider: "salesforce",
    occurredAt: "2026-04-20T14:43:12.000Z",
    receivedAt: "2026-04-20T14:48:00.000Z",
    subject: "→ Email: Re: Hex 31476: Were You Able to Pick Up Your ARU?",
    body: "Were you able to pick up your ARU? Here is the link: https://example.org/aru?utm_term=aru",
    messageKind: "auto"
  });
  await context.repositories.inboxProjection.upsert({
    contactId: "contact_tani",
    bucket: "Opened",
    needsFollowUp: false,
    hasUnresolved: false,
    lastInboundAt: null,
    lastOutboundAt: taniSalesforce.occurredAt,
    lastActivityAt: taniSalesforce.occurredAt,
    snippet:
      "Were you able to pick up your ARU? Here is the link: https://example.org/aru?utm_term=aru",
    archivedAt: null,
    lastCanonicalEventId: taniSalesforce.id,
    lastEventType: "communication.email.outbound"
  });

  await seedContact({
    context,
    contactId: "contact_next_step",
    salesforceContactId: "003-next-step",
    email: "next-step@example.org",
    displayName: "Next Step Contact"
  });
  const nextStepSecond = await seedDirtyOutboundEmail({
    context,
    contactId: "contact_next_step",
    key: "next-step-2",
    provider: "salesforce",
    occurredAt: "2026-03-04T21:02:03.000Z",
    receivedAt: "2026-03-04T21:02:20.000Z",
    subject: "Next Step for PNW Forest Biodiversity",
    body: "Thanks for joining the cohort. Here are your next step instructions.",
    messageKind: "auto"
  });
  await seedDirtyOutboundEmail({
    context,
    contactId: "contact_next_step",
    key: "next-step-1",
    provider: "salesforce",
    occurredAt: "2026-03-04T21:00:06.000Z",
    receivedAt: "2026-03-04T21:00:30.000Z",
    subject: "Next Step for PNW Forest Biodiversity",
    body: "Thanks for joining the cohort. Here are your next step instructions.",
    messageKind: "auto"
  });
  await context.repositories.inboxProjection.upsert({
    contactId: "contact_next_step",
    bucket: "Opened",
    needsFollowUp: false,
    hasUnresolved: false,
    lastInboundAt: null,
    lastOutboundAt: nextStepSecond.occurredAt,
    lastActivityAt: nextStepSecond.occurredAt,
    snippet:
      "Thanks for joining the cohort. Here are your next step instructions.",
    archivedAt: null,
    lastCanonicalEventId: nextStepSecond.id,
    lastEventType: "communication.email.outbound"
  });
}

function createCapturingWriter() {
  const lines: string[] = [];

  return {
    lines,
    writer: {
      writeLine(line: string) {
        lines.push(line);
      }
    }
  };
}

function createSilentLogger() {
  return {
    log() {
      return undefined;
    },
    error() {
      return undefined;
    }
  };
}

async function upsertAudienceRow(input: {
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly canonicalEventId: string;
  readonly contactId: string;
  readonly participantRole: "sender" | "direct_recipient" | "cc" | "bcc";
  readonly normalizedEmail: string;
}): Promise<void> {
  await input.context.repositories.canonicalEventAudience.upsert({
    canonicalEventId: input.canonicalEventId,
    contactId: input.contactId,
    participantRole: input.participantRole,
    normalizedEmail: input.normalizedEmail
  });
}

async function loadAudienceRows(
  context: Awaited<ReturnType<typeof createTestWorkerContext>>
): Promise<
  readonly {
    readonly canonical_event_id: string;
    readonly contact_id: string;
    readonly participant_role: string;
  }[]
> {
  const result = await context.client.query<{
    readonly canonical_event_id: string;
    readonly contact_id: string;
    readonly participant_role: string;
  }>(
    `select canonical_event_id, contact_id, participant_role
     from canonical_event_audience
     order by canonical_event_id, contact_id, participant_role`
  );

  return result.rows;
}

describe("dedup-historical-ledger", () => {
  it("plans Gmail-over-Salesforce and earliest-Gmail winners with the live heuristic", () => {
    const plans = planHistoricalLedgerDedup([
      {
        event: buildCandidateEvent({
          id: "evt_tori_salesforce",
          contactId: "contact_tori",
          occurredAt: "2026-04-20T14:40:57.000Z",
          primaryProvider: "salesforce",
          sourceEvidenceId: "sev_tori_salesforce",
          idempotencyKey: "canonical:tori-salesforce",
          winnerReason: "salesforce_only_best_evidence",
          messageKind: "auto"
        }),
        exactBodyFingerprint: "tori",
        contentFingerprint: "fp:tori",
        salesforceSnippetClusterFingerprint: "sf:tori"
      },
      {
        event: buildCandidateEvent({
          id: "evt_tori_gmail",
          contactId: "contact_tori",
          occurredAt: "2026-04-20T14:40:57.000Z",
          primaryProvider: "gmail",
          sourceEvidenceId: "sev_tori_gmail",
          idempotencyKey: "canonical:tori-gmail",
          winnerReason: "single_source",
          messageKind: "one_to_one"
        }),
        exactBodyFingerprint: "tori",
        contentFingerprint: "fp:tori",
        salesforceSnippetClusterFingerprint: null
      },
      {
        event: buildCandidateEvent({
          id: "evt_rosie_gmail_1",
          contactId: "contact_rosie",
          occurredAt: "2026-04-20T14:54:44.000Z",
          primaryProvider: "gmail",
          sourceEvidenceId: "sev_rosie_gmail_1",
          idempotencyKey: "canonical:rosie-gmail-1",
          winnerReason: "single_source",
          messageKind: "one_to_one"
        }),
        exactBodyFingerprint: "rosie",
        contentFingerprint: "fp:rosie",
        salesforceSnippetClusterFingerprint: null
      },
      {
        event: buildCandidateEvent({
          id: "evt_rosie_gmail_2",
          contactId: "contact_rosie",
          occurredAt: "2026-04-20T14:55:46.000Z",
          primaryProvider: "gmail",
          sourceEvidenceId: "sev_rosie_gmail_2",
          idempotencyKey: "canonical:rosie-gmail-2",
          winnerReason: "single_source",
          messageKind: "one_to_one"
        }),
        exactBodyFingerprint: "rosie",
        contentFingerprint: "fp:rosie",
        salesforceSnippetClusterFingerprint: null
      }
    ]);

    expect(plans).toHaveLength(2);
    const toriPlan = plans.find(
      (plan) => plan.winner.event.contactId === "contact_tori"
    );
    const rosiePlan = plans.find(
      (plan) => plan.winner.event.contactId === "contact_rosie"
    );

    expect(toriPlan?.winner.event.id).toBe("evt_tori_gmail");
    expect(toriPlan?.reason).toBe("exact_body_fingerprint");
    expect(toriPlan?.losers.map((loser) => loser.event.id)).toEqual([
      "evt_tori_salesforce"
    ]);
    expect(rosiePlan?.winner.event.id).toBe("evt_rosie_gmail_1");
    expect(rosiePlan?.reason).toBe("exact_body_fingerprint");
    expect(rosiePlan?.losers.map((loser) => loser.event.id)).toEqual([
      "evt_rosie_gmail_2"
    ]);
  });

  it("dry-runs and executes against a seeded dirty database without leaving duplicate rows behind", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedHistoricalDuplicates(context);

      const dryRunWriter = createCapturingWriter();
      const dryRun = await dedupHistoricalLedger({
        db: context.db,
        repositories: context.repositories,
        dryRun: true,
        logger: createSilentLogger(),
        auditWriter: dryRunWriter.writer
      });

      expect(dryRun).toMatchObject({
        dryRun: true,
        scannedCandidateCount: 10,
        plannedClusterCount: 4,
        plannedLoserCount: 6
      });
      expect(dryRun.referenceTargets).toEqual([
        {
          table: "contact_inbox_projection",
          column: "last_canonical_event_id",
          action: "repoint_to_winner"
        },
        {
          table: "contact_timeline_projection",
          column: "canonical_event_id",
          action: "delete_loser_projection_row"
        },
        {
          table: "canonical_event_audience",
          column: "canonical_event_id",
          action: "repoint_audience_to_winner"
        }
      ]);
      expect(
        dryRunWriter.lines.every((line) =>
          line.includes("\"operation\":\"would_merge\"")
        )
      ).toBe(true);

      const executeWriter = createCapturingWriter();
      const executed = await dedupHistoricalLedger({
        db: context.db,
        repositories: context.repositories,
        dryRun: false,
        logger: createSilentLogger(),
        auditWriter: executeWriter.writer
      });

      expect(executed).toMatchObject<Partial<HistoricalLedgerDedupResult>>({
        dryRun: false,
        plannedClusterCount: 4,
        plannedLoserCount: 6,
        deletedCanonicalCount: 6,
        deletedTimelineCount: 6
      });
      expect(executed.repointedInboxCount).toBeGreaterThanOrEqual(4);
      expect(executed.repointedAudienceCount).toBe(0);
      expect(
        executeWriter.lines.filter((line) =>
          line.includes("\"operation\":\"merged\"")
        )
      ).toHaveLength(6);

      await expect(
        context.repositories.canonicalEvents.listByContactId("contact_tori")
      ).resolves.toHaveLength(1);
      await expect(
        context.repositories.canonicalEvents.listByContactId("contact_rosie")
      ).resolves.toHaveLength(1);
      await expect(
        context.repositories.canonicalEvents.listByContactId("contact_tani")
      ).resolves.toHaveLength(1);
      await expect(
        context.repositories.canonicalEvents.listByContactId("contact_next_step")
      ).resolves.toHaveLength(1);

      const [toriEvent] =
        await context.repositories.canonicalEvents.listByContactId("contact_tori");
      const [rosieEvent] =
        await context.repositories.canonicalEvents.listByContactId("contact_rosie");
      const [taniEvent] =
        await context.repositories.canonicalEvents.listByContactId("contact_tani");
      const [nextStepEvent] =
        await context.repositories.canonicalEvents.listByContactId(
          "contact_next_step"
        );

      expect(toriEvent?.sourceEvidenceId).toBe("sev_tori-gmail");
      expect(toriEvent?.provenance.supportingSourceEvidenceIds).toEqual([
        "sev_tori-salesforce"
      ]);
      expect(rosieEvent?.sourceEvidenceId).toBe("sev_rosie-gmail-1");
      expect(rosieEvent?.provenance.supportingSourceEvidenceIds).toEqual([
        "sev_rosie-gmail-2",
        "sev_rosie-salesforce"
      ]);
      expect(taniEvent?.sourceEvidenceId).toBe("sev_tani-gmail-1");
      expect(taniEvent?.provenance.supportingSourceEvidenceIds).toEqual([
        "sev_tani-gmail-2",
        "sev_tani-salesforce"
      ]);
      expect(nextStepEvent?.sourceEvidenceId).toBe("sev_next-step-1");
      expect(nextStepEvent?.provenance.supportingSourceEvidenceIds).toEqual([
        "sev_next-step-2"
      ]);

      const secondDryRunWriter = createCapturingWriter();
      const secondDryRun = await dedupHistoricalLedger({
        db: context.db,
        repositories: context.repositories,
        dryRun: true,
        logger: createSilentLogger(),
        auditWriter: secondDryRunWriter.writer
      });

      expect(secondDryRun.plannedClusterCount).toBe(0);
      expect(secondDryRun.plannedLoserCount).toBe(0);
      expect(secondDryRunWriter.lines).toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("repoints loser audience rows onto the winner when there is no collision", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        contactId: "contact_audience_owner",
        salesforceContactId: "003-audience-owner",
        email: "owner@example.org",
        displayName: "Audience Owner"
      });
      await seedContact({
        context,
        contactId: "contact_audience_a",
        salesforceContactId: "003-audience-a",
        email: "a@example.org",
        displayName: "Audience A"
      });
      await seedContact({
        context,
        contactId: "contact_audience_b",
        salesforceContactId: "003-audience-b",
        email: "b@example.org",
        displayName: "Audience B"
      });
      await seedContact({
        context,
        contactId: "contact_audience_c",
        salesforceContactId: "003-audience-c",
        email: "c@example.org",
        displayName: "Audience C"
      });
      await seedContact({
        context,
        contactId: "contact_audience_d",
        salesforceContactId: "003-audience-d",
        email: "d@example.org",
        displayName: "Audience D"
      });

      const winner = await seedDirtyOutboundEmail({
        context,
        contactId: "contact_audience_owner",
        key: "audience-winner",
        provider: "gmail",
        occurredAt: "2026-05-01T09:00:00.000Z",
        receivedAt: "2026-05-01T09:00:05.000Z",
        subject: "Audience merge",
        body: "Same body",
        messageKind: "one_to_one"
      });
      const loser = await seedDirtyOutboundEmail({
        context,
        contactId: "contact_audience_owner",
        key: "audience-loser",
        provider: "salesforce",
        occurredAt: "2026-05-01T09:00:00.000Z",
        receivedAt: "2026-05-01T09:00:20.000Z",
        subject: "Audience merge",
        body: "Same body",
        messageKind: "auto"
      });

      await upsertAudienceRow({
        context,
        canonicalEventId: winner.id,
        contactId: "contact_audience_a",
        participantRole: "direct_recipient",
        normalizedEmail: "a@example.org"
      });
      await upsertAudienceRow({
        context,
        canonicalEventId: winner.id,
        contactId: "contact_audience_b",
        participantRole: "cc",
        normalizedEmail: "b@example.org"
      });
      await upsertAudienceRow({
        context,
        canonicalEventId: loser.id,
        contactId: "contact_audience_c",
        participantRole: "direct_recipient",
        normalizedEmail: "c@example.org"
      });
      await upsertAudienceRow({
        context,
        canonicalEventId: loser.id,
        contactId: "contact_audience_d",
        participantRole: "cc",
        normalizedEmail: "d@example.org"
      });

      const dryRun = await dedupHistoricalLedger({
        db: context.db,
        repositories: context.repositories,
        dryRun: true,
        logger: createSilentLogger()
      });
      expect(dryRun.repointedAudienceCount).toBe(0);
      // loadAudienceRows orders by canonical_event_id ASC.
      // `evt_audience-loser` < `evt_audience-winner` lexicographically, so
      // loser rows come first in the result.
      await expect(loadAudienceRows(context)).resolves.toEqual([
        {
          canonical_event_id: loser.id,
          contact_id: "contact_audience_c",
          participant_role: "direct_recipient"
        },
        {
          canonical_event_id: loser.id,
          contact_id: "contact_audience_d",
          participant_role: "cc"
        },
        {
          canonical_event_id: winner.id,
          contact_id: "contact_audience_a",
          participant_role: "direct_recipient"
        },
        {
          canonical_event_id: winner.id,
          contact_id: "contact_audience_b",
          participant_role: "cc"
        }
      ]);

      const executed = await dedupHistoricalLedger({
        db: context.db,
        repositories: context.repositories,
        dryRun: false,
        logger: createSilentLogger()
      });

      expect(executed.repointedAudienceCount).toBe(2);
      expect(executed.auditLines).toContainEqual(
        expect.objectContaining({
          loserId: loser.id,
          operation: "merged",
          repointedAudienceCount: 2
        })
      );
      await expect(loadAudienceRows(context)).resolves.toEqual([
        {
          canonical_event_id: winner.id,
          contact_id: "contact_audience_a",
          participant_role: "direct_recipient"
        },
        {
          canonical_event_id: winner.id,
          contact_id: "contact_audience_b",
          participant_role: "cc"
        },
        {
          canonical_event_id: winner.id,
          contact_id: "contact_audience_c",
          participant_role: "direct_recipient"
        },
        {
          canonical_event_id: winner.id,
          contact_id: "contact_audience_d",
          participant_role: "cc"
        }
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("de-dupes colliding audience rows before repointing the loser", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        contactId: "contact_collision_owner",
        salesforceContactId: "003-collision-owner",
        email: "owner2@example.org",
        displayName: "Collision Owner"
      });
      await seedContact({
        context,
        contactId: "contact_collision_a",
        salesforceContactId: "003-collision-a",
        email: "collision-a@example.org",
        displayName: "Collision A"
      });
      await seedContact({
        context,
        contactId: "contact_collision_b",
        salesforceContactId: "003-collision-b",
        email: "collision-b@example.org",
        displayName: "Collision B"
      });
      await seedContact({
        context,
        contactId: "contact_collision_c",
        salesforceContactId: "003-collision-c",
        email: "collision-c@example.org",
        displayName: "Collision C"
      });

      const winner = await seedDirtyOutboundEmail({
        context,
        contactId: "contact_collision_owner",
        key: "collision-winner",
        provider: "gmail",
        occurredAt: "2026-05-02T10:00:00.000Z",
        receivedAt: "2026-05-02T10:00:05.000Z",
        subject: "Collision merge",
        body: "Same body collision",
        messageKind: "one_to_one"
      });
      const loser = await seedDirtyOutboundEmail({
        context,
        contactId: "contact_collision_owner",
        key: "collision-loser",
        provider: "salesforce",
        occurredAt: "2026-05-02T10:00:00.000Z",
        receivedAt: "2026-05-02T10:00:20.000Z",
        subject: "Collision merge",
        body: "Same body collision",
        messageKind: "auto"
      });

      await upsertAudienceRow({
        context,
        canonicalEventId: winner.id,
        contactId: "contact_collision_a",
        participantRole: "direct_recipient",
        normalizedEmail: "collision-a@example.org"
      });
      await upsertAudienceRow({
        context,
        canonicalEventId: winner.id,
        contactId: "contact_collision_b",
        participantRole: "cc",
        normalizedEmail: "collision-b@example.org"
      });
      await upsertAudienceRow({
        context,
        canonicalEventId: loser.id,
        contactId: "contact_collision_a",
        participantRole: "bcc",
        normalizedEmail: "collision-a@example.org"
      });
      await upsertAudienceRow({
        context,
        canonicalEventId: loser.id,
        contactId: "contact_collision_c",
        participantRole: "direct_recipient",
        normalizedEmail: "collision-c@example.org"
      });

      const executed = await dedupHistoricalLedger({
        db: context.db,
        repositories: context.repositories,
        dryRun: false,
        logger: createSilentLogger()
      });

      expect(executed.repointedAudienceCount).toBe(1);
      await expect(loadAudienceRows(context)).resolves.toEqual([
        {
          canonical_event_id: winner.id,
          contact_id: "contact_collision_a",
          participant_role: "direct_recipient"
        },
        {
          canonical_event_id: winner.id,
          contact_id: "contact_collision_b",
          participant_role: "cc"
        },
        {
          canonical_event_id: winner.id,
          contact_id: "contact_collision_c",
          participant_role: "direct_recipient"
        }
      ]);
    } finally {
      await context.dispose();
    }
  });
});
