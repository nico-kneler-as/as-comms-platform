import { describe, expect, it } from "vitest";

import {
  buildGmailMessageRecord,
  type GmailMessageRecord,
} from "@as-comms/integrations";

import {
  applyOrphanGmailRecoveryPlan,
  planOrphanGmailRecoveryTargets,
  type OrphanGmailDetailTarget,
} from "../src/ops/recover-orphan-gmail-details.js";
import { createTestWorkerContext } from "./helpers.js";

function buildTarget(
  gmailMessageId: string,
  sourceEvidenceId: string,
): OrphanGmailDetailTarget {
  return {
    canonicalEventId: `canonical-event:${gmailMessageId}`,
    sourceEvidenceId,
    gmailMessageId,
    occurredAt: "2026-05-01T12:00:00.000Z",
    receivedAt: "2026-05-01T12:00:01.000Z",
    contactId: "contact:test",
  };
}

function buildLiveRecord(gmailMessageId: string): GmailMessageRecord {
  const record = buildGmailMessageRecord({
    recordId: gmailMessageId,
    threadId: "thread-live-1",
    snippet: "Recovered Gmail snippet",
    snippetClean: "Recovered Gmail snippet",
    bodyTextPreview: "Recovered message body.",
    internalDate: "2026-05-01T12:00:00.000Z",
    headers: {
      Date: "Fri, 01 May 2026 12:00:00 +0000",
      From: "Adventure Scientists <volunteers@example.org>",
      To: "Volunteer <volunteer@example.org>",
      Subject: "Recovered message",
      "Message-ID": `<${gmailMessageId}@example.org>`,
    },
    payloadRef: `gmail://volunteers%40example.org/messages/${gmailMessageId}`,
    checksum: `checksum:${gmailMessageId}`,
    capturedMailbox: "volunteers@example.org",
    receivedAt: "2026-05-01T12:00:01.000Z",
    internalAddresses: ["volunteers@example.org"],
    projectInboxAliases: ["orcas@example.org"],
  });

  if (record.recordType !== "message") {
    throw new Error("Expected a Gmail message record.");
  }

  return record as GmailMessageRecord;
}

describe("recover-orphan-gmail-details", () => {
  it("classifies mbox, recoverable live, and live-missing targets", () => {
    const [mboxPlan, recoverablePlan, missingPlan] = planOrphanGmailRecoveryTargets(
      {
        targets: [
          buildTarget(
            "mbox:historical-message-1",
            "source-evidence:gmail:message:mbox:historical-message-1",
          ),
          buildTarget(
            "gmail-live-1",
            "source-evidence:gmail:message:gmail-live-1",
          ),
          buildTarget(
            "gmail-live-2",
            "source-evidence:gmail:message:gmail-live-2",
          ),
        ],
        liveRecordsById: new Map([
          ["gmail-live-1", buildLiveRecord("gmail-live-1")],
        ]),
      },
    );

    expect(mboxPlan).toMatchObject({
      bucket: "M",
      reason: "mbox_import_unrecoverable",
      detail: null,
    });
    expect(recoverablePlan).toMatchObject({
      bucket: "R",
      reason: null,
      detail: {
        sourceEvidenceId: "source-evidence:gmail:message:gmail-live-1",
        providerRecordId: "gmail-live-1",
        gmailThreadId: "thread-live-1",
        rfc822MessageId: "<gmail-live-1@example.org>",
        subject: "Recovered message",
        snippetClean: "Recovered Gmail snippet",
        bodyTextPreview: "Recovered message body.",
        capturedMailbox: "volunteers@example.org",
        // projectInboxAlias is null here because the test message's headers
        // don't reference the alias; resolveProjectInboxAlias only matches
        // when the alias appears in From/To/Cc/Bcc/capturedMailbox.
      },
    });
    expect(missingPlan).toMatchObject({
      bucket: "M",
      reason: "live_fetch_returned_no_record",
      detail: null,
    });
  });

  it("does not persist detail rows during dry-run execution", async () => {
    const context = await createTestWorkerContext();
    const sourceEvidenceId = "source-evidence:gmail:message:gmail-live-dry-run";

    try {
      await context.repositories.sourceEvidence.append({
        id: sourceEvidenceId,
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: "gmail-live-dry-run",
        receivedAt: "2026-05-01T12:00:01.000Z",
        occurredAt: "2026-05-01T12:00:00.000Z",
        payloadRef: "gmail://volunteers%40example.org/messages/gmail-live-dry-run",
        idempotencyKey: sourceEvidenceId,
        checksum: "checksum:gmail-live-dry-run",
      });

      const [plan] = planOrphanGmailRecoveryTargets({
        targets: [buildTarget("gmail-live-dry-run", sourceEvidenceId)],
        liveRecordsById: new Map([
          ["gmail-live-dry-run", buildLiveRecord("gmail-live-dry-run")],
        ]),
      });

      expect(plan?.bucket).toBe("R");

      if (plan === undefined) {
        throw new Error("Expected a recovery plan.");
      }

      expect(
        await applyOrphanGmailRecoveryPlan({
          db: context.db,
          plan,
          dryRun: true,
        }),
      ).toBe(false);

      expect(
        await context.repositories.gmailMessageDetails.listBySourceEvidenceIds([
          sourceEvidenceId,
        ]),
      ).toEqual([]);
    } finally {
      await context.dispose();
    }
  });
});
