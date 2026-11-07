import { afterEach, describe, expect, it } from "vitest";

import { createStage1RepositoryBundle } from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";

type TestContext = Awaited<ReturnType<typeof createTestStage1Context>>;

async function seedProject(
  context: TestContext,
  projectId: string,
): Promise<void> {
  await createStage1RepositoryBundle(context.db).projectDimensions.upsert({
    projectId,
    projectName: projectId,
    source: "salesforce",
  });
}

describe("project subscription-box repository", () => {
  let context: TestContext | undefined;

  afterEach(async () => {
    await context?.dispose();
    context = undefined;
  });

  it("sets listed boxes, clears stale values, and ignores unknown projects", async () => {
    context = await createTestStage1Context();
    const repository = createStage1RepositoryBundle(
      context.db,
    ).projectDimensions;
    await seedProject(context, "a0A000000000001AAA");
    await seedProject(context, "a0A000000000002AAA");
    await repository.replaceProjectSubscriptionBoxes(
      [
        {
          projectId: "a0A000000000001AAA",
          subscriptionBox: "PNW Forest Monitoring",
        },
        {
          projectId: "a0A000000000002AAA",
          subscriptionBox: "Beech and Butternut",
        },
      ],
      new Date("2026-11-07T12:00:00.000Z"),
    );

    const result = await repository.replaceProjectSubscriptionBoxes(
      [
        {
          projectId: "a0A000000000001AAA",
          subscriptionBox: "Tracking Whitebark Pine",
        },
        {
          projectId: "a0A000000009999AAA",
          subscriptionBox: "Coral Reef Expansion",
        },
      ],
      new Date("2026-11-07T13:00:00.000Z"),
    );

    expect(result).toEqual({
      updated: 1,
      cleared: 1,
      unknownProjectIds: ["a0A000000009999AAA"],
    });
    expect(await repository.listProjectSubscriptionBoxes()).toEqual(
      new Map([["a0A000000000001AAA", "Tracking Whitebark Pine"]]),
    );
    expect(
      (await repository.listAll()).map((project) => project.projectId),
    ).toEqual(["a0A000000000001AAA", "a0A000000000002AAA"]);
  });

  it("does not touch projects whose box is unchanged", async () => {
    context = await createTestStage1Context();
    const repository = createStage1RepositoryBundle(
      context.db,
    ).projectDimensions;
    await seedProject(context, "a0A000000000001AAA");
    const rows = [
      {
        projectId: "a0A000000000001AAA",
        subscriptionBox: "PNW Forest Monitoring",
      },
    ];
    await repository.replaceProjectSubscriptionBoxes(
      rows,
      new Date("2026-11-07T12:00:00.000Z"),
    );

    const rerun = await repository.replaceProjectSubscriptionBoxes(
      rows,
      new Date("2026-11-07T13:00:00.000Z"),
    );

    expect(rerun).toEqual({ updated: 0, cleared: 0, unknownProjectIds: [] });
    expect(await repository.listProjectSubscriptionBoxes()).toEqual(
      new Map([["a0A000000000001AAA", "PNW Forest Monitoring"]]),
    );
  });
});
