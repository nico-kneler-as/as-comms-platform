import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveSmsDraftProjectId } from "../../src/server/ai/resolve-sms-draft-project";
import {
  createInboxTestRuntime,
  seedInboxContact,
  seedInboxEmailEvent,
  type InboxTestRuntime,
} from "./inbox-stage1-helpers";

function buildUser() {
  const now = new Date("2026-07-10T10:00:00.000Z");
  return {
    id: "user:resolver",
    name: "Resolver User",
    email: "resolver@adventurescientists.org",
    emailVerified: now,
    image: null,
    role: "operator" as const,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function seedProject(
  runtime: InboxTestRuntime,
  input: {
    readonly projectId: string;
    readonly projectName: string;
    readonly projectAlias: string;
    readonly isActive?: boolean;
  },
): Promise<void> {
  await runtime.context.repositories.projectDimensions.upsert({
    projectId: input.projectId,
    projectName: input.projectName,
    projectAlias: input.projectAlias,
    source: "salesforce",
    isActive: input.isActive ?? true,
  });
}

async function seedAlias(
  runtime: InboxTestRuntime,
  input: {
    readonly projectId: string;
    readonly alias: string;
  },
): Promise<void> {
  await runtime.context.settings.users.upsert(buildUser());
  await runtime.context.settings.aliases.replaceForProject({
    projectId: input.projectId,
    aliases: [input.alias],
    actorId: "user:resolver",
  });
}

describe("resolveSmsDraftProjectId", () => {
  let runtime: InboxTestRuntime | null = null;

  beforeEach(async () => {
    runtime = await createInboxTestRuntime();
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("prefers the last inbound email alias project over memberships", async () => {
    if (runtime === null) {
      throw new Error("runtime not initialized");
    }

    await seedProject(runtime, {
      projectId: "project:memberships",
      projectName: "Membership Project",
      projectAlias: "Membership Project",
    });
    await seedProject(runtime, {
      projectId: "project:alias-wins",
      projectName: "Alias Project",
      projectAlias: "Alias Project",
    });
    await seedAlias(runtime, {
      projectId: "project:alias-wins",
      alias: "alias-project@example.org",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:alias-history",
      salesforceContactId: "003-alias-history",
      displayName: "Alias History",
      primaryEmail: "alias-history@example.org",
      primaryPhone: "+14065550130",
      projectId: "project:memberships",
      projectName: "Membership Project",
      membershipId: "membership:alias-history",
      membershipStatus: "active",
    });
    await seedInboxEmailEvent(runtime.context, {
      id: "alias-history-email",
      contactId: "contact:alias-history",
      occurredAt: "2026-07-09T12:00:00.000Z",
      direction: "inbound",
      subject: "Question",
      snippet: "Inbound question",
      projectInboxAlias: "alias-project@example.org",
    });

    await expect(
      resolveSmsDraftProjectId(
        {
          repositories: runtime.runtime.repositories,
          aliases: runtime.runtime.settings.aliases,
          timelinePresentation: runtime.runtime.timelinePresentation,
        },
        "contact:alias-history",
      ),
    ).resolves.toBe("project:alias-wins");
  });

  it("falls back to the single distinct active membership project when no alias history exists", async () => {
    if (runtime === null) {
      throw new Error("runtime not initialized");
    }

    await seedProject(runtime, {
      projectId: "project:active-only",
      projectName: "Active Project",
      projectAlias: "Active Project",
      isActive: true,
    });
    await seedProject(runtime, {
      projectId: "project:inactive-secondary",
      projectName: "Inactive Project",
      projectAlias: "Inactive Project",
      isActive: false,
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:single-active",
      salesforceContactId: "003-single-active",
      displayName: "Single Active",
      primaryEmail: "single-active@example.org",
      primaryPhone: "+14065550131",
      projectId: "project:active-only",
      projectName: "Active Project",
      membershipId: "membership:single-active-active",
      membershipStatus: "active",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:single-active",
      salesforceContactId: "003-single-active",
      displayName: "Single Active",
      primaryEmail: "single-active@example.org",
      primaryPhone: "+14065550131",
      projectId: "project:inactive-secondary",
      projectName: "Inactive Project",
      membershipId: "membership:single-active-inactive",
      membershipStatus: "lead",
    });
    await runtime.context.settings.projects.setActive(
      "project:inactive-secondary",
      false,
    );

    await expect(
      resolveSmsDraftProjectId(
        {
          repositories: runtime.runtime.repositories,
          aliases: runtime.runtime.settings.aliases,
          timelinePresentation: runtime.runtime.timelinePresentation,
        },
        "contact:single-active",
      ),
    ).resolves.toBe("project:active-only");
  });

  it("uses the primary membership ordering when multiple active memberships exist", async () => {
    if (runtime === null) {
      throw new Error("runtime not initialized");
    }

    await seedProject(runtime, {
      projectId: "project:lead-priority",
      projectName: "Lead Priority",
      projectAlias: "Lead Priority",
    });
    await seedProject(runtime, {
      projectId: "project:active-secondary",
      projectName: "Active Secondary",
      projectAlias: "Active Secondary",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:primary-membership",
      salesforceContactId: "003-primary-membership",
      displayName: "Primary Membership",
      primaryEmail: "primary-membership@example.org",
      primaryPhone: "+14065550132",
      projectId: "project:active-secondary",
      projectName: "Active Secondary",
      membershipId: "membership:primary-active",
      membershipStatus: "active",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:primary-membership",
      salesforceContactId: "003-primary-membership",
      displayName: "Primary Membership",
      primaryEmail: "primary-membership@example.org",
      primaryPhone: "+14065550132",
      projectId: "project:lead-priority",
      projectName: "Lead Priority",
      membershipId: "membership:primary-lead",
      membershipStatus: "lead",
    });

    await expect(
      resolveSmsDraftProjectId(
        {
          repositories: runtime.runtime.repositories,
          aliases: runtime.runtime.settings.aliases,
          timelinePresentation: runtime.runtime.timelinePresentation,
        },
        "contact:primary-membership",
      ),
    ).resolves.toBe("project:lead-priority");
  });

  it("returns null when neither alias history nor memberships resolve a project", async () => {
    if (runtime === null) {
      throw new Error("runtime not initialized");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:no-project",
      salesforceContactId: "003-no-project",
      displayName: "No Project",
      primaryEmail: "no-project@example.org",
      primaryPhone: "+14065550133",
    });

    await expect(
      resolveSmsDraftProjectId(
        {
          repositories: runtime.runtime.repositories,
          aliases: runtime.runtime.settings.aliases,
          timelinePresentation: runtime.runtime.timelinePresentation,
        },
        "contact:no-project",
      ),
    ).resolves.toBeNull();
  });
});
