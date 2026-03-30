import type { ContactIdentityKind, Provider } from "@as-comms/contracts";
import { type CanonicalEventType } from "@as-comms/contracts";

import type { SupportingProviderRecord } from "./provider-types.js";

function encodeIdPart(value: string): string {
  return encodeURIComponent(value);
}

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function uniqueStrings(values: readonly string[]): string[] {
  return sortStrings(
    Array.from(
      new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
    )
  );
}

export function buildSourceEvidenceId(
  provider: Provider,
  providerRecordType: string,
  providerRecordId: string
): string {
  return `source-evidence:${encodeIdPart(provider)}:${encodeIdPart(providerRecordType)}:${encodeIdPart(providerRecordId)}`;
}

export function buildSourceEvidenceIdempotencyKey(
  provider: Provider,
  providerRecordType: string,
  providerRecordId: string
): string {
  return `source-evidence:${provider}:${providerRecordType}:${providerRecordId}`;
}

function buildCanonicalEventCorrelationKey(input: {
  readonly provider: Provider;
  readonly providerRecordType: string;
  readonly providerRecordId: string;
  readonly eventType: CanonicalEventType;
  readonly crossProviderCollapseKey: string | null;
}): string {
  if (input.crossProviderCollapseKey !== null) {
    return `collapse:${input.eventType}:${input.crossProviderCollapseKey}`;
  }

  return `${input.provider}:${input.providerRecordType}:${input.providerRecordId}`;
}

export function buildCanonicalEventId(input: {
  readonly provider: Provider;
  readonly providerRecordType: string;
  readonly providerRecordId: string;
  readonly eventType: CanonicalEventType;
  readonly crossProviderCollapseKey: string | null;
}): string {
  return `canonical-event:${encodeIdPart(buildCanonicalEventCorrelationKey(input))}`;
}

export function buildCanonicalEventIdempotencyKey(input: {
  readonly provider: Provider;
  readonly providerRecordType: string;
  readonly providerRecordId: string;
  readonly eventType: CanonicalEventType;
  readonly crossProviderCollapseKey: string | null;
}): string {
  return `canonical-event:${buildCanonicalEventCorrelationKey(input)}`;
}

export function buildSupportingSourceReferences(
  records: readonly SupportingProviderRecord[]
): {
  readonly provider: Provider;
  readonly sourceEvidenceId: string;
}[] {
  const byId = new Map<
    string,
    {
      readonly provider: Provider;
      readonly sourceEvidenceId: string;
    }
  >();

  for (const record of records) {
    const sourceEvidenceId = buildSourceEvidenceId(
      record.provider,
      record.providerRecordType,
      record.providerRecordId
    );
    byId.set(sourceEvidenceId, {
      provider: record.provider,
      sourceEvidenceId
    });
  }

  return sortStrings(Array.from(byId.keys())).map((sourceEvidenceId) => {
    const reference = byId.get(sourceEvidenceId);

    if (reference === undefined) {
      throw new Error("Expected a supporting source evidence reference.");
    }

    return reference;
  });
}

export function buildContactIdFromSalesforceContactId(
  salesforceContactId: string
): string {
  return `contact:salesforce:${encodeIdPart(salesforceContactId)}`;
}

export function buildContactIdentityId(input: {
  readonly contactId: string;
  readonly kind: ContactIdentityKind;
  readonly normalizedValue: string;
}): string {
  return `contact-identity:${encodeIdPart(input.contactId)}:${encodeIdPart(input.kind)}:${encodeIdPart(input.normalizedValue)}`;
}

export function buildContactMembershipId(input: {
  readonly contactId: string;
  readonly projectId: string | null;
  readonly expeditionId: string | null;
  readonly role: string | null;
}): string {
  return `contact-membership:${encodeIdPart(input.contactId)}:${encodeIdPart(input.projectId ?? "none")}:${encodeIdPart(input.expeditionId ?? "none")}:${encodeIdPart(input.role ?? "none")}`;
}
