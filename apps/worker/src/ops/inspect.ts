import {
  identityResolutionReasonCodeValues,
  routingReviewReasonCodeValues
} from "@as-comms/contracts";
import type {
  AuditEvidenceRecord,
  ContactMembershipRecord,
  GmailMessageDetailRecord,
  IdentityResolutionCase,
  ProjectDimensionRecord,
  RoutingReviewCase,
  SalesforceEventContextRecord,
  SourceEvidenceRecord,
  SyncStateRecord
} from "@as-comms/contracts";
import type { Stage1RepositoryBundle } from "@as-comms/domain";

import {
  extractLatestSyncFailure,
  type Stage1SyncFailureAuditRecord
} from "../orchestration/sync-failure-audit.js";

export interface Stage1ReadableMembership extends ContactMembershipRecord {
  readonly projectName: string | null;
  readonly expeditionName: string | null;
}

export interface Stage1ContactStoryRow {
  readonly canonicalEventId: string;
  readonly sourceEvidenceId: string;
  readonly provider: SourceEvidenceRecord["provider"];
  readonly providerRecordType: string;
  readonly providerRecordId: string;
  readonly occurredAt: string;
  readonly sortKey: string;
  readonly eventType: string;
  readonly channel: string;
  readonly summary: string;
  readonly reviewState: string;
  readonly direction: GmailMessageDetailRecord["direction"] | null;
  readonly subject: string | null;
  readonly preview: string;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly expeditionId: string | null;
  readonly expeditionName: string | null;
  readonly capturedMailbox: string | null;
  readonly projectInboxAlias: string | null;
  readonly payloadRef: string;
  readonly hasUnresolved: boolean;
}

export interface Stage1ContactInspection {
  readonly contact: Awaited<ReturnType<Stage1RepositoryBundle["contacts"]["findById"]>>;
  readonly identities: Awaited<
    ReturnType<Stage1RepositoryBundle["contactIdentities"]["listByContactId"]>
  >;
  readonly memberships: Awaited<
    ReturnType<Stage1RepositoryBundle["contactMemberships"]["listByContactId"]>
  >;
  readonly canonicalEvents: Awaited<
    ReturnType<Stage1RepositoryBundle["canonicalEvents"]["listByContactId"]>
  >;
  readonly sourceEvidence: readonly Awaited<
    ReturnType<Stage1RepositoryBundle["sourceEvidence"]["findById"]>
  >[];
  readonly readableMemberships: readonly Stage1ReadableMembership[];
  readonly timelineProjection: Awaited<
    ReturnType<Stage1RepositoryBundle["timelineProjection"]["listByContactId"]>
  >;
  readonly story: readonly Stage1ContactStoryRow[];
  readonly inboxProjection: Awaited<
    ReturnType<Stage1RepositoryBundle["inboxProjection"]["findByContactId"]>
  >;
  readonly openIdentityCases: readonly IdentityResolutionCase[];
  readonly openRoutingCases: readonly RoutingReviewCase[];
}

export interface Stage1SyncStateInspection extends SyncStateRecord {
  readonly latestFailure: Stage1SyncFailureAuditRecord | null;
}

function buildReadableMemberships(input: {
  readonly memberships: readonly ContactMembershipRecord[];
  readonly projectDimensions: readonly ProjectDimensionRecord[];
  readonly expeditionDimensions: Awaited<
    ReturnType<Stage1RepositoryBundle["expeditionDimensions"]["listByIds"]>
  >;
}): Stage1ReadableMembership[] {
  const projectNameById = new Map(
    input.projectDimensions.map((dimension) => [
      dimension.projectId,
      dimension.projectName
    ])
  );
  const expeditionNameById = new Map(
    input.expeditionDimensions.map((dimension) => [
      dimension.expeditionId,
      dimension.expeditionName
    ])
  );

  return input.memberships.map((membership) => ({
    ...membership,
    projectName:
      membership.projectId === null
        ? null
        : (projectNameById.get(membership.projectId) ?? null),
    expeditionName:
      membership.expeditionId === null
        ? null
        : (expeditionNameById.get(membership.expeditionId) ?? null)
  }));
}

function buildStoryRows(input: {
  readonly canonicalEvents: Awaited<
    ReturnType<Stage1RepositoryBundle["canonicalEvents"]["listByContactId"]>
  >;
  readonly sourceEvidence: readonly SourceEvidenceRecord[];
  readonly timelineProjection: Awaited<
    ReturnType<Stage1RepositoryBundle["timelineProjection"]["listByContactId"]>
  >;
  readonly gmailDetails: readonly GmailMessageDetailRecord[];
  readonly salesforceContext: readonly SalesforceEventContextRecord[];
  readonly projectDimensions: readonly ProjectDimensionRecord[];
  readonly expeditionDimensions: Awaited<
    ReturnType<Stage1RepositoryBundle["expeditionDimensions"]["listByIds"]>
  >;
  readonly hasUnresolved: boolean;
}): Stage1ContactStoryRow[] {
  const canonicalEventById = new Map(
    input.canonicalEvents.map((event) => [event.id, event])
  );
  const sourceEvidenceById = new Map(
    input.sourceEvidence.map((record) => [record.id, record])
  );
  const gmailDetailBySourceEvidenceId = new Map(
    input.gmailDetails.map((detail) => [detail.sourceEvidenceId, detail])
  );
  const salesforceContextBySourceEvidenceId = new Map(
    input.salesforceContext.map((detail) => [detail.sourceEvidenceId, detail])
  );
  const projectNameById = new Map(
    input.projectDimensions.map((dimension) => [
      dimension.projectId,
      dimension.projectName
    ])
  );
  const expeditionNameById = new Map(
    input.expeditionDimensions.map((dimension) => [
      dimension.expeditionId,
      dimension.expeditionName
    ])
  );

  return input.timelineProjection.flatMap((row) => {
    const canonicalEvent = canonicalEventById.get(row.canonicalEventId);

    if (canonicalEvent === undefined) {
      return [];
    }

    const sourceEvidence = sourceEvidenceById.get(canonicalEvent.sourceEvidenceId);

    if (sourceEvidence === undefined) {
      return [];
    }

    const gmailDetail = gmailDetailBySourceEvidenceId.get(sourceEvidence.id);
    const salesforceEventContext = salesforceContextBySourceEvidenceId.get(
      sourceEvidence.id
    );
    const projectId = salesforceEventContext?.projectId ?? null;
    const expeditionId = salesforceEventContext?.expeditionId ?? null;

    return [
      {
        canonicalEventId: canonicalEvent.id,
        sourceEvidenceId: sourceEvidence.id,
        provider: sourceEvidence.provider,
        providerRecordType: sourceEvidence.providerRecordType,
        providerRecordId: sourceEvidence.providerRecordId,
        occurredAt: row.occurredAt,
        sortKey: row.sortKey,
        eventType: row.eventType,
        channel: row.channel,
        summary: row.summary,
        reviewState: row.reviewState,
        direction: gmailDetail?.direction ?? null,
        subject: gmailDetail?.subject ?? null,
        preview: gmailDetail?.bodyTextPreview ?? "",
        projectId,
        projectName:
          projectId === null ? null : (projectNameById.get(projectId) ?? null),
        expeditionId,
        expeditionName:
          expeditionId === null
            ? null
            : (expeditionNameById.get(expeditionId) ?? null),
        capturedMailbox: gmailDetail?.capturedMailbox ?? null,
        projectInboxAlias: gmailDetail?.projectInboxAlias ?? null,
        payloadRef: sourceEvidence.payloadRef,
        hasUnresolved: input.hasUnresolved
      }
    ];
  });
}

export async function resolveContactIdForInspection(
  repositories: Stage1RepositoryBundle,
  input: {
    readonly contactId?: string;
    readonly salesforceContactId?: string;
    readonly email?: string;
  }
): Promise<string> {
  if (input.contactId !== undefined) {
    return input.contactId;
  }

  if (input.salesforceContactId !== undefined) {
    const contact = await repositories.contacts.findBySalesforceContactId(
      input.salesforceContactId
    );

    if (contact === null) {
      throw new Error(
        `No contact found for Salesforce Contact ID ${input.salesforceContactId}.`
      );
    }

    return contact.id;
  }

  if (input.email !== undefined) {
    const identities = await repositories.contactIdentities.listByNormalizedValue({
      kind: "email",
      normalizedValue: input.email
    });
    const contactIds = Array.from(
      new Set(identities.map((identity) => identity.contactId))
    );

    if (contactIds.length === 0) {
      throw new Error(`No contact found for normalized email ${input.email}.`);
    }

    if (contactIds.length > 1) {
      throw new Error(
        `Multiple contacts matched ${input.email}; inspect by contact ID or Salesforce Contact ID instead.`
      );
    }

    const contactId = contactIds[0];

    if (contactId === undefined) {
      throw new Error("Expected a resolved contact ID.");
    }

    return contactId;
  }

  throw new Error(
    "Provide --contact-id, --salesforce-contact-id, or --email to inspect a contact."
  );
}

async function listOpenIdentityCasesForContact(
  repositories: Stage1RepositoryBundle,
  contactId: string
): Promise<readonly IdentityResolutionCase[]> {
  const cases = await Promise.all(
    identityResolutionReasonCodeValues.map((reasonCode) =>
      repositories.identityResolutionQueue.listOpenByReasonCode(reasonCode)
    )
  );

  return cases
    .flat()
    .filter(
      (record) =>
        record.anchoredContactId === contactId ||
        record.candidateContactIds.includes(contactId)
    );
}

async function listOpenRoutingCasesForContact(
  repositories: Stage1RepositoryBundle,
  contactId: string
): Promise<readonly RoutingReviewCase[]> {
  const cases = await Promise.all(
    routingReviewReasonCodeValues.map((reasonCode) =>
      repositories.routingReviewQueue.listOpenByReasonCode(reasonCode)
    )
  );

  return cases.flat().filter((record) => record.contactId === contactId);
}

export async function inspectStage1Contact(
  repositories: Stage1RepositoryBundle,
  input: {
    readonly contactId?: string;
    readonly salesforceContactId?: string;
    readonly email?: string;
  }
): Promise<Stage1ContactInspection> {
  const contactId = await resolveContactIdForInspection(repositories, input);
  const contact = await repositories.contacts.findById(contactId);

  if (contact === null) {
    throw new Error(`Contact ${contactId} was not found.`);
  }

  const identities = await repositories.contactIdentities.listByContactId(contactId);
  const memberships = await repositories.contactMemberships.listByContactId(contactId);
  const canonicalEvents = await repositories.canonicalEvents.listByContactId(contactId);
  const sourceEvidence = await Promise.all(
    canonicalEvents.map((event) =>
      repositories.sourceEvidence.findById(event.sourceEvidenceId)
    )
  );
  const timelineProjection =
    await repositories.timelineProjection.listByContactId(contactId);
  const inboxProjection = await repositories.inboxProjection.findByContactId(contactId);
  const [openIdentityCases, openRoutingCases] = await Promise.all([
    listOpenIdentityCasesForContact(repositories, contactId),
    listOpenRoutingCasesForContact(repositories, contactId)
  ]);
  const sourceEvidenceIds = canonicalEvents.map((event) => event.sourceEvidenceId);
  const [gmailDetails, salesforceContext] = await Promise.all([
    repositories.gmailMessageDetails.listBySourceEvidenceIds(sourceEvidenceIds),
    repositories.salesforceEventContext.listBySourceEvidenceIds(sourceEvidenceIds)
  ]);
  const [projectDimensions, expeditionDimensions] = await Promise.all([
    repositories.projectDimensions.listByIds(
      Array.from(
        new Set(
          [
            ...memberships.map((membership) => membership.projectId),
            ...salesforceContext.map((record) => record.projectId)
          ].filter((value): value is string => value !== null)
        )
      )
    ),
    repositories.expeditionDimensions.listByIds(
      Array.from(
        new Set(
          [
            ...memberships.map((membership) => membership.expeditionId),
            ...salesforceContext.map((record) => record.expeditionId)
          ].filter((value): value is string => value !== null)
        )
      )
    )
  ]);
  const hasUnresolved = openIdentityCases.length > 0 || openRoutingCases.length > 0;
  const readableMemberships = buildReadableMemberships({
    memberships,
    projectDimensions,
    expeditionDimensions
  });
  const story = buildStoryRows({
    canonicalEvents,
    sourceEvidence: sourceEvidence.filter(
      (record): record is SourceEvidenceRecord => record !== null
    ),
    timelineProjection,
    gmailDetails,
    salesforceContext,
    projectDimensions,
    expeditionDimensions,
    hasUnresolved
  });

  return {
    contact,
    identities,
    memberships,
    canonicalEvents,
    sourceEvidence,
    readableMemberships,
    timelineProjection,
    story,
    inboxProjection,
    openIdentityCases,
    openRoutingCases
  };
}

export async function inspectLatestSyncState(
  repositories: Stage1RepositoryBundle,
  input:
    | {
        readonly syncStateId: string;
      }
    | {
        readonly scope: "provider" | "orchestration";
        readonly provider: "gmail" | "salesforce" | "simpletexting" | "mailchimp" | null;
        readonly jobType:
          | "historical_backfill"
          | "live_ingest"
          | "projection_rebuild"
          | "parity_snapshot"
          | "final_delta_sync"
          | "dead_letter_reprocess";
      }
): Promise<Stage1SyncStateInspection | null> {
  const syncState =
    "syncStateId" in input
      ? await repositories.syncState.findById(input.syncStateId)
      : await repositories.syncState.findLatest(input);

  if (syncState === null) {
    return null;
  }

  const auditRecords = await repositories.auditEvidence.listByEntity({
    entityType: "sync_state",
    entityId: syncState.id
  });

  return {
    ...syncState,
    latestFailure: extractLatestSyncFailure(syncState, auditRecords)
  };
}

export async function inspectSourceEvidenceForProviderRecord(
  repositories: Stage1RepositoryBundle,
  input: {
    readonly provider: "gmail" | "salesforce" | "simpletexting" | "mailchimp";
    readonly providerRecordType: string;
    readonly providerRecordId: string;
  }
) {
  return repositories.sourceEvidence.listByProviderRecord(input);
}

export async function inspectAuditEvidence(
  repositories: Stage1RepositoryBundle,
  input: {
    readonly entityType: string;
    readonly entityId: string;
  }
): Promise<readonly AuditEvidenceRecord[]> {
  return repositories.auditEvidence.listByEntity(input);
}
