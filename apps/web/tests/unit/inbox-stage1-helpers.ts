import type { InboxProjectionRow } from "@as-comms/contracts";

import {
  createTestStage1Context,
  type TestStage1Context
} from "../../../../packages/db/test/helpers.js";
import { setStage1WebRuntimeForTests } from "../../src/server/stage1-runtime";

export interface InboxTestRuntime {
  readonly context: TestStage1Context;
  dispose(): Promise<void>;
}

export async function createInboxTestRuntime(): Promise<InboxTestRuntime> {
  const context = await createTestStage1Context();

  setStage1WebRuntimeForTests({
    connection: null,
    repositories: context.repositories
  });

  return {
    context,
    async dispose() {
      setStage1WebRuntimeForTests(null);
      await context.client.close();
    }
  };
}

export async function seedInboxContact(
  context: TestStage1Context,
  input: {
    readonly contactId: string;
    readonly salesforceContactId: string | null;
    readonly displayName: string;
    readonly primaryEmail: string | null;
    readonly primaryPhone: string | null;
    readonly projectId?: string;
    readonly projectName?: string;
    readonly membershipId?: string;
    readonly membershipStatus?: string | null;
  }
): Promise<void> {
  await context.repositories.contacts.upsert({
    id: input.contactId,
    salesforceContactId: input.salesforceContactId,
    displayName: input.displayName,
    primaryEmail: input.primaryEmail,
    primaryPhone: input.primaryPhone,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });

  if (input.projectId !== undefined) {
    await context.repositories.projectDimensions.upsert({
      projectId: input.projectId,
      projectName: input.projectName ?? input.projectId,
      source: "salesforce"
    });
  }

  if (input.membershipId !== undefined) {
    await context.repositories.contactMemberships.upsert({
      id: input.membershipId,
      contactId: input.contactId,
      projectId: input.projectId ?? null,
      expeditionId: null,
      role: "volunteer",
      status: input.membershipStatus ?? null,
      source: "salesforce"
    });
  }
}

export async function seedInboxEmailEvent(
  context: TestStage1Context,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly occurredAt: string;
    readonly direction: "inbound" | "outbound";
    readonly subject: string;
    readonly snippet: string;
  }
): Promise<{ readonly canonicalEventId: string }> {
  const sourceEvidenceId = `source:${input.id}`;
  const canonicalEventId = `event:${input.id}`;

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: input.id,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/gmail/${input.id}.json`,
    idempotencyKey: `gmail:${input.id}`,
    checksum: `checksum:${input.id}`
  });

  await context.repositories.canonicalEvents.upsert({
    id: canonicalEventId,
    contactId: input.contactId,
    eventType:
      input.direction === "inbound"
        ? "communication.email.inbound"
        : "communication.email.outbound",
    channel: "email",
    occurredAt: input.occurredAt,
    sourceEvidenceId,
    idempotencyKey: `canonical:${input.id}`,
    provenance: {
      primaryProvider: "gmail",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "message",
      sourceRecordId: input.id,
      messageKind: "one_to_one",
      campaignRef: null,
      threadRef: null,
      direction: input.direction,
      notes: null
    },
    reviewState: "clear"
  });

  await context.repositories.gmailMessageDetails.upsert({
    sourceEvidenceId,
    providerRecordId: input.id,
    gmailThreadId: `thread:${input.contactId}`,
    rfc822MessageId: `<${input.id}@example.org>`,
    direction: input.direction,
    subject: input.subject,
    snippetClean: input.snippet,
    bodyTextPreview: input.snippet,
    capturedMailbox: "volunteers@example.org",
    projectInboxAlias: "volunteers@example.org"
  });

  await context.repositories.timelineProjection.upsert({
    id: `timeline:${input.id}`,
    contactId: input.contactId,
    canonicalEventId,
    occurredAt: input.occurredAt,
    sortKey: `${input.occurredAt}::${canonicalEventId}`,
    eventType:
      input.direction === "inbound"
        ? "communication.email.inbound"
        : "communication.email.outbound",
    summary: input.subject,
    channel: "email",
    primaryProvider: "gmail",
    reviewState: "clear"
  });

  return {
    canonicalEventId
  };
}

export async function seedInboxSmsEvent(
  context: TestStage1Context,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly occurredAt: string;
    readonly direction: "inbound" | "outbound";
    readonly summary: string;
  }
): Promise<{ readonly canonicalEventId: string }> {
  const sourceEvidenceId = `source:${input.id}`;
  const canonicalEventId = `event:${input.id}`;

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "salesforce",
    providerRecordType: "communication",
    providerRecordId: input.id,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/salesforce/${input.id}.json`,
    idempotencyKey: `salesforce:${input.id}`,
    checksum: `checksum:${input.id}`
  });

  await context.repositories.canonicalEvents.upsert({
    id: canonicalEventId,
    contactId: input.contactId,
    eventType:
      input.direction === "inbound"
        ? "communication.sms.inbound"
        : "communication.sms.outbound",
    channel: "sms",
    occurredAt: input.occurredAt,
    sourceEvidenceId,
    idempotencyKey: `canonical:${input.id}`,
    provenance: {
      primaryProvider: "salesforce",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "communication",
      sourceRecordId: input.id,
      messageKind: "one_to_one",
      campaignRef: null,
      threadRef: null,
      direction: input.direction,
      notes: null
    },
    reviewState: "clear"
  });

  await context.repositories.timelineProjection.upsert({
    id: `timeline:${input.id}`,
    contactId: input.contactId,
    canonicalEventId,
    occurredAt: input.occurredAt,
    sortKey: `${input.occurredAt}::${canonicalEventId}`,
    eventType:
      input.direction === "inbound"
        ? "communication.sms.inbound"
        : "communication.sms.outbound",
    summary: input.summary,
    channel: "sms",
    primaryProvider: "salesforce",
    reviewState: "clear"
  });

  return {
    canonicalEventId
  };
}

export async function seedInboxProjection(
  context: TestStage1Context,
  row: InboxProjectionRow
): Promise<void> {
  await context.repositories.inboxProjection.upsert(row);
}
