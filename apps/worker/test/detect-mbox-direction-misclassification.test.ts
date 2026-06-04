import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { gmailMessageDetails } from "@as-comms/db";
import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";
import { detectMboxDirectionMisclassification } from "../src/ops/detect-mbox-direction-misclassification.js";

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === undefined) {
      continue;
    }

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === ",") {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if (!inQuotes && char === "\n") {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentCell = "";
      currentRow = [];
      continue;
    }

    if (char !== "\r") {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  const [header, ...body] = rows;
  if (header === undefined) {
    return [];
  }

  return body
    .filter((row) => row.length === header.length)
    .map((row) =>
      Object.fromEntries(header.map((column, index) => [column, row[index] ?? ""])),
    );
}

async function seedContact(
  context: Awaited<ReturnType<typeof createTestStage1Context>>,
  input: {
    readonly id: string;
    readonly displayName: string;
    readonly primaryEmail: string | null;
    readonly salesforceContactId?: string | null;
  },
): Promise<void> {
  await context.repositories.contacts.upsert({
    id: input.id,
    displayName: input.displayName,
    primaryEmail: input.primaryEmail,
    primaryPhone: null,
    salesforceContactId: input.salesforceContactId ?? null,
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
  });
}

async function seedTeamIdentity(
  context: Awaited<ReturnType<typeof createTestStage1Context>>,
  input: {
    readonly contactId: string;
    readonly normalizedValue: string;
  },
): Promise<void> {
  await context.repositories.contactIdentities.upsert({
    id: `identity:${input.contactId}:${input.normalizedValue}`,
    contactId: input.contactId,
    kind: "email",
    normalizedValue: input.normalizedValue,
    isPrimary: true,
    source: "salesforce",
    verifiedAt: "2026-06-04T00:00:00.000Z",
  });
}

async function seedProjectAlias(
  context: Awaited<ReturnType<typeof createTestStage1Context>>,
  alias: string,
): Promise<void> {
  await context.settings.aliases.create({
    id: `alias:${alias}`,
    alias,
    signature: "",
    projectId: null,
    createdAt: new Date("2026-06-04T00:00:00.000Z"),
    updatedAt: new Date("2026-06-04T00:00:00.000Z"),
    createdBy: null,
    updatedBy: null,
  });
}

async function seedCandidate(
  context: Awaited<ReturnType<typeof createTestStage1Context>>,
  input: {
    readonly canonicalEventId: string;
    readonly sourceEvidenceId: string;
    readonly providerRecordId: string;
    readonly contactId: string;
    readonly direction: "inbound" | "outbound";
    readonly bodyTextPreview: string;
    readonly subject?: string | null;
    readonly capturedMailbox?: string;
    readonly fromHeader?: string | null;
  },
): Promise<void> {
  await context.repositories.sourceEvidence.append({
    id: input.sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: input.providerRecordId,
    payloadRef: `gmail://message/${input.providerRecordId}`,
    checksum: `checksum:${input.providerRecordId}`,
    occurredAt: "2026-06-04T00:00:00.000Z",
    receivedAt: "2026-06-04T00:00:00.000Z",
    idempotencyKey: `source:${input.providerRecordId}`,
  });

  await context.repositories.canonicalEvents.upsert({
    id: input.canonicalEventId,
    contactId: input.contactId,
    eventType:
      input.direction === "inbound"
        ? "communication.email.inbound"
        : "communication.email.outbound",
    channel: "email",
    occurredAt: "2026-06-04T00:00:00.000Z",
    contentFingerprint: null,
    sourceEvidenceId: input.sourceEvidenceId,
    idempotencyKey: `canonical:${input.canonicalEventId}`,
    provenance: {
      primaryProvider: "gmail",
      primarySourceEvidenceId: input.sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "message",
      sourceRecordId: input.providerRecordId,
      messageKind: "one_to_one",
      campaignRef: null,
      threadRef: {
        crossProviderCollapseKey: `rfc822:<${input.providerRecordId}@example.org>`,
        providerThreadId: "gmail-thread-1",
      },
      direction: input.direction,
      notes: null,
    },
    reviewState: "clear",
  });

  await context.db.insert(gmailMessageDetails).values({
    sourceEvidenceId: input.sourceEvidenceId,
    providerRecordId: input.providerRecordId,
    gmailThreadId: "gmail-thread-1",
    rfc822MessageId: `<${input.providerRecordId}@example.org>`,
    direction: input.direction,
    subject: input.subject ?? "Test subject",
    fromHeader: input.fromHeader ?? "",
    toHeader: "",
    ccHeader: "",
    fromEmails: [],
    toEmails: [],
    ccEmails: [],
    bccEmails: [],
    labelIds: [],
    snippetClean: input.bodyTextPreview,
    bodyTextPreview: input.bodyTextPreview,
    bodyKind: "text/plain",
    capturedMailbox:
      input.capturedMailbox ?? "orcas@adventurescientists.org",
    projectInboxAlias: "orcas@adventurescientists.org",
    createdAt: new Date("2026-06-04T00:00:00.000Z"),
    updatedAt: new Date("2026-06-04T00:00:00.000Z"),
  });
}

describe("detect-mbox-direction-misclassification", () => {
  it("classifies blank-from mbox rows across each heuristic branch and writes CSV output", async () => {
    const context = await createTestStage1Context();
    const outputDir = await mkdtemp(
      path.join(os.tmpdir(), "mbox-direction-report-"),
    );

    try {
      await seedProjectAlias(context, "orcas@adventurescientists.org");

      await seedContact(context, {
        id: "contact:salesforce:ricky",
        displayName: "Ricky",
        primaryEmail: "ricky@adventurescientists.org",
        salesforceContactId: "003RICKY",
      });
      await seedTeamIdentity(context, {
        contactId: "contact:salesforce:ricky",
        normalizedValue: "ricky@adventurescientists.org",
      });

      await seedContact(context, {
        id: "contact:external:crystal",
        displayName: "Crystal Roy",
        primaryEmail: "crystal@example.org",
      });
      await seedContact(context, {
        id: "contact:external:pat",
        displayName: "Pat Client",
        primaryEmail: "pat@example.org",
      });
      await seedContact(context, {
        id: "contact:external:url",
        displayName: "URL Contact",
        primaryEmail: "url@example.org",
      });
      await seedContact(context, {
        id: "contact:external:campaign",
        displayName: "Campaign Contact",
        primaryEmail: "campaign@example.org",
      });
      await seedContact(context, {
        id: "contact:external:nosignal",
        displayName: "No Signal",
        primaryEmail: "nosignal@example.org",
      });
      await seedContact(context, {
        id: "contact:external:ignored",
        displayName: "Ignored Contact",
        primaryEmail: "ignored@example.org",
      });

      await seedCandidate(context, {
        canonicalEventId: "canonical:signature",
        sourceEvidenceId: "source:signature",
        providerRecordId: "message-signature",
        contactId: "contact:external:crystal",
        direction: "inbound",
        bodyTextPreview:
          "Thanks for helping.\nBest,\nRicky\nricky@adventurescientists.org",
      });
      await seedCandidate(context, {
        canonicalEventId: "canonical:greeting-contact",
        sourceEvidenceId: "source:greeting-contact",
        providerRecordId: "message-greeting-contact",
        contactId: "contact:external:crystal",
        direction: "inbound",
        bodyTextPreview: "Hey Crystal, congratulations on getting out there.",
      });
      await seedCandidate(context, {
        canonicalEventId: "canonical:greeting-team",
        sourceEvidenceId: "source:greeting-team",
        providerRecordId: "message-greeting-team",
        contactId: "contact:external:pat",
        direction: "outbound",
        bodyTextPreview: "Hi Ricky, thanks for the update from the field.",
      });
      await seedCandidate(context, {
        canonicalEventId: "canonical:url",
        sourceEvidenceId: "source:url",
        providerRecordId: "message-url",
        contactId: "contact:external:url",
        direction: "inbound",
        bodyTextPreview:
          "Learn more at https://www.adventurescientists.org/contact",
      });
      await seedCandidate(context, {
        canonicalEventId: "canonical:campaign",
        sourceEvidenceId: "source:campaign",
        providerRecordId: "message-campaign",
        contactId: "contact:external:campaign",
        direction: "inbound",
        bodyTextPreview: "View in browser\nunsubscribe\n[image: logo]",
      });
      await seedCandidate(context, {
        canonicalEventId: "canonical:no-signal",
        sourceEvidenceId: "source:no-signal",
        providerRecordId: "message-no-signal",
        contactId: "contact:external:nosignal",
        direction: "outbound",
        bodyTextPreview: "Checking in about the trailhead schedule.",
      });
      await seedCandidate(context, {
        canonicalEventId: "canonical:ignored",
        sourceEvidenceId: "source:ignored",
        providerRecordId: "message-ignored",
        contactId: "contact:external:ignored",
        direction: "inbound",
        bodyTextPreview: "Hey Ignored, this should not be scanned.",
        fromHeader: "ignored@example.org",
      });

      const result = await detectMboxDirectionMisclassification({
        db: context.db,
        reportTimestamp: "2026-06-04T12-00-00.000Z",
        outputDir,
      });

      expect(result.summary).toMatchObject({
        candidateRows: 6,
        suggestedOutboundHigh: 2,
        suggestedInboundHigh: 1,
        suggestedOutboundMedium: 0,
        suggestedUnknownLow: 1,
        noSignal: 1,
        campaignAutomatedExcluded: 1,
      });

      const csvRows = parseCsv(await readFile(result.outputPath, "utf8"));
      const byCanonicalEventId = new Map(
        csvRows.map((row) => [row.canonical_event_id, row] as const),
      );

      expect(byCanonicalEventId.get("canonical:signature")).toMatchObject({
        suggested_direction: "outbound",
        confidence: "high",
      });
      expect(byCanonicalEventId.get("canonical:greeting-contact")).toMatchObject({
        suggested_direction: "outbound",
        confidence: "high",
      });
      expect(byCanonicalEventId.get("canonical:greeting-team")).toMatchObject({
        suggested_direction: "inbound",
        confidence: "high",
      });
      expect(byCanonicalEventId.get("canonical:url")).toMatchObject({
        suggested_direction: "unknown",
        confidence: "low",
      });
      expect(byCanonicalEventId.get("canonical:campaign")).toMatchObject({
        suggested_direction: "excluded",
        confidence: "low",
      });
      expect(byCanonicalEventId.get("canonical:no-signal")).toMatchObject({
        suggested_direction: "no_signal",
        confidence: "low",
      });
      expect(byCanonicalEventId.has("canonical:ignored")).toBe(false);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
      await context.dispose();
    }
  });
});
