import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { createStage5RepositoryBundle } from "@as-comms/db";

import { createTestStage1Context } from "./helpers.js";
import {
  runCampaignEventsTailFinalize,
} from "../src/jobs/campaign-events-tail-finalize/finalize.js";

type Stage1Context = Awaited<ReturnType<typeof createTestStage1Context>>;

async function seedRun(
  context: Stage1Context,
  input: {
    readonly id: string;
    readonly state: "complete" | "finalized";
    readonly completedAt: string;
  },
) {
  const campaigns = createStage5RepositoryBundle(context.db);
  await campaigns.campaignRuns.create({
    id: input.id,
    kind: "newsletter",
    launchType: "normal_email",
    projectId: null,
    name: null,
    fromEmail: "forests@adventurescientists.org",
    fromName: "Adventure Scientists",
    replyToEmail: "forests@adventurescientists.org",
    subjectTemplate: "Run detail",
    bodyHtmlTemplate: "<p>Hello</p>",
    bodyTextTemplate: "Hello",
    preheader: null,
    audienceCriteria: {
      projectId: null,
      projectIds: [],
      statuses: [],
      contactIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    audienceSize: 0,
    createdByUserId: null,
    lastEditedByUserId: null,
  });
  await context.db.execute(sql`
    update campaign_runs
    set state = ${input.state},
        completed_at = ${input.completedAt}::timestamptz
    where id = ${input.id}
  `);
}

describe("campaign events tail finalizer", () => {
  const contexts: Stage1Context[] = [];

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((context) => context.dispose()));
  });

  it("finalizes only complete runs older than 30 days", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    const campaigns = createStage5RepositoryBundle(context.db);

    await seedRun(context, {
      id: "run-old-complete",
      state: "complete",
      completedAt: "2026-03-01T12:00:00.000Z",
    });
    await seedRun(context, {
      id: "run-recent-complete",
      state: "complete",
      completedAt: "2026-05-01T12:00:00.000Z",
    });
    await seedRun(context, {
      id: "run-already-finalized",
      state: "finalized",
      completedAt: "2026-03-01T12:00:00.000Z",
    });

    const finalizedCount = await runCampaignEventsTailFinalize({
      db: context.db,
      campaigns,
      auditEvidence: context.repositories.auditEvidence,
      now: () => new Date("2026-05-16T12:00:00.000Z"),
    });

    expect(finalizedCount).toBe(1);
    await expect(
      campaigns.campaignRuns.findById("run-old-complete"),
    ).resolves.toMatchObject({
      state: "finalized",
      finalizedAt: "2026-05-16T12:00:00.000Z",
    });
    await expect(
      campaigns.campaignRuns.findById("run-recent-complete"),
    ).resolves.toMatchObject({
      state: "complete",
      finalizedAt: null,
    });

    const audits = await context.repositories.auditEvidence.listByEntity({
      entityType: "campaign_run",
      entityId: "run-old-complete",
    });
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "campaign_run.finalized",
        }),
      ]),
    );
  });
});
