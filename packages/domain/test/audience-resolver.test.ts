import { describe, expect, it } from "vitest";

import type {
  AudienceCriteria,
  CanonicalEventRecord,
  ContactMembershipRecord,
  ContactRecord,
  ProjectDimensionRecord,
} from "@as-comms/contracts";

import { createAudienceResolver } from "../src/audience-resolver.js";
import type {
  SettingsProjectEmailRecord,
  SettingsProjectRecord,
} from "../src/settings/records.js";

type SettingsProjectEmailStub = Pick<
  SettingsProjectEmailRecord,
  "address" | "isPrimary"
>;

type SettingsProjectStub = {
  readonly projectId: SettingsProjectRecord["projectId"];
  readonly connectedToProjectId: SettingsProjectRecord["connectedToProjectId"];
  readonly emails: readonly SettingsProjectEmailStub[];
} & Partial<
  Omit<SettingsProjectRecord, "projectId" | "connectedToProjectId" | "emails">
>;

function toSettingsProjectRecord(
  project: SettingsProjectStub,
): SettingsProjectRecord {
  return {
    projectId: project.projectId,
    salesforceProjectId: project.salesforceProjectId ?? null,
    projectName: project.projectName ?? project.projectId,
    projectAlias: project.projectAlias ?? project.projectId,
    postmarkSenderStatus: project.postmarkSenderStatus ?? "verified",
    connectedToProjectId: project.connectedToProjectId,
    isActive: project.isActive ?? true,
    aiKnowledgeUrl: project.aiKnowledgeUrl ?? null,
    aiKnowledgeSyncedAt: project.aiKnowledgeSyncedAt ?? null,
    hasCachedAiKnowledge: project.hasCachedAiKnowledge ?? false,
    createdAt: project.createdAt ?? new Date("2026-05-15T12:00:00.000Z"),
    emails: project.emails.map((email, index) => ({
      id: `email-${project.projectId}-${String(index + 1)}`,
      address: email.address,
      isPrimary: email.isPrimary,
      signature: "",
    })),
    memberCount: project.memberCount ?? 0,
    updatedAt: project.updatedAt ?? new Date("2026-05-15T12:00:00.000Z"),
  };
}

function buildCriteria(
  overrides: Partial<AudienceCriteria> = {},
): AudienceCriteria {
  return {
    projectIds: ["project-a"],
    statuses: [],
    expeditionIds: [],
    lastActivityWindow: "all_time",
    hasReplied: "either",
    hasClicked: "either",
    ...overrides,
  };
}

function buildContact(contactId: string, email = `${contactId}@example.org`): ContactRecord {
  return {
    id: contactId,
    salesforceContactId: null,
    displayName: `${contactId} Example`,
    primaryEmail: email,
    primaryPhone: null,
    createdAt: "2026-05-15T12:00:00.000Z",
    updatedAt: "2026-05-15T12:00:00.000Z",
  };
}

function buildMembership(
  id: string,
  contactId: string,
  projectId: string,
  overrides: Partial<ContactMembershipRecord> = {},
): ContactMembershipRecord {
  return {
    id,
    contactId,
    projectId,
    expeditionId: null,
    salesforceMembershipId: null,
    role: "volunteer",
    status: null,
    source: "salesforce",
    createdAt: "2026-05-15T12:00:00.000Z",
    ...overrides,
  };
}

function buildProject(
  projectId: string,
  projectName: string,
  connectedToProjectId: string | null = null,
): ProjectDimensionRecord {
  return {
    projectId,
    projectName,
    projectAlias: projectId,
    connectedToProjectId,
    source: "manual",
    isActive: true,
    aiKnowledgeUrl: null,
    aiKnowledgeSyncedAt: null,
    aiKnowledgeSources: [],
    aiOperatingContext: "",
    aiAutoSyncSchedule: "never",
    aiOptimizedSynthesizedAt: null,
    aiOptimizedInputHash: null,
  };
}

function buildEvent(
  id: string,
  contactId: string,
  eventType: CanonicalEventRecord["eventType"],
  occurredAt: string,
): CanonicalEventRecord {
  return {
    id,
    contactId,
    eventType,
    channel:
      eventType === "campaign.email.clicked"
        ? "campaign_email"
        : "email",
    occurredAt,
    contentFingerprint: null,
    sourceEvidenceId: `source-${id}`,
    idempotencyKey: `event-${id}`,
    provenance: {
      primaryProvider: "postmark",
      primarySourceEvidenceId: `source-${id}`,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: null,
      sourceRecordId: null,
      messageKind: "campaign",
      campaignRef: null,
      threadRef: null,
      direction: null,
    },
    reviewState: "clear",
  };
}

function createResolver(input: {
  contacts?: readonly ContactRecord[];
  memberships?: readonly ContactMembershipRecord[];
  events?: readonly CanonicalEventRecord[];
  projects?: readonly ProjectDimensionRecord[];
  settingsProjects?: readonly SettingsProjectStub[];
}) {
  const contacts = input.contacts ?? [];
  const memberships = input.memberships ?? [];
  const events = input.events ?? [];
  const projects = input.projects ?? [];
  const settingsProjects = new Map(
    (input.settingsProjects ?? []).map((project) => [
      project.projectId,
      toSettingsProjectRecord(project),
    ]),
  );

  return createAudienceResolver({
    repositories: {
      contacts: {
        listAll: () => Promise.resolve(contacts),
      },
      contactMemberships: {
        listByContactIds: (contactIds) =>
          Promise.resolve(
            memberships.filter((membership) => contactIds.includes(membership.contactId)),
          ),
      },
      canonicalEvents: {
        listByContactIds: (contactIds) =>
          Promise.resolve(
            events.filter((event) => contactIds.includes(event.contactId)),
          ),
      },
      projectDimensions: {
        listByIds: (projectIds) =>
          Promise.resolve(
            projects.filter((project) => projectIds.includes(project.projectId)),
          ),
      },
      settingsProjects: {
        findById: (projectId) =>
          Promise.resolve(settingsProjects.get(projectId) ?? null),
      },
    },
  });
}

describe("createAudienceResolver", () => {
  it("returns the union across selected projects with deterministic deduped contact ids", async () => {
    const resolver = createResolver({
      contacts: [buildContact("contact-2"), buildContact("contact-1")],
      memberships: [
        buildMembership("m-1", "contact-1", "project-a"),
        buildMembership("m-2", "contact-1", "project-b"),
        buildMembership("m-3", "contact-2", "project-b"),
      ],
      projects: [
        buildProject("project-a", "Project A"),
        buildProject("project-b", "Project B"),
      ],
      settingsProjects: [
        {
          projectId: "project-a",
          connectedToProjectId: null,
          emails: [{ address: "a@example.org", isPrimary: true }],
        },
        {
          projectId: "project-b",
          connectedToProjectId: null,
          emails: [{ address: "b@example.org", isPrimary: true }],
        },
      ],
    });

    const audience = await resolver.resolveAudience(
      buildCriteria({ projectIds: ["project-a", "project-b"] }),
      new Date("2026-05-15T12:00:00.000Z"),
    );

    expect(audience.map((member) => member.contactId)).toEqual([
      "contact-1",
      "contact-2",
    ]);
    expect(audience[0]).toMatchObject({
      frozenProjectId: "project-a",
      frozenProjectName: "Project A",
      frozenAliasEmail: "a@example.org",
    });
  });

  it("treats connected sub-projects as equal-rank picks rather than host rollups", async () => {
    const resolver = createResolver({
      contacts: [
        buildContact("host-contact"),
        buildContact("sub-contact"),
      ],
      memberships: [
        buildMembership("m-host", "host-contact", "project-host"),
        buildMembership("m-sub", "sub-contact", "project-sub"),
      ],
      projects: [
        buildProject("project-host", "Host"),
        buildProject("project-sub", "Sub", "project-host"),
      ],
      settingsProjects: [
        {
          projectId: "project-host",
          connectedToProjectId: null,
          emails: [{ address: "host@example.org", isPrimary: true }],
        },
        {
          projectId: "project-sub",
          connectedToProjectId: "project-host",
          emails: [],
        },
      ],
    });

    await expect(
      resolver.resolveAudience(
        buildCriteria({ projectIds: ["project-host"] }),
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toHaveLength(1);
    await expect(
      resolver.resolveAudience(
        buildCriteria({ projectIds: ["project-sub"] }),
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject([
      {
        contactId: "sub-contact",
        frozenAliasEmail: "host@example.org",
      },
    ]);
    await expect(
      resolver.resolveAudience(
        buildCriteria({ projectIds: ["project-host", "project-sub"] }),
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toHaveLength(2);
  });

  it("applies expedition member status filters", async () => {
    const resolver = createResolver({
      contacts: [buildContact("active"), buildContact("inactive")],
      memberships: [
        buildMembership("m-1", "active", "project-a", { status: "Waitlist" }),
        buildMembership("m-2", "inactive", "project-a", { status: "Denied" }),
      ],
      projects: [buildProject("project-a", "Project A")],
      settingsProjects: [
        {
          projectId: "project-a",
          connectedToProjectId: null,
          emails: [{ address: "a@example.org", isPrimary: true }],
        },
      ],
    });

    const audience = await resolver.resolveAudience(
      buildCriteria({ statuses: ["Waitlist"] }),
      new Date("2026-05-15T12:00:00.000Z"),
    );

    expect(audience.map((member) => member.contactId)).toEqual(["active"]);
  });

  it("applies last-activity windows", async () => {
    const resolver = createResolver({
      contacts: [buildContact("recent"), buildContact("stale")],
      memberships: [
        buildMembership("m-1", "recent", "project-a"),
        buildMembership("m-2", "stale", "project-a"),
      ],
      events: [
        buildEvent(
          "event-recent",
          "recent",
          "communication.email.inbound",
          "2026-05-01T12:00:00.000Z",
        ),
        buildEvent(
          "event-stale",
          "stale",
          "communication.email.inbound",
          "2025-01-01T12:00:00.000Z",
        ),
      ],
      projects: [buildProject("project-a", "Project A")],
      settingsProjects: [
        {
          projectId: "project-a",
          connectedToProjectId: null,
          emails: [{ address: "a@example.org", isPrimary: true }],
        },
      ],
    });

    const audience = await resolver.resolveAudience(
      buildCriteria({ lastActivityWindow: "last_90_days" }),
      new Date("2026-05-15T12:00:00.000Z"),
    );

    expect(audience.map((member) => member.contactId)).toEqual(["recent"]);
  });

  it("applies has-replied and has-clicked filters", async () => {
    const resolver = createResolver({
      contacts: [
        buildContact("replied"),
        buildContact("clicked"),
        buildContact("quiet"),
      ],
      memberships: [
        buildMembership("m-1", "replied", "project-a"),
        buildMembership("m-2", "clicked", "project-a"),
        buildMembership("m-3", "quiet", "project-a"),
      ],
      events: [
        buildEvent(
          "reply",
          "replied",
          "communication.email.inbound",
          "2026-05-10T12:00:00.000Z",
        ),
        buildEvent(
          "click",
          "clicked",
          "campaign.email.clicked",
          "2026-05-11T12:00:00.000Z",
        ),
      ],
      projects: [buildProject("project-a", "Project A")],
      settingsProjects: [
        {
          projectId: "project-a",
          connectedToProjectId: null,
          emails: [{ address: "a@example.org", isPrimary: true }],
        },
      ],
    });

    await expect(
      resolver.resolveAudience(
        buildCriteria({ hasReplied: "yes" }),
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject([{ contactId: "replied" }]);
    await expect(
      resolver.resolveAudience(
        buildCriteria({ hasClicked: "yes" }),
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject([{ contactId: "clicked" }]);
  });

  it("deduplicates contacts that match multiple selected projects", async () => {
    const resolver = createResolver({
      contacts: [buildContact("contact-1")],
      memberships: [
        buildMembership("m-1", "contact-1", "project-a"),
        buildMembership("m-2", "contact-1", "project-b"),
      ],
      projects: [
        buildProject("project-a", "Project A"),
        buildProject("project-b", "Project B"),
      ],
      settingsProjects: [
        {
          projectId: "project-a",
          connectedToProjectId: null,
          emails: [{ address: "a@example.org", isPrimary: true }],
        },
        {
          projectId: "project-b",
          connectedToProjectId: null,
          emails: [{ address: "b@example.org", isPrimary: true }],
        },
      ],
    });

    const audience = await resolver.resolveAudience(
      buildCriteria({ projectIds: ["project-a", "project-b"] }),
      new Date("2026-05-15T12:00:00.000Z"),
    );

    expect(audience).toHaveLength(1);
  });

  it("returns zero rows when no criteria projects are selected", async () => {
    const resolver = createResolver({
      contacts: [buildContact("contact-1")],
      memberships: [buildMembership("m-1", "contact-1", "project-a")],
      projects: [buildProject("project-a", "Project A")],
      settingsProjects: [
        {
          projectId: "project-a",
          connectedToProjectId: null,
          emails: [{ address: "a@example.org", isPrimary: true }],
        },
      ],
    });

    await expect(
      resolver.resolveAudience(
        buildCriteria({ projectIds: [] }),
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toEqual([]);
    await expect(
      resolver.estimateCount(
        buildCriteria({ projectIds: [] }),
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toBe(0);
  });
});
