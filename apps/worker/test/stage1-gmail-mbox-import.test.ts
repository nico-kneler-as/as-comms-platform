import { describe, expect, it } from "vitest";

import { createStage1GmailMboxImportService } from "../src/ops/gmail-mbox.js";
import { createTestWorkerContext, type TestWorkerContext } from "./helpers.js";

const contactId = "contact:salesforce:003-stage1";
const salesforceContactId = "003-stage1";
const mboxText = `From MAILER-DAEMON Fri Jan 04 00:00:00 2026
Date: Sun, 04 Jan 2026 00:00:00 +0000
From: Volunteer <volunteer@example.org>
To: Project Antarctica <project-antarctica@example.org>
Subject: Historical volunteer reply
Message-ID: <historical-import-1@example.org>

Reply from the volunteer
`;

async function seedContact(context: TestWorkerContext) {
  await context.normalization.upsertNormalizedContactGraph({
    contact: {
      id: contactId,
      salesforceContactId,
      displayName: "Stage One Volunteer",
      primaryEmail: "volunteer@example.org",
      primaryPhone: "+15555550123",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    identities: [
      {
        id: `identity:${contactId}:salesforce`,
        contactId,
        kind: "salesforce_contact_id",
        normalizedValue: salesforceContactId,
        isPrimary: true,
        source: "salesforce",
        verifiedAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: `identity:${contactId}:email`,
        contactId,
        kind: "email",
        normalizedValue: "volunteer@example.org",
        isPrimary: true,
        source: "salesforce",
        verifiedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    memberships: []
  });
}

describe("Stage 1 Gmail .mbox importer", () => {
  it("uses the same historical Gmail ingest path and stays replay-safe on repeated import", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact(context);
      const importer = createStage1GmailMboxImportService({
        ingest: context.ingest,
        persistence: context.persistence,
        syncState: context.syncState,
        now: () => new Date("2026-01-04T00:01:00.000Z")
      });

      const firstRun = await importer.importMbox({
        mboxText,
        mboxPath: "/tmp/project-antarctica.mbox",
        capturedMailbox: "project-antarctica@example.org",
        liveAccount: "volunteers@adventurescientists.org",
        projectInboxAliases: ["project-antarctica@example.org"],
        syncStateId: "sync:gmail:mbox:first",
        correlationId: "corr:gmail:mbox:first",
        traceId: null,
        receivedAt: "2026-01-04T00:01:00.000Z"
      });
      const secondRun = await importer.importMbox({
        mboxText,
        mboxPath: "/tmp/project-antarctica.mbox",
        capturedMailbox: "project-antarctica@example.org",
        liveAccount: "volunteers@adventurescientists.org",
        projectInboxAliases: ["project-antarctica@example.org"],
        syncStateId: "sync:gmail:mbox:second",
        correlationId: "corr:gmail:mbox:second",
        traceId: null,
        receivedAt: "2026-01-04T00:02:00.000Z"
      });

      expect(firstRun).toMatchObject({
        outcome: "succeeded",
        parsedRecords: 1,
        syncStatus: "succeeded",
        summary: {
          processed: 1,
          normalized: 1
        }
      });
      expect(secondRun).toMatchObject({
        outcome: "succeeded",
        parsedRecords: 1,
        syncStatus: "succeeded",
        summary: {
          processed: 1,
          duplicate: 1
        }
      });

      await expect(context.repositories.canonicalEvents.countAll()).resolves.toBe(1);
      const canonicalEvents =
        await context.repositories.canonicalEvents.listByContactId(contactId);
      expect(canonicalEvents).toHaveLength(1);
      const sourceEvidenceId = canonicalEvents[0]?.sourceEvidenceId;

      if (sourceEvidenceId === undefined) {
        throw new Error("Expected a canonical event with source evidence.");
      }

      await expect(
        context.repositories.gmailMessageDetails.listBySourceEvidenceIds([
          sourceEvidenceId
        ])
      ).resolves.toEqual([
        expect.objectContaining({
          sourceEvidenceId,
          subject: "Historical volunteer reply",
          snippetClean: "Reply from the volunteer",
          bodyTextPreview: "Reply from the volunteer",
          capturedMailbox: "project-antarctica@example.org",
          projectInboxAlias: "project-antarctica@example.org",
          direction: "inbound"
        })
      ]);
      await expect(
        context.repositories.syncState.findById("sync:gmail:mbox:first")
      ).resolves.toMatchObject({
        provider: "gmail",
        jobType: "historical_backfill",
        status: "succeeded"
      });
      await expect(
        context.repositories.inboxProjection.findByContactId(contactId)
      ).resolves.toMatchObject({
        bucket: "New"
      });
    } finally {
      await context.dispose();
    }
  });
});
