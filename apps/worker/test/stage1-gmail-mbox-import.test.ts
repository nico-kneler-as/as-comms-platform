import { describe, expect, it } from "vitest";

import {
  buildSourceEvidenceId,
  buildSourceEvidenceIdempotencyKey,
  importGmailMboxRecords,
  mapGmailRecord,
  sha256Text
} from "@as-comms/integrations";

import {
  createStage1GmailMboxImportService,
  resolveGmailMboxRecordId
} from "../src/ops/gmail-mbox.js";
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

function buildImporter(context: TestWorkerContext) {
  return createStage1GmailMboxImportService({
    ingest: context.ingest,
    persistence: context.persistence,
    syncState: context.syncState,
    now: () => new Date("2026-01-04T00:01:00.000Z")
  });
}

function buildImportInput(
  overrides?: Partial<{
    readonly mboxText: string;
    readonly mboxPath: string;
    readonly capturedMailbox: string;
    readonly syncStateId: string;
    readonly correlationId: string;
    readonly receivedAt: string;
    readonly overwriteBodies: boolean;
  }>
) {
  return {
    mboxText: overrides?.mboxText ?? mboxText,
    mboxPath:
      overrides?.mboxPath ?? "/tmp/project-antarctica.mbox",
    capturedMailbox:
      overrides?.capturedMailbox ?? "project-antarctica@example.org",
    liveAccount: "volunteers@adventurescientists.org",
    projectInboxAliases: ["project-antarctica@example.org"],
    syncStateId: overrides?.syncStateId ?? "sync:gmail:mbox",
    correlationId: overrides?.correlationId ?? "corr:gmail:mbox",
    traceId: null,
    receivedAt: overrides?.receivedAt ?? "2026-01-04T00:01:00.000Z",
    overwriteBodies: overrides?.overwriteBodies ?? false
  };
}

function extractLegacyRawMessage(value: string): string {
  return value
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .split("\n")
    .slice(1)
    .join("\n")
    .trim();
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
}

function buildLegacyMboxRecordIdLocal(input: {
  readonly rawMessage: string;
  readonly capturedMailbox: string;
}): string {
  return `mbox:${sha256Text(
    `${input.capturedMailbox.toLowerCase()}\n${normalizeLineEndings(input.rawMessage)}`
  )}`;
}

async function buildMappedHistoricalCommand(
  overrides?: Partial<{
    readonly mboxText: string;
    readonly mboxPath: string;
    readonly capturedMailbox: string;
    readonly receivedAt: string;
  }>
) {
  const [record] = await importGmailMboxRecords({
    mboxText: overrides?.mboxText ?? mboxText,
    mboxPath: overrides?.mboxPath ?? "/tmp/project-antarctica.mbox",
    capturedMailbox:
      overrides?.capturedMailbox ?? "project-antarctica@example.org",
    liveAccount: "volunteers@adventurescientists.org",
    projectInboxAliases: ["project-antarctica@example.org"],
    receivedAt: overrides?.receivedAt ?? "2026-01-04T00:01:00.000Z"
  });

  if (record?.recordType !== "message") {
    throw new Error("Expected a Gmail historical message record.");
  }

  const mapped = mapGmailRecord(record);

  if (mapped.outcome !== "command" || mapped.command.kind !== "canonical_event") {
    throw new Error("Expected Gmail historical import to map to a canonical event.");
  }

  if (mapped.command.input.gmailMessageDetail === undefined) {
    throw new Error("Expected Gmail historical import to include Gmail detail.");
  }

  return {
    record,
    commandInput: {
      ...mapped.command.input,
      gmailMessageDetail: mapped.command.input.gmailMessageDetail
    }
  };
}

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
    memberships: [
      {
        id: `membership:${contactId}:project-stage1`,
        contactId,
        projectId: "project-stage1",
        expeditionId: "expedition-stage1",
        role: "volunteer",
        status: "active",
        source: "salesforce",
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    ]
  });
}

describe("Stage 1 Gmail .mbox importer", () => {
  it("uses the same historical Gmail ingest path and stays replay-safe on repeated import", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact(context);
      const importer = buildImporter(context);

      const firstRun = await importer.importMbox(
        buildImportInput({
          syncStateId: "sync:gmail:mbox:first",
          correlationId: "corr:gmail:mbox:first"
        })
      );
      const secondRun = await importer.importMbox(
        buildImportInput({
          syncStateId: "sync:gmail:mbox:second",
          correlationId: "corr:gmail:mbox:second",
          receivedAt: "2026-01-04T00:02:00.000Z"
        })
      );

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

  it("keeps the same Takeout replay duplicate-safe when the mbox file path changes", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact(context);
      const importer = buildImporter(context);
      const { record } = await buildMappedHistoricalCommand();

      const firstRun = await importer.importMbox(
        buildImportInput({
          mboxPath: "/tmp/original/orcas.mbox",
          syncStateId: "sync:gmail:mbox:path:first",
          correlationId: "corr:gmail:mbox:path:first"
        })
      );
      const secondRun = await importer.importMbox(
        buildImportInput({
          mboxPath: "/tmp/mbox/MBox Files/orcas.mbox",
          syncStateId: "sync:gmail:mbox:path:second",
          correlationId: "corr:gmail:mbox:path:second",
          receivedAt: "2026-01-04T00:02:00.000Z"
        })
      );

      expect(firstRun.summary).toMatchObject({
        normalized: 1,
        quarantined: 0
      });
      expect(secondRun.summary).toMatchObject({
        duplicate: 1,
        quarantined: 0
      });
      await expect(context.repositories.canonicalEvents.countAll()).resolves.toBe(1);

      const audits = await context.repositories.auditEvidence.listByEntity({
        entityType: "source_evidence",
        entityId: `gmail:message:${record.recordId}`
      });

      expect(
        audits.some(
          (audit) =>
            audit.policyCode === "stage1.quarantine.replay_checksum_mismatch"
        )
      ).toBe(false);
    } finally {
      await context.dispose();
    }
  });

  it("uses the same source evidence row when capturedMailbox changes", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact(context);
      const importer = buildImporter(context);
      const { record } = await buildMappedHistoricalCommand();

      const firstRun = await importer.importMbox(
        buildImportInput({
          syncStateId: "sync:gmail:mbox:mailbox:first",
          correlationId: "corr:gmail:mbox:mailbox:first"
        })
      );
      const secondRun = await importer.importMbox(
        buildImportInput({
          capturedMailbox: "volunteers@adventurescientists.org",
          syncStateId: "sync:gmail:mbox:mailbox:second",
          correlationId: "corr:gmail:mbox:mailbox:second",
          receivedAt: "2026-01-04T00:02:00.000Z"
        })
      );

      expect(firstRun.summary).toMatchObject({
        normalized: 1,
        quarantined: 0
      });
      expect(secondRun.summary).toMatchObject({
        duplicate: 1,
        quarantined: 0
      });
      await expect(context.repositories.canonicalEvents.countAll()).resolves.toBe(1);
      await expect(
        context.persistence.findSourceEvidenceByIdempotencyKey(
          buildSourceEvidenceIdempotencyKey("gmail", "message", record.recordId)
        )
      ).resolves.toMatchObject({
        id: buildSourceEvidenceId("gmail", "message", record.recordId),
        providerRecordId: record.recordId
      });
    } finally {
      await context.dispose();
    }
  });

  it("reuses legacy mbox source evidence ids when a re-import matches an existing row", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact(context);
      const { commandInput } = await buildMappedHistoricalCommand();
      const legacyProviderRecordId = buildLegacyMboxRecordIdLocal({
        rawMessage: extractLegacyRawMessage(mboxText),
        capturedMailbox: "project-antarctica@example.org"
      });
      const legacySourceEvidenceId = buildSourceEvidenceId(
        "gmail",
        "message",
        legacyProviderRecordId
      );
      const preferredProviderRecordId =
        "mbox:stable-provider-record-id-for-legacy-compatibility";

      await context.normalization.applyNormalizedCanonicalEvent({
        ...commandInput,
        sourceEvidence: {
          ...commandInput.sourceEvidence,
          id: legacySourceEvidenceId,
          providerRecordId: legacyProviderRecordId,
          idempotencyKey: buildSourceEvidenceIdempotencyKey(
            "gmail",
            "message",
            legacyProviderRecordId
          )
        },
        gmailMessageDetail: {
          ...commandInput.gmailMessageDetail,
          sourceEvidenceId: legacySourceEvidenceId,
          providerRecordId: legacyProviderRecordId
        }
      });

      const resolvedProviderRecordId = await resolveGmailMboxRecordId(
        context.persistence,
        {
          messageIndex: 1,
          checksum: commandInput.sourceEvidence.checksum,
          preferredRecordId: preferredProviderRecordId,
          legacyRecordIds: [legacyProviderRecordId],
          occurredAt: "2026-01-04T00:02:00.000Z"
        }
      );

      expect(resolvedProviderRecordId).toBe(legacyProviderRecordId);
      await expect(
        context.persistence.findSourceEvidenceByIdempotencyKey(
          buildSourceEvidenceIdempotencyKey("gmail", "message", legacyProviderRecordId)
        )
      ).resolves.toMatchObject({
        id: legacySourceEvidenceId,
        providerRecordId: legacyProviderRecordId
      });
      await expect(
        context.persistence.findSourceEvidenceByIdempotencyKey(
          buildSourceEvidenceIdempotencyKey(
            "gmail",
            "message",
            preferredProviderRecordId
          )
        )
      ).resolves.toBeNull();

      const audits = await context.repositories.auditEvidence.listByEntity({
        entityType: "source_evidence",
        entityId: `gmail:message:${legacyProviderRecordId}`
      });

      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "reuse_legacy_mbox_record_id",
        policyCode: "stage1.mapper.gmail_mbox_record_id_compatibility"
      });
      expect(audits[0]?.metadataJson).toMatchObject({
        preferredProviderRecordId,
        resolvedProviderRecordId: legacyProviderRecordId
      });
    } finally {
      await context.dispose();
    }
  });

  it("only overwrites Gmail body detail on duplicate re-imports when overwriteBodies is enabled", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact(context);
      const importer = buildImporter(context);
      const { commandInput } = await buildMappedHistoricalCommand();
      const sourceEvidenceId = commandInput.sourceEvidence.id;

      await context.normalization.applyNormalizedCanonicalEvent({
        ...commandInput,
        gmailMessageDetail: {
          ...commandInput.gmailMessageDetail,
          subject: "Legacy subject",
          snippetClean: "Legacy snippet",
          bodyTextPreview: "Legacy body preview"
        }
      });

      const defaultReplay = await importer.importMbox(
        buildImportInput({
          syncStateId: "sync:gmail:mbox:overwrite:default",
          correlationId: "corr:gmail:mbox:overwrite:default",
          receivedAt: "2026-01-04T00:02:00.000Z"
        })
      );

      expect(defaultReplay.summary).toMatchObject({
        duplicate: 1,
        quarantined: 0
      });
      await expect(
        context.repositories.gmailMessageDetails.listBySourceEvidenceIds([
          sourceEvidenceId
        ])
      ).resolves.toEqual([
        expect.objectContaining({
          sourceEvidenceId,
          subject: "Legacy subject",
          snippetClean: "Legacy snippet",
          bodyTextPreview: "Legacy body preview"
        })
      ]);

      const overwriteReplay = await importer.importMbox(
        buildImportInput({
          syncStateId: "sync:gmail:mbox:overwrite:enabled",
          correlationId: "corr:gmail:mbox:overwrite:enabled",
          receivedAt: "2026-01-04T00:03:00.000Z",
          overwriteBodies: true
        })
      );

      expect(overwriteReplay.summary).toMatchObject({
        duplicate: 1,
        quarantined: 0
      });
      await expect(
        context.repositories.gmailMessageDetails.listBySourceEvidenceIds([
          sourceEvidenceId
        ])
      ).resolves.toEqual([
        expect.objectContaining({
          sourceEvidenceId,
          subject: "Historical volunteer reply",
          snippetClean: "Reply from the volunteer",
          bodyTextPreview: "Reply from the volunteer"
        })
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("creates different rows for distinct mbox messages when Message-ID is absent", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact(context);
      const importer = buildImporter(context);
      const messageWithoutMessageIdA = `From MAILER-DAEMON Fri Jan 04 00:00:00 2026
Date: Sun, 04 Jan 2026 00:00:00 +0000
From: Volunteer <volunteer@example.org>
To: Project Antarctica <project-antarctica@example.org>
Subject: Historical volunteer reply

Reply from the volunteer
`;
      const messageWithoutMessageIdB = `From MAILER-DAEMON Fri Jan 04 00:00:00 2026
Date: Sun, 04 Jan 2026 00:00:00 +0000
From: Volunteer <volunteer@example.org>
To: Project Antarctica <project-antarctica@example.org>
Subject: Historical volunteer reply

Reply from the volunteer with a different body.
`;

      const firstRun = await importer.importMbox(
        buildImportInput({
          mboxText: messageWithoutMessageIdA,
          mboxPath: "/tmp/no-message-id-a.mbox",
          syncStateId: "sync:gmail:mbox:no-id:first",
          correlationId: "corr:gmail:mbox:no-id:first"
        })
      );
      const secondRun = await importer.importMbox(
        buildImportInput({
          mboxText: messageWithoutMessageIdB,
          mboxPath: "/tmp/no-message-id-b.mbox",
          syncStateId: "sync:gmail:mbox:no-id:second",
          correlationId: "corr:gmail:mbox:no-id:second",
          receivedAt: "2026-01-04T00:02:00.000Z"
        })
      );

      expect(firstRun.summary).toMatchObject({
        normalized: 1,
        quarantined: 0
      });
      expect(secondRun.summary).toMatchObject({
        normalized: 1,
        quarantined: 0
      });
      await expect(context.repositories.canonicalEvents.countAll()).resolves.toBe(2);
    } finally {
      await context.dispose();
    }
  });
});
