import { describe, expect, it } from "vitest";

import {
  buildLegacyMboxRecordId,
  buildSourceEvidenceId,
  buildSourceEvidenceIdempotencyKey,
  importGmailMboxRecords,
  type GmailRecord
} from "@as-comms/integrations";

import {
  backfillGmailMboxBodies
} from "../src/ops/backfill-gmail-mbox-bodies.js";
import { createTestWorkerContext } from "./helpers.js";

const capturedMailbox = "pnw@example.org";
const liveAccount = "volunteers@adventurescientists.org";
const projectInboxAliases = [capturedMailbox];
const mboxPath = "/tmp/spark-casual-on.mbox";
const mboxText = `From MAILER-DAEMON Mon Apr 06 22:59:00 2026
Date: Mon, 06 Apr 2026 22:59:00 +0000
From: Volunteer <volunteer@example.org>
To: PNW Forest Biodiversity <pnw@example.org>
Subject: Re: Hex 31476: Were You Able to Pick Up Your ARU?
Message-ID: <fixture-spark-casual-on-1@example.org>
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="69e45bb9_47b1b8c7_2c5"

--69e45bb9_47b1b8c7_2c5
Content-Type: text/plain; charset="utf-8"
Content-Transfer-Encoding: quoted-printable
Content-Disposition: inline

Hi Samantha,

Thank you for these directions! I am planning on picking up my ARUs and =
heading out on April 18-19. Have a great week!


Be magnificent,


Volunteer Name
volunteer=40example.org
On Mon, Apr 6, 2026 at 11:00=E2=80=AFAM PNW Forest Biodiversity <pnw=40e=
xample.org>, wrote:
> Hi Volunteer,
>
> Wonderful=21 Thank you so much.
>

--69e45bb9_47b1b8c7_2c5
Content-Type: text/html; charset="utf-8"
Content-Transfer-Encoding: quoted-printable
Content-Disposition: inline

<div>Hi Samantha,</div>
<div>Thank you for these directions=21 I am planning on picking up my AR=
Us and heading out on April 18-19. Have a great week=21</div>

--69e45bb9_47b1b8c7_2c5--
`;

function extractRawMessage(mboxMessage: string): string {
  return mboxMessage
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .split("\n")
    .slice(1)
    .join("\n")
    .trim();
}

async function loadHistoricalMessageRecord(): Promise<Extract<GmailRecord, {
  readonly recordType: "message";
}>> {
  const [record] = await importGmailMboxRecords({
    mboxText,
    mboxPath,
    capturedMailbox,
    liveAccount,
    projectInboxAliases,
    receivedAt: "2026-04-24T00:00:00.000Z"
  });

  if (record?.recordType !== "message") {
    throw new Error("Expected a Gmail historical message record.");
  }

  return record as Extract<GmailRecord, { readonly recordType: "message" }>;
}

async function seedGmailMessageDetail(input: {
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly providerRecordId: string;
  readonly bodyTextPreview: string;
  readonly snippetClean: string;
}): Promise<string> {
  const sourceEvidenceId = buildSourceEvidenceId(
    "gmail",
    "message",
    input.providerRecordId
  );

  await input.context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: input.providerRecordId,
    receivedAt: "2026-04-24T00:00:00.000Z",
    occurredAt: "2026-04-06T22:59:00.000Z",
    payloadRef: `mbox://${encodeURIComponent(mboxPath)}#message=1`,
    idempotencyKey: buildSourceEvidenceIdempotencyKey(
      "gmail",
      "message",
      input.providerRecordId
    ),
    checksum: `checksum:${input.providerRecordId}`
  });

  await input.context.repositories.gmailMessageDetails.upsert({
    sourceEvidenceId,
    providerRecordId: input.providerRecordId,
    gmailThreadId: null,
    rfc822MessageId: "<fixture-spark-casual-on-1@example.org>",
    direction: "inbound",
    subject: "Re: Hex 31476: Were You Able to Pick Up Your ARU?",
    fromHeader: "Volunteer <volunteer@example.org>",
    toHeader: "PNW Forest Biodiversity <pnw@example.org>",
    ccHeader: null,
    labelIds: null,
    snippetClean: input.snippetClean,
    bodyTextPreview: input.bodyTextPreview,
    capturedMailbox,
    projectInboxAlias: capturedMailbox
  });

  return sourceEvidenceId;
}

describe("Stage 1 Gmail mbox body backfill ops", () => {
  it("reports dry-run counts without mutating the stored row", async () => {
    const context = await createTestWorkerContext();
    const record = await loadHistoricalMessageRecord();
    const sourceEvidenceId = await seedGmailMessageDetail({
      context,
      providerRecordId: record.recordId,
      bodyTextPreview: "Hi Samantha,\n\nThank you for these directions! I am planning",
      snippetClean: "Hi Samantha, Thank you for these directions! I am planning"
    });
    const logLines: string[] = [];

    try {
      const result = await backfillGmailMboxBodies({
        db: context.db,
        mboxText,
        mboxPath,
        capturedMailbox,
        liveAccount,
        projectInboxAliases,
        dryRun: true,
        logger: {
          info(message) {
            logLines.push(message);
          }
        }
      });

      expect(result).toMatchObject({
        dryRun: true,
        parsedRecords: 1,
        matchedExisting: 1,
        missingCount: 0,
        unchangedCount: 0,
        wouldUpdateCount: 1,
        updatedCount: 0
      });
      expect(logLines).toHaveLength(1);

      const [persisted] =
        await context.repositories.gmailMessageDetails.listBySourceEvidenceIds([
          sourceEvidenceId
        ]);

      expect(persisted?.bodyTextPreview).toBe(
        "Hi Samantha,\n\nThank you for these directions! I am planning"
      );
    } finally {
      await context.dispose();
    }
  });

  it("updates the row in execute mode when the reparsed body is longer", async () => {
    const context = await createTestWorkerContext();
    const record = await loadHistoricalMessageRecord();
    const sourceEvidenceId = await seedGmailMessageDetail({
      context,
      providerRecordId: record.recordId,
      bodyTextPreview: "Hi Samantha,\n\nThank you for these directions! I am planning",
      snippetClean: "Hi Samantha, Thank you for these directions! I am planning"
    });

    try {
      const result = await backfillGmailMboxBodies({
        db: context.db,
        mboxText,
        mboxPath,
        capturedMailbox,
        liveAccount,
        projectInboxAliases,
        dryRun: false
      });

      expect(result).toMatchObject({
        dryRun: false,
        matchedExisting: 1,
        wouldUpdateCount: 1,
        updatedCount: 1
      });

      const [persisted] =
        await context.repositories.gmailMessageDetails.listBySourceEvidenceIds([
          sourceEvidenceId
        ]);

      expect(persisted?.bodyTextPreview).toBe(record.bodyTextPreview);
      expect(persisted?.snippetClean).toBe(record.snippetClean);
    } finally {
      await context.dispose();
    }
  });

  it("leaves rows alone when the current body is already complete", async () => {
    const context = await createTestWorkerContext();
    const record = await loadHistoricalMessageRecord();
    const sourceEvidenceId = await seedGmailMessageDetail({
      context,
      providerRecordId: record.recordId,
      bodyTextPreview: record.bodyTextPreview,
      snippetClean: record.snippetClean
    });

    try {
      const result = await backfillGmailMboxBodies({
        db: context.db,
        mboxText,
        mboxPath,
        capturedMailbox,
        liveAccount,
        projectInboxAliases,
        dryRun: false
      });

      expect(result).toMatchObject({
        matchedExisting: 1,
        missingCount: 0,
        unchangedCount: 1,
        wouldUpdateCount: 0,
        updatedCount: 0
      });

      const [persisted] =
        await context.repositories.gmailMessageDetails.listBySourceEvidenceIds([
          sourceEvidenceId
        ]);

      expect(persisted?.bodyTextPreview).toBe(record.bodyTextPreview);
    } finally {
      await context.dispose();
    }
  });

  it("reports missing rows when no stored provider record matches", async () => {
    const context = await createTestWorkerContext();

    try {
      const result = await backfillGmailMboxBodies({
        db: context.db,
        mboxText,
        mboxPath,
        capturedMailbox,
        liveAccount,
        projectInboxAliases,
        dryRun: true
      });

      expect(result).toMatchObject({
        parsedRecords: 1,
        matchedExisting: 0,
        missingCount: 1,
        unchangedCount: 0,
        wouldUpdateCount: 0,
        updatedCount: 0
      });
    } finally {
      await context.dispose();
    }
  });

  it("matches and updates rows stored under the legacy mailbox-keyed provider id", async () => {
    const context = await createTestWorkerContext();
    const record = await loadHistoricalMessageRecord();
    const legacyProviderRecordId = buildLegacyMboxRecordId({
      rawMessage: extractRawMessage(mboxText),
      capturedMailbox
    });
    const sourceEvidenceId = await seedGmailMessageDetail({
      context,
      providerRecordId: legacyProviderRecordId,
      bodyTextPreview: "Hi Samantha,\n\nThank you for these directions! I am planning",
      snippetClean: "Hi Samantha, Thank you for these directions! I am planning"
    });

    try {
      const result = await backfillGmailMboxBodies({
        db: context.db,
        mboxText,
        mboxPath,
        capturedMailbox,
        liveAccount,
        projectInboxAliases,
        dryRun: false
      });

      expect(result).toMatchObject({
        matchedExisting: 1,
        missingCount: 0,
        wouldUpdateCount: 1,
        updatedCount: 1
      });

      const [persisted] =
        await context.repositories.gmailMessageDetails.listBySourceEvidenceIds([
          sourceEvidenceId
        ]);

      expect(persisted?.providerRecordId).toBe(legacyProviderRecordId);
      expect(persisted?.bodyTextPreview).toBe(record.bodyTextPreview);
    } finally {
      await context.dispose();
    }
  });
});
