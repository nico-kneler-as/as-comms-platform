import { randomUUID } from "node:crypto";

import {
  reconcileSmsConsent,
  type ConsentRecord,
  type ConsentRecordRepository
} from "@as-comms/domain";
import type { SalesforceContactSnapshotRecord } from "@as-comms/integrations";

export interface CapturedSalesforceContactForConsentReconcile {
  readonly contactId: string;
  readonly record: SalesforceContactSnapshotRecord;
}

export interface ReconcileCapturedSmsConsentBatchInput {
  readonly capturedContacts: readonly CapturedSalesforceContactForConsentReconcile[];
}

export type ReconcileCapturedSmsConsentBatch = (
  input: ReconcileCapturedSmsConsentBatchInput
) => Promise<void>;

export function createCapturedSmsConsentReconciler(input: {
  readonly consentRecords: Pick<
    ConsentRecordRepository,
    "findLatestByContactIds" | "insert"
  >;
  readonly logger?: Pick<Console, "info">;
  readonly now?: () => Date;
}): ReconcileCapturedSmsConsentBatch {
  const logger = input.logger ?? console;
  const now = input.now ?? (() => new Date());

  return async ({ capturedContacts }) => {
    if (capturedContacts.length === 0) {
      return;
    }

    const eligibleContacts = capturedContacts.filter(({ record }) =>
      record.memberships.some((membership) => membership.textOptIn !== null)
    );
    const latestConsentLookup: ReadonlyMap<string, ConsentRecord> =
      eligibleContacts.length === 0
        ? new Map<string, ConsentRecord>()
        : await input.consentRecords.findLatestByContactIds(
            eligibleContacts.map(({ contactId }) => contactId)
          );
    const latestConsentByContactId = new Map<string, ConsentRecord>(
      latestConsentLookup
    );
    let optedInAppended = 0;
    let revokedAppended = 0;
    let skippedNoPhone = 0;
    const skippedNoOptInData = capturedContacts.length - eligibleContacts.length;

    for (const { contactId, record } of eligibleContacts) {
      const phoneE164 = record.primaryPhone ?? record.normalizedPhones[0] ?? null;

      if (phoneE164 === null) {
        skippedNoPhone += 1;
        continue;
      }

      const sfTextOptIn = record.memberships.some(
        (membership) => membership.textOptIn === true
      );
      const latestConsent = latestConsentByContactId.get(contactId) ?? null;
      const action = reconcileSmsConsent({
        sfTextOptIn,
        latestConsent
      });

      if (action.kind !== "append") {
        continue;
      }

      const recordedAt = now();
      const inserted = await input.consentRecords.insert({
        id: randomUUID(),
        contactId,
        phoneE164,
        status: action.status,
        source: action.source,
        sourceDetail: null,
        consentedAt: action.status === "opted_in" ? recordedAt : null,
        revokedAt: action.status === "revoked" ? recordedAt : null,
        recordedByUserId: null,
        notes: action.reason,
        createdAt: recordedAt,
        updatedAt: recordedAt
      });
      latestConsentByContactId.set(contactId, inserted);

      if (action.status === "opted_in") {
        optedInAppended += 1;
      } else {
        revokedAppended += 1;
      }
    }

    logger.info({
      event: "sms_consent.capture_reconcile",
      opted_in_appended: optedInAppended,
      revoked_appended: revokedAppended,
      skipped_no_phone: skippedNoPhone,
      skipped_no_optin_data: skippedNoOptInData
    });
  };
}
