import type {
  AudienceSnapshotRecord,
  CampaignRunRecord,
} from "@as-comms/contracts";

import type { AudienceMember } from "./campaign-types.js";

/**
 * Delivery states that prove the parent message was handed to Postmark and
 * still invite a follow-up. Complaints and unsubscribes from the parent are
 * left out here, not only by the consent check at freeze.
 */
export const resendEligibleDeliveryStatuses = [
  "sent",
  "delivered",
] as const satisfies readonly AudienceSnapshotRecord["deliveryStatus"][];

export function selectResendRecipients(input: {
  readonly parentSnapshots: readonly AudienceSnapshotRecord[];
  readonly openedSnapshotIds: readonly string[];
  readonly clickedSnapshotIds: readonly string[];
}): readonly AudienceMember[] {
  const engaged = new Set([
    ...input.openedSnapshotIds,
    ...input.clickedSnapshotIds,
  ]);
  const seenRecipients = new Set<string>();
  const eligibleStatuses = new Set<string>(resendEligibleDeliveryStatuses);

  return input.parentSnapshots.flatMap((snapshot) => {
    if (!eligibleStatuses.has(snapshot.deliveryStatus) || engaged.has(snapshot.id)) {
      return [];
    }

    // Snapshots are normally unique by source recipient, but the selector is
    // intentionally defensive so a historic duplicate cannot cause two sends.
    const recipientKey = snapshot.newsletterSubscriberId !== null
      ? `newsletter:${snapshot.newsletterSubscriberId}`
      : snapshot.contactId !== null
        ? `contact:${snapshot.contactId}`
        : `email:${snapshot.frozenEmail.trim().toLowerCase()}`;
    if (seenRecipients.has(recipientKey)) {
      return [];
    }
    seenRecipients.add(recipientKey);

    return [{
      contactId: snapshot.contactId,
      newsletterSubscriberId: snapshot.newsletterSubscriberId,
      frozenEmail: snapshot.frozenEmail,
      frozenFirstName: snapshot.frozenFirstName,
      frozenProjectName: snapshot.frozenProjectName,
      frozenProjectId: snapshot.frozenProjectId,
      frozenAliasEmail: snapshot.frozenAliasEmail,
    }];
  });
}

export type CampaignResendReadModel = Readonly<{
  resend: null | {
    readonly childRunId: string;
    readonly state: CampaignRunRecord["state"];
    readonly delayDays: number;
    readonly subject: string | null;
    readonly scheduledFor: string | null;
    readonly recipients?: number;
    readonly sentAt?: string;
  };
}>;

export function readCampaignResend(
  parent: CampaignRunRecord,
  child: CampaignRunRecord | null,
): CampaignResendReadModel {
  if (child?.resendDelayDays == null) {
    return { resend: null };
  }

  const scheduledFor = parent.completedAt === null
    ? null
    : new Date(
        new Date(parent.completedAt).getTime() + child.resendDelayDays * 86_400_000,
      ).toISOString();

  return {
    resend: {
      childRunId: child.id,
      state: child.state,
      delayDays: child.resendDelayDays,
      subject: child.subjectTemplate,
      scheduledFor,
      ...(child.audienceSize === null ? {} : { recipients: child.audienceSize }),
      ...(child.startedAt === null ? {} : { sentAt: child.startedAt }),
    },
  };
}
