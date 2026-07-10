import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type {
  BroadcastLinkClickRecordInput,
  CreateDraftInput,
} from "@as-comms/contracts";
import {
  audienceSnapshots,
  createStage5RepositoryBundle,
  insertBroadcastLinkClick,
  listBroadcastLinkClicksForRun,
  type Stage5RepositoryBundle,
} from "@as-comms/db";

import { backfillBroadcastClickClassification } from "../src/ops/backfill-broadcast-click-classification.js";
import { createTestWorkerContext, type TestWorkerContext } from "./helpers.js";

const silentLogger = { error: (...args: readonly unknown[]) => void args.length };

const DELIVERED_AT = new Date("2026-07-01T13:00:00.000Z");
const HUMAN_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0 Safari/537.36";
const SCANNER_UA =
  "Mozilla/5.0 (compatible; Microsoft-SafeLinks/1.0; +https://aka.ms/safelinks)";

function buildDraftInput(id: string, projectId = "project-1"): CreateDraftInput {
  return {
    id,
    kind: "project",
    launchType: "normal_email",
    projectId,
    name: null,
    fromEmail: "project@example.org",
    fromName: "Adventure Scientists",
    replyToEmail: "project@example.org",
    subjectTemplate: "Subject",
    bodyHtmlTemplate: "<p>Hello</p>",
    bodyTextTemplate: "Hello",
    bodyDesignJson: null,
    preheader: null,
    audienceCriteria: {
      projectId,
      projectIds: [projectId],
      statuses: [],
      contactIds: [],
      newsletterSubscriberIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    audienceSize: 1,
    createdByUserId: null,
    lastEditedByUserId: null,
  };
}

function buildClick(
  overrides: Partial<BroadcastLinkClickRecordInput> &
    Pick<BroadcastLinkClickRecordInput, "id" | "idempotencyKey">,
): BroadcastLinkClickRecordInput {
  const { id, idempotencyKey, ...rest } = overrides;
  return {
    campaignRunId: "run-1",
    audienceSnapshotId: "snapshot-1",
    contactId: "contact-1",
    originalLink: "https://example.org/a",
    clickedAt: "2026-07-01T18:00:00.000Z",
    userAgent: HUMAN_UA,
    platform: "Desktop",
    client: null,
    os: null,
    geo: null,
    createdAt: "2026-07-01T18:00:00.000Z",
    ...rest,
    id,
    idempotencyKey,
  };
}

async function readClicks(context: TestWorkerContext) {
  const rows = await listBroadcastLinkClicksForRun(context.db, "run-1");
  return new Map(rows.map((row) => [row.id, row]));
}

describe("backfill-broadcast-click-classification", () => {
  let context: TestWorkerContext;
  let campaigns: Stage5RepositoryBundle;

  beforeEach(async () => {
    context = await createTestWorkerContext();
    campaigns = createStage5RepositoryBundle(context.db);

    await context.repositories.projectDimensions.upsert({
      projectId: "project-1",
      projectName: "Project 1",
      projectAlias: "alias-project-1",
      connectedToProjectId: null,
      source: "manual",
      isActive: true,
      aiKnowledgeUrl: null,
      aiKnowledgeSyncedAt: null,
      aiKnowledgeSources: [],
      aiOperatingContext: "",
      aiAutoSyncSchedule: "never",
      aiOptimizedSynthesizedAt: null,
      aiOptimizedInputHash: null,
    });
    await context.repositories.contacts.upsert({
      id: "contact-1",
      salesforceContactId: null,
      displayName: "Contact One",
      primaryEmail: "contact-1@example.org",
      primaryPhone: null,
      createdAt: "2026-07-01T12:00:00.000Z",
      updatedAt: "2026-07-01T12:00:00.000Z",
    });

    await campaigns.campaignRuns.create(buildDraftInput("run-1"));
    await campaigns.audienceSnapshots.bulkInsert("run-1", [
      {
        id: "snapshot-1",
        contactId: "contact-1",
        newsletterSubscriberId: null,
        frozenEmail: "contact-1@example.org",
        frozenFirstName: "Contact",
        frozenProjectName: "Project 1",
        frozenProjectId: "project-1",
        frozenAliasEmail: "project@example.org",
        unsubscribeToken: "token-1",
        deliveryStatus: "delivered",
        providerMessageId: "pm-1",
      },
    ]);
    // Give the snapshot a known delivery time for the fast-activity signal.
    await context.db
      .update(audienceSnapshots)
      .set({ deliveredAt: DELIVERED_AT })
      .where(eq(audienceSnapshots.id, "snapshot-1"));

    // A: scanner UA, clicked hours later -> machine_user_agent.
    await insertBroadcastLinkClick(
      context.db,
      buildClick({
        id: "click-scanner",
        idempotencyKey: "idem-scanner",
        userAgent: SCANNER_UA,
      }),
    );
    // B: human UA, clicked hours later -> stays human.
    await insertBroadcastLinkClick(
      context.db,
      buildClick({ id: "click-human", idempotencyKey: "idem-human" }),
    );
    // C: human UA, clicked 1s after delivery -> fast_activity.
    await insertBroadcastLinkClick(
      context.db,
      buildClick({
        id: "click-fast",
        idempotencyKey: "idem-fast",
        clickedAt: "2026-07-01T13:00:01.000Z",
      }),
    );
    // D: no snapshot (metadata-only), human UA -> stays human (no delivery ref).
    await insertBroadcastLinkClick(
      context.db,
      buildClick({
        id: "click-orphan",
        idempotencyKey: "idem-orphan",
        audienceSnapshotId: null,
        contactId: null,
      }),
    );
  });

  it("dry-run reports would-change counts without writing", async () => {
    const result = await backfillBroadcastClickClassification({
      db: context.db,
      dryRun: true,
      logger: silentLogger,
    });

    expect(result.dryRun).toBe(true);
    expect(result.scanned).toBe(4);
    expect(result.changed).toBe(2);
    expect(result.flaggedBot).toBe(2);
    expect(result.byReason).toEqual({ machine_user_agent: 1, fast_activity: 1 });
    expect(result.updatedCount).toBe(0);

    const clicks = await readClicks(context);
    for (const click of clicks.values()) {
      expect(click.isBot).toBe(false);
      expect(click.botReason).toBeNull();
    }
  });

  it("execute classifies existing rows and is idempotent", async () => {
    const first = await backfillBroadcastClickClassification({
      db: context.db,
      dryRun: false,
      logger: silentLogger,
    });

    expect(first.changed).toBe(2);
    expect(first.updatedCount).toBe(2);

    const clicks = await readClicks(context);
    expect(clicks.get("click-scanner")).toMatchObject({
      isBot: true,
      botReason: "machine_user_agent",
    });
    expect(clicks.get("click-fast")).toMatchObject({
      isBot: true,
      botReason: "fast_activity",
    });
    expect(clicks.get("click-human")).toMatchObject({
      isBot: false,
      botReason: null,
    });
    expect(clicks.get("click-orphan")).toMatchObject({
      isBot: false,
      botReason: null,
    });

    const second = await backfillBroadcastClickClassification({
      db: context.db,
      dryRun: false,
      logger: silentLogger,
    });
    expect(second.changed).toBe(0);
    expect(second.updatedCount).toBe(0);
  });
});
