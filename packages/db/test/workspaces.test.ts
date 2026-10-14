import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreateDraftInput } from "@as-comms/contracts";

import {
  createStage5RepositoryBundle,
  type Stage5RepositoryBundle,
} from "../src/index.js";
import { createTestStage1Context, type TestStage1Context } from "./helpers.js";

function createUserRecord(id: string, email: string) {
  const now = new Date("2026-10-14T10:00:00.000Z");

  return {
    id,
    name: id,
    email,
    emailVerified: now,
    image: null,
    role: "operator" as const,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildNewsletterDraft(
  id: string,
  workspace?: CreateDraftInput["workspace"],
): CreateDraftInput {
  return {
    id,
    ...(workspace === undefined ? {} : { workspace }),
    kind: "newsletter",
    launchType: "html_email",
    projectId: null,
    name: id,
    fromEmail: "donate@example.org",
    fromName: "Adventure Scientists",
    replyToEmail: "donate@example.org",
    subjectTemplate: "Subject",
    bodyHtmlTemplate: "<p>Hello</p>",
    bodyTextTemplate: "Hello",
    bodyDesignJson: null,
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

describe("workspaces", () => {
  let context: TestStage1Context;
  let campaigns: Stage5RepositoryBundle;

  beforeEach(async () => {
    context = await createTestStage1Context();
    campaigns = createStage5RepositoryBundle(context.db);
  });

  afterEach(async () => {
    await context.dispose();
  });

  it("gives a newly created user the volunteers workspace", async () => {
    await context.settings.users.upsert(
      createUserRecord("user:new", "new@example.org"),
    );

    await expect(
      context.settings.users.listWorkspaces("user:new"),
    ).resolves.toEqual(["volunteers"]);
  });

  it("keeps chosen workspaces when an existing user is upserted again", async () => {
    await context.settings.users.upsert(
      createUserRecord("user:devynn", "devynn@example.org"),
    );
    await context.settings.users.setWorkspaces("user:devynn", ["donors"]);

    await context.settings.users.upsert(
      createUserRecord("user:devynn", "devynn@example.org"),
    );

    await expect(
      context.settings.users.listWorkspaces("user:devynn"),
    ).resolves.toEqual(["donors"]);
  });

  it("replaces workspaces, de-duplicates them and returns them in a stable order", async () => {
    await context.settings.users.upsert(
      createUserRecord("user:both", "both@example.org"),
    );

    await expect(
      context.settings.users.setWorkspaces("user:both", [
        "donors",
        "volunteers",
        "donors",
      ]),
    ).resolves.toEqual(["volunteers", "donors"]);
    await expect(
      context.settings.users.listWorkspaces("user:both"),
    ).resolves.toEqual(["volunteers", "donors"]);
  });

  it("refuses to leave a user without any workspace", async () => {
    await context.settings.users.upsert(
      createUserRecord("user:none", "none@example.org"),
    );

    await expect(
      context.settings.users.setWorkspaces("user:none", []),
    ).rejects.toThrow();
    await expect(
      context.settings.users.listWorkspaces("user:none"),
    ).resolves.toEqual(["volunteers"]);
  });

  it("defaults campaign runs to the volunteers workspace and filters by workspace", async () => {
    await campaigns.campaignRuns.create(buildNewsletterDraft("run-volunteers"));
    await campaigns.campaignRuns.create(
      buildNewsletterDraft("run-donors", "donors"),
    );

    await expect(
      campaigns.campaignRuns.findById("run-volunteers"),
    ).resolves.toMatchObject({ workspace: "volunteers" });
    await expect(
      campaigns.campaignRuns.findById("run-donors"),
    ).resolves.toMatchObject({ workspace: "donors" });

    const donorRuns = await campaigns.campaignRuns.listRecent({
      workspace: "donors",
    });
    expect(donorRuns.map((run) => run.id)).toEqual(["run-donors"]);

    const volunteerRows = await campaigns.campaignRunProjection.listRecent({
      workspace: "volunteers",
    });
    expect(volunteerRows.map((row) => row.runId)).toEqual(["run-volunteers"]);
  });
});
