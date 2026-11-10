import { describe, expect, it, vi } from "vitest";

import type {
  AudienceCriteria,
  CanonicalEventRecord,
  ContactMembershipRecord,
  ContactRecord,
  ProjectDimensionRecord,
  SalesforceSubscriptionBox,
} from "@as-comms/contracts";

import { createAudienceResolver } from "../src/audience-resolver.js";
import {
  createSubscriptionBoxAudienceResolver,
  listSyntheticLeadContactIds,
  loadSubscriptionBoxPlans,
  SubscriptionDataStaleError,
  type SubscriptionBoxAudienceSource,
} from "../src/subscription-box-audience.js";
import type {
  SettingsProjectEmailRecord,
  SettingsProjectRecord,
} from "../src/settings/records.js";

const at = new Date("2026-11-10T12:00:00.000Z");

function criteria(overrides: Partial<AudienceCriteria> = {}): AudienceCriteria {
  return {
    projectIds: ["beech"],
    statuses: [],
    expeditionIds: [],
    lastActivityWindow: "all_time",
    hasReplied: "either",
    hasClicked: "either",
    ...overrides,
  };
}

function contact(id: string, email = `${id}@example.org`): ContactRecord {
  return {
    id,
    salesforceContactId: null,
    displayName: `${id} Person`,
    primaryEmail: email,
    primaryPhone: null,
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
  };
}

function membership(
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
    createdAt: at.toISOString(),
    ...overrides,
  };
}

function project(
  projectId: string,
  projectName = projectId,
): ProjectDimensionRecord {
  return {
    projectId,
    projectName,
    projectAlias: projectId,
    connectedToProjectId: null,
    source: "salesforce",
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

function settingsProject(projectId: string): SettingsProjectRecord {
  const email: Pick<SettingsProjectEmailRecord, "address" | "isPrimary"> = {
    address: `${projectId}@adventurescientists.org`,
    isPrimary: true,
  };
  return {
    projectId,
    salesforceProjectId: null,
    projectName: projectId,
    projectAlias: projectId,
    postmarkSenderStatus: "verified",
    connectedToProjectId: null,
    isActive: true,
    aiKnowledgeUrl: null,
    aiKnowledgeSyncedAt: null,
    hasCachedAiKnowledge: false,
    createdAt: at,
    updatedAt: at,
    emails: [{ id: `${projectId}:email`, ...email, signature: "" }],
    memberCount: 0,
  };
}

function source(input: {
  boxes?: ReadonlyMap<string, SalesforceSubscriptionBox>;
  ticked?: ReadonlyMap<SalesforceSubscriptionBox, ReadonlySet<string>>;
  optedOut?: ReadonlySet<string>;
  refreshedAt?: Date | null;
}): SubscriptionBoxAudienceSource & {
  readonly lastRefreshedAtMock: ReturnType<typeof vi.fn>;
} {
  const lastRefreshedAtMock = vi
    .fn<SubscriptionBoxAudienceSource["lastRefreshedAt"]>()
    .mockResolvedValue(
      input.refreshedAt === undefined ? at : input.refreshedAt,
    );
  return {
    loadProjectBoxes: () => Promise.resolve(input.boxes ?? new Map()),
    listTickedContactIds: (box) =>
      Promise.resolve(input.ticked?.get(box) ?? new Set()),
    listProjectOptOutContactIds: () =>
      Promise.resolve(input.optedOut ?? new Set()),
    lastRefreshedAt: lastRefreshedAtMock,
    lastRefreshedAtMock,
  };
}

function resolver(input: {
  contacts?: readonly ContactRecord[];
  memberships?: readonly ContactMembershipRecord[];
  events?: readonly CanonicalEventRecord[];
  projects?: readonly ProjectDimensionRecord[];
  source: SubscriptionBoxAudienceSource;
  now?: () => Date;
}) {
  const contacts = input.contacts ?? [];
  const memberships = input.memberships ?? [];
  const projects = input.projects ?? [];
  const settings = new Map(
    projects.map((entry) => [entry.projectId, settingsProject(entry.projectId)]),
  );
  const repositories = {
    contacts: { listAll: () => Promise.resolve(contacts) },
    contactMemberships: {
      listByContactIds: (ids: readonly string[]) =>
        Promise.resolve(
          memberships.filter((entry) => ids.includes(entry.contactId)),
        ),
    },
    canonicalEvents: {
      listByContactIds: (ids: readonly string[]) =>
        Promise.resolve(
          (input.events ?? []).filter((entry) => ids.includes(entry.contactId)),
        ),
    },
    projectDimensions: {
      listByIds: (ids: readonly string[]) =>
        Promise.resolve(projects.filter((entry) => ids.includes(entry.projectId))),
    },
    settingsProjects: {
      findById: (id: string) => Promise.resolve(settings.get(id) ?? null),
    },
  };
  const membershipResolver = createAudienceResolver({ repositories });
  return createSubscriptionBoxAudienceResolver({
    repositories,
    source: input.source,
    membershipResolver,
    now: input.now ?? (() => at),
  });
}

const beechBox = "Beech and Butternut" as const;

describe("createSubscriptionBoxAudienceResolver", () => {
  it("uses subscription boxes for both project modes, including blank-status contacts", async () => {
    const audience = resolver({
      contacts: [contact("lead"), contact("no-membership"), contact("blank")],
      memberships: [
        membership("lead-membership", "lead", "beech", { status: "Lead" }),
        membership("blank-membership", "blank", "beech"),
      ],
      projects: [project("beech", "Beech")],
      source: source({
        boxes: new Map([["beech", beechBox]]),
        ticked: new Map([[beechBox, new Set(["lead", "no-membership", "blank"])]]),
      }),
    });

    await expect(
      audience.resolveAudience(
        criteria({ statuses: ["Lead"], initialFilter: "project_status" }),
        at,
      ),
    ).resolves.toMatchObject([
      { contactId: "lead", frozenProjectId: "beech" },
      { contactId: "no-membership", frozenProjectId: "beech" },
    ]);
    await expect(
      audience.resolveAudience(
        criteria({ initialFilter: "project_subscribed" }),
        at,
      ),
    ).resolves.toMatchObject([
      { contactId: "blank", frozenProjectName: "Beech" },
      { contactId: "lead" },
      { contactId: "no-membership" },
    ]);
  });

  it("combines real Lead members with synthetic Leads, but drops synthetic Leads when expeditions are selected", async () => {
    const audience = resolver({
      contacts: [contact("real"), contact("synthetic")],
      memberships: [
        membership("real-lead", "real", "beech", {
          status: "Lead",
          expeditionId: "expedition-1",
        }),
      ],
      projects: [project("beech")],
      source: source({
        boxes: new Map([["beech", beechBox]]),
        ticked: new Map([[beechBox, new Set(["real", "synthetic"])]]),
      }),
    });

    await expect(
      audience.resolveAudience(
        criteria({ statuses: ["Lead"], initialFilter: "project_status" }),
        at,
      ),
    ).resolves.toHaveLength(2);
    await expect(
      audience.resolveAudience(
        criteria({
          statuses: ["Lead"],
          expeditionIds: ["expedition-1"],
          initialFilter: "project_status",
        }),
        at,
      ),
    ).resolves.toMatchObject([{ contactId: "real" }]);
  });

  it("uses shared-box project opt-outs for either project in the box", async () => {
    const shared = source({
      boxes: new Map([
        ["beech", beechBox],
        ["butternut", beechBox],
      ]),
      ticked: new Map([[beechBox, new Set(["opted-out"])]]),
      optedOut: new Set(["opted-out"]),
    });
    const audience = resolver({
      contacts: [contact("opted-out")],
      projects: [project("beech"), project("butternut")],
      source: shared,
    });

    await expect(
      audience.resolveAudience(
        criteria({ initialFilter: "project_subscribed", projectIds: ["beech"] }),
        at,
      ),
    ).resolves.toEqual([]);
    await expect(
      audience.resolveAudience(
        criteria({ initialFilter: "project_subscribed", projectIds: ["butternut"] }),
        at,
      ),
    ).resolves.toEqual([]);
  });

  it("keeps an unboxed project exactly membership-backed without consulting freshness", async () => {
    const fakeSource = source({ refreshedAt: null });
    const input = {
      contacts: [contact("member")],
      memberships: [membership("member-a", "member", "unboxed", { status: "Lead" })],
      projects: [project("unboxed")],
    };
    const raw = createAudienceResolver({
      repositories: {
        contacts: { listAll: () => Promise.resolve(input.contacts) },
        contactMemberships: { listByContactIds: () => Promise.resolve(input.memberships) },
        canonicalEvents: { listByContactIds: () => Promise.resolve([]) },
        projectDimensions: { listByIds: () => Promise.resolve(input.projects) },
        settingsProjects: { findById: (id: string) => Promise.resolve(settingsProject(id)) },
      },
    });
    const boxed = resolver({ ...input, source: fakeSource });
    const selected = criteria({
      projectIds: ["unboxed"],
      statuses: ["Lead"],
      initialFilter: "project_status",
    });

    await expect(boxed.resolveAudience(selected, at)).resolves.toEqual(
      await raw.resolveAudience(selected, at),
    );
    expect(fakeSource.lastRefreshedAtMock).not.toHaveBeenCalled();
  });

  it.each([null, new Date("2026-11-10T10:59:59.999Z")])(
    "fails closed when the mirror heartbeat is stale (%s)",
    async (refreshedAt) => {
      const audience = resolver({
        contacts: [contact("person")],
        projects: [project("beech")],
        source: source({
          boxes: new Map([["beech", beechBox]]),
          refreshedAt,
        }),
      });

      await expect(
        audience.resolveAudience(
          criteria({ initialFilter: "project_subscribed" }),
          at,
        ),
      ).rejects.toBeInstanceOf(SubscriptionDataStaleError);
    },
  );

  it("uses one resolved audience for count and freeze candidates", async () => {
    const audience = resolver({
      contacts: [contact("a"), contact("b")],
      projects: [project("beech")],
      source: source({
        boxes: new Map([["beech", beechBox]]),
        ticked: new Map([[beechBox, new Set(["a", "b"])]]),
      }),
    });
    const selected = criteria({ initialFilter: "project_subscribed" });

    const frozenCandidates = await audience.resolveAudience(selected, at);
    await expect(audience.estimateCount(selected, at)).resolves.toBe(
      frozenCandidates.length,
    );
  });

  it("checks freshness against the wall clock, not a future send time", async () => {
    const audience = resolver({
      contacts: [contact("a")],
      projects: [project("beech")],
      source: source({
        boxes: new Map([["beech", beechBox]]),
        ticked: new Map([[beechBox, new Set(["a"])]]),
        refreshedAt: new Date("2026-11-10T11:55:00.000Z"),
      }),
    });
    const tomorrow = new Date("2026-11-11T15:00:00.000Z");

    await expect(
      audience.resolveAudience(criteria({ initialFilter: "project_subscribed" }), tomorrow),
    ).resolves.toHaveLength(1);
  });
});

describe("subscription box plans", () => {
  it("groups shared boxes, removes group opt-outs and leaves boxless projects out", async () => {
    const optOutQueries: string[][] = [];
    const plans = await loadSubscriptionBoxPlans(
      {
        ...source({
          boxes: new Map([["beech", beechBox], ["butternut", beechBox]]),
          ticked: new Map([[beechBox, new Set(["a", "b"])]]),
        }),
        listProjectOptOutContactIds: (projectIds) => {
          optOutQueries.push([...projectIds]);
          return Promise.resolve(new Set(["b"]));
        },
      },
      ["beech", "hemlock"],
    );

    expect([...plans.keys()]).toEqual(["beech"]);
    expect(plans.get("beech")?.groupedProjectIds).toEqual(["beech", "butternut"]);
    expect([...(plans.get("beech")?.tickedContactIds ?? [])]).toEqual(["a"]);
    expect(optOutQueries).toEqual([["beech", "butternut"]]);
  });

  it("counts a synthetic lead only with no membership anywhere in the box group", () => {
    const plan = {
      projectId: "beech",
      box: beechBox,
      groupedProjectIds: ["beech", "butternut"],
      tickedContactIds: new Set(["member", "sibling", "lead"]),
    };
    expect([
      ...listSyntheticLeadContactIds({
        plan,
        memberships: [
          { contactId: "member", projectId: "beech" },
          { contactId: "sibling", projectId: "butternut" },
          { contactId: "lead", projectId: "pnw" },
        ],
      }),
    ]).toEqual(["lead"]);
  });
});
