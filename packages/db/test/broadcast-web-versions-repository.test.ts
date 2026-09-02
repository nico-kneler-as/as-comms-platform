import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CreateDraftInput } from "@as-comms/contracts";

import { createStage5RepositoryBundle } from "../src/index.js";
import { createTestStage1Context, type TestStage1Context } from "./helpers.js";

function buildRun(id: string): CreateDraftInput {
  return {
    id,
    kind: "newsletter",
    launchType: "normal_email",
    projectId: null,
    name: null,
    fromEmail: "newsletter@example.org",
    fromName: null,
    replyToEmail: null,
    subjectTemplate: "Subject",
    subjectTemplateB: null,
    abTestEnabled: false,
    bodyHtmlTemplate: "<p>Hello</p>",
    bodyDesignJson: null,
    bodyTextTemplate: "Hello",
    preheader: null,
    audienceCriteria: {
      projectId: null,
      projectIds: [],
      statuses: [],
      contactIds: [],
      newsletterSubscriberIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    audienceSize: null,
    createdByUserId: null,
    lastEditedByUserId: null,
  };
}

describe("broadcast web versions repository", () => {
  let context: TestStage1Context;

  beforeEach(async () => {
    context = await createTestStage1Context();
  });

  afterEach(async () => {
    await context.dispose();
  });

  it("ensures, renders once, and publishes a single run-level version", async () => {
    const campaigns = createStage5RepositoryBundle(context.db);
    await campaigns.campaignRuns.create(buildRun("run-web-version"));

    const first = await campaigns.broadcastWebVersions.ensure("run-web-version");
    const second = await campaigns.broadcastWebVersions.ensure("run-web-version");
    expect(second.publicToken).toBe(first.publicToken);

    await campaigns.broadcastWebVersions.storeRendered("run-web-version", {
      html: "<html>first</html>",
      title: "First",
    });
    await campaigns.broadcastWebVersions.storeRendered("run-web-version", {
      html: "<html>second</html>",
      title: "Second",
    });

    const published = await campaigns.broadcastWebVersions.findPublishedByToken(
      first.publicToken,
    );
    expect(published).toMatchObject({
      renderedHtml: "<html>first</html>",
      title: "First",
    });

    await campaigns.broadcastWebVersions.setPublished("run-web-version", {
      published: false,
      userId: null,
    });
    await expect(
      campaigns.broadcastWebVersions.findPublishedByToken(first.publicToken),
    ).resolves.toBeNull();

    await campaigns.broadcastWebVersions.setPublished("run-web-version", {
      published: true,
      userId: null,
    });
    await expect(
      campaigns.broadcastWebVersions.findPublishedByToken(first.publicToken),
    ).resolves.toMatchObject({ publicToken: first.publicToken });
    await expect(
      campaigns.broadcastWebVersions.findPublishedByToken("unknown"),
    ).resolves.toBeNull();
  });

  it("does not expose an unrendered version", async () => {
    const campaigns = createStage5RepositoryBundle(context.db);
    await campaigns.campaignRuns.create(buildRun("run-pending-web-version"));
    const version = await campaigns.broadcastWebVersions.ensure(
      "run-pending-web-version",
    );

    await expect(
      campaigns.broadcastWebVersions.findPublishedByToken(version.publicToken),
    ).resolves.toBeNull();
  });
});
