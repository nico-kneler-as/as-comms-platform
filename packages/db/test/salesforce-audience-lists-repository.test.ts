import { afterEach, describe, expect, it } from "vitest";

import type { SalesforceAudienceListsSnapshot } from "@as-comms/contracts";

import { createStage5RepositoryBundle } from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";

type TestContext = Awaited<ReturnType<typeof createTestStage1Context>>;

function snapshot(input: {
  readonly campaigns?: SalesforceAudienceListsSnapshot["campaigns"];
  readonly members?: SalesforceAudienceListsSnapshot["members"];
  readonly insiders?: SalesforceAudienceListsSnapshot["insiders"];
  readonly capturedAt?: string;
} = {}): SalesforceAudienceListsSnapshot {
  return {
    campaigns: input.campaigns ?? [],
    members: input.members ?? [],
    insiders: input.insiders ?? [],
    capturedAt: input.capturedAt ?? "2026-10-14T12:00:00.000Z",
  };
}

function campaign(id: string, name = id): SalesforceAudienceListsSnapshot["campaigns"][number] {
  return {
    id,
    name,
    campaignType: "Email",
    campaignStatus: "Planned",
    isActive: true,
    startDate: null,
    endDate: null,
    createdDate: "2026-01-01T00:00:00.000Z",
    lastModifiedDate: "2026-10-14T10:00:00.000Z",
    ownerName: "Devynn",
    numberOfContacts: 0,
    numberOfLeads: 0,
  };
}

describe("Salesforce audience lists repository", () => {
  let context: TestContext | undefined;

  afterEach(async () => {
    await context?.dispose();
    context = undefined;
  });

  it("replaces members, removes vanished campaigns, keeps zero-member lists, and is idempotent", async () => {
    context = await createTestStage1Context();
    const repository = createStage5RepositoryBundle(context.db).salesforceAudienceLists;

    await repository.replaceSnapshot(snapshot({
      campaigns: [campaign("701-old", "Old appeal")],
      members: [{
        campaignId: "701-old", contactId: "003-old", leadId: null,
        email: "Old@Example.org", status: "Sent",
      }],
      insiders: [{ id: "003-insider", email: "insider@example.org" }],
    }));

    const replacement = snapshot({
      campaigns: [campaign("701-zero", "Zero members")],
      insiders: [{ id: "003-insider", email: "insider@example.org" }],
      capturedAt: "2026-10-14T12:30:00.000Z",
    });
    await repository.replaceSnapshot(replacement);
    await repository.replaceSnapshot(replacement);

    expect(await repository.listAll()).toEqual([
      expect.objectContaining({
        id: "insiders", kind: "insiders", memberCount: 1,
        syncedAt: "2026-10-14T12:30:00.000Z",
      }),
      expect.objectContaining({
        id: "campaign:701-zero", kind: "campaign", memberCount: 0,
        syncedAt: "2026-10-14T12:30:00.000Z",
      }),
    ]);
    expect(await repository.emailsForLists(["campaign:701-old", "campaign:701-zero"])).toEqual([]);
    expect(await repository.lastSyncedAt()).toBe("2026-10-14T12:30:00.000Z");
  });

  it("de-duplicates normalized email unions across campaign and insider lists", async () => {
    context = await createTestStage1Context();
    const repository = createStage5RepositoryBundle(context.db).salesforceAudienceLists;

    await repository.replaceSnapshot(snapshot({
      campaigns: [campaign("701-a"), campaign("701-b")],
      members: [
        { campaignId: "701-a", contactId: "003-a", leadId: null, email: "Shared@Example.org", status: "Sent" },
        { campaignId: "701-b", contactId: null, leadId: "00Q-b", email: " shared@example.org ", status: "Responded" },
      ],
      insiders: [
        { id: "003-insider", email: "SHARED@example.org" },
        { id: "003-other", email: "Other@Example.org" },
      ],
    }));

    expect(await repository.emailsForLists([
      "campaign:701-a", "campaign:701-b", "insiders",
    ])).toEqual(["other@example.org", "shared@example.org"]);
  });
});
