import { afterEach, describe, expect, it } from "vitest";

import {
  broadcastLinkClicks,
  broadcastOpens,
  clearBroadcastUploadedExclusionsForRun,
  createStage5RepositoryBundle,
  emailsForPreviousRunAudience,
  listBroadcastUploadedExclusionsForRun,
  upsertBroadcastUploadedExclusionsForRun,
} from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";

type TestContext = Awaited<ReturnType<typeof createTestStage1Context>>;

async function seedRun(context: TestContext, id: string) {
  return createStage5RepositoryBundle(context.db).campaignRuns.create({
    id, kind: "newsletter", launchType: "normal_email", projectId: null,
    name: null, fromEmail: null, fromName: null, replyToEmail: null,
    subjectTemplate: null, subjectTemplateB: null, abTestEnabled: false,
    bodyHtmlTemplate: null, bodyDesignJson: null, bodyTextTemplate: null,
    preheader: null, audienceCriteria: {}, audienceSize: null,
    createdByUserId: null, lastEditedByUserId: null,
  });
}

describe("audience composition repository", () => {
  let context: TestContext | undefined;
  afterEach(async () => { await context?.dispose(); context = undefined; });

  it("upserts/deduplicates and clears uploaded exclusions", async () => {
    context = await createTestStage1Context();
    await seedRun(context, "run-exclusions");
    expect(await upsertBroadcastUploadedExclusionsForRun(context.db, "run-exclusions", ["A@example.org", "a@example.org", "b@example.org"])).toBe(2);
    expect(await listBroadcastUploadedExclusionsForRun(context.db, "run-exclusions")).toEqual(["a@example.org", "b@example.org"]);
    await clearBroadcastUploadedExclusionsForRun(context.db, "run-exclusions");
    expect(await listBroadcastUploadedExclusionsForRun(context.db, "run-exclusions")).toEqual([]);
  });

  it("reads previous recipients, openers, and clickers by frozen normalized email", async () => {
    context = await createTestStage1Context();
    const bundle = createStage5RepositoryBundle(context.db);
    await seedRun(context, "run-prior");
    await bundle.audienceSnapshots.bulkInsert("run-prior", [
      { id: "snapshot-sent", contactId: null, newsletterSubscriberId: null, frozenEmail: "Sent@Example.org", frozenFirstName: null, frozenProjectName: null, frozenProjectId: null, frozenAliasEmail: null, unsubscribeToken: "token-sent", deliveryStatus: "sent", providerMessageId: null, sentAt: null, deliveredAt: null, bouncedAt: null, openedAt: null, clickedAt: null, complainedAt: null, unsubscribedAt: null, lastEventAt: null },
      { id: "snapshot-pending", contactId: null, newsletterSubscriberId: null, frozenEmail: "pending@example.org", frozenFirstName: null, frozenProjectName: null, frozenProjectId: null, frozenAliasEmail: null, unsubscribeToken: "token-pending", deliveryStatus: "pending", providerMessageId: null, sentAt: null, deliveredAt: null, bouncedAt: null, openedAt: null, clickedAt: null, complainedAt: null, unsubscribedAt: null, lastEventAt: null },
    ]);
    await context.db.insert(broadcastOpens).values({ id: "open-1", campaignRunId: "run-prior", audienceSnapshotId: "snapshot-sent", contactId: null, openedAt: new Date(), userAgent: null, platform: null, client: null, os: null, geo: null, isBot: false, botReason: null, idempotencyKey: "open-key" });
    await context.db.insert(broadcastLinkClicks).values({ id: "click-1", campaignRunId: "run-prior", audienceSnapshotId: "snapshot-sent", contactId: null, originalLink: "https://example.org", clickedAt: new Date(), userAgent: null, platform: null, client: null, os: null, geo: null, isBot: false, botReason: null, idempotencyKey: "click-key" });
    await expect(emailsForPreviousRunAudience(context.db, "run-prior", "recipients")).resolves.toEqual(["sent@example.org"]);
    await expect(emailsForPreviousRunAudience(context.db, "run-prior", "openers")).resolves.toEqual(["sent@example.org"]);
    await expect(emailsForPreviousRunAudience(context.db, "run-prior", "clickers")).resolves.toEqual(["sent@example.org"]);
  });
});
