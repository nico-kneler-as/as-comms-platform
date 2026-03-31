import {
  identityResolutionReasonCodeValues,
  routingReviewReasonCodeValues
} from "@as-comms/contracts";
import type {
  AuditEvidenceRecord,
  IdentityResolutionCase,
  RoutingReviewCase
} from "@as-comms/contracts";
import type { Stage1RepositoryBundle } from "@as-comms/domain";

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
  readonly timelineProjection: Awaited<
    ReturnType<Stage1RepositoryBundle["timelineProjection"]["listByContactId"]>
  >;
  readonly inboxProjection: Awaited<
    ReturnType<Stage1RepositoryBundle["inboxProjection"]["findByContactId"]>
  >;
  readonly openIdentityCases: readonly IdentityResolutionCase[];
  readonly openRoutingCases: readonly RoutingReviewCase[];
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

  return {
    contact,
    identities,
    memberships,
    canonicalEvents,
    sourceEvidence,
    timelineProjection,
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
) {
  if ("syncStateId" in input) {
    return repositories.syncState.findById(input.syncStateId);
  }

  return repositories.syncState.findLatest(input);
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
