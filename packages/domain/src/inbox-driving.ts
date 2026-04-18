import {
  inboxDrivingEventTypeValues,
  type CanonicalEventProvenance,
  type CanonicalEventRecord,
  type InboxDrivingEventType
} from "@as-comms/contracts";

const inboxDrivingEventTypes = new Set<string>(inboxDrivingEventTypeValues);

export function isInboxDrivingEventType(
  eventType: CanonicalEventRecord["eventType"]
): eventType is InboxDrivingEventType {
  return inboxDrivingEventTypes.has(eventType);
}

function hasTrustedInboxDrivingEvidence(
  provenance: Pick<
    CanonicalEventProvenance,
    | "inboxProjectionExclusionReason"
    | "messageKind"
    | "primaryProvider"
    | "sourceRecordType"
  >
): boolean {
  if (provenance.inboxProjectionExclusionReason === "forwarded_chain") {
    return false;
  }

  if (provenance.sourceRecordType === "internal_only_message") {
    return false;
  }

  if (provenance.messageKind === "one_to_one") {
    return true;
  }

  if (
    provenance.messageKind === "auto" ||
    provenance.messageKind === "campaign"
  ) {
    return false;
  }

  if (provenance.primaryProvider === "gmail") {
    return (
      provenance.sourceRecordType === null ||
      provenance.sourceRecordType === "message"
    );
  }

  if (provenance.primaryProvider === "simpletexting") {
    return provenance.sourceRecordType !== "internal_only_message";
  }

  return false;
}

export function isInboxDrivingCanonicalEvent(
  event: Pick<CanonicalEventRecord, "eventType" | "provenance">
): event is Pick<CanonicalEventRecord, "eventType" | "provenance"> & {
  readonly eventType: InboxDrivingEventType;
} {
  return isInboxDrivingEventType(event.eventType)
    ? hasTrustedInboxDrivingEvidence(event.provenance)
    : false;
}
