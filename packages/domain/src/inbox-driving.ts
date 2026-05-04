import {
  inboxDrivingEventTypeValues,
  type CanonicalEventRecord,
  type InboxDrivingEventType
} from "@as-comms/contracts";

const inboxDrivingEventTypes = new Set<string>(inboxDrivingEventTypeValues);

export function isInboxDrivingEventType(
  eventType: CanonicalEventRecord["eventType"]
): eventType is InboxDrivingEventType {
  return inboxDrivingEventTypes.has(eventType);
}

export function qualifiesForInboxProjection(
  event: Pick<CanonicalEventRecord, "provenance">
): boolean {
  const provenance = event.provenance;

  if (provenance.inboxProjectionExclusionReason === "forwarded_chain") {
    return false;
  }

  if (provenance.sourceRecordType === "internal_only_message") {
    return false;
  }

  return true;
}
