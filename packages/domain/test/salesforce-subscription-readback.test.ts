import { describe, expect, it } from "vitest";

import {
  planSubscriptionReadback,
  type MirrorRow,
  type PlatformConsentState,
} from "../src/salesforce-subscription-readback.js";

const T = "2026-11-07T12:00:00.000Z";
const boxes = {
  "PNW Forest Monitoring": false,
  "Beech and Butternut": false,
  "Tracking Whitebark Pine": false,
  "Coral Reef Expansion": false,
  "Monitoring Killer Whales Project": false,
} as const;
const state: PlatformConsentState = {
  consentsByContact: new Map(),
  newsletterSubscribersByEmail: new Map(),
  newsletterSuppressionsByEmail: new Map(),
  suppressionEmails: new Set(),
};
const record = (overrides: Partial<Record<string, unknown>> = {}) => ({
  salesforceRecordId: "esp-1",
  email: "person@example.org",
  salesforceContactId: "sf-1",
  generalNewsletter: false,
  oregonShoresNewsletter: false,
  projectBoxes: boxes,
  unsubscribedFromAll: false,
  unsubscribedAt: null,
  emailBounced: false,
  recordCreationSource: null,
  isDeleted: false,
  lastModifiedAt: T,
  lastModifiedById: null,
  lastModifiedByUsername: "staff@example.org",
  ...overrides,
});
const mirror = (input = record()): MirrorRow => ({
  ...input,
  sfLastModifiedAt: input.lastModifiedAt,
  sfLastModifiedById: input.lastModifiedById,
  capturedAt: input.lastModifiedAt,
});
function plan(input: {
  current?: ReturnType<typeof record>;
  old?: MirrorRow;
  state?: PlatformConsentState;
  contacts?: readonly string[];
  projects?: readonly string[];
  mode?: "apply" | "dry_run";
  forms?: readonly string[];
  baseline?: boolean;
}) {
  const current = input.current ?? record();
  return planSubscriptionReadback({
    mode: input.mode ?? "apply",
    baseline: input.baseline ?? false,
    records: [current],
    mirror:
      input.old === undefined ? new Map() : new Map([["esp-1", input.old]]),
    integrationUsername: "integration@example.org",
    formsUsernames: input.forms ?? ["forms@example.org"],
    contactsByRecordId: new Map([["esp-1", input.contacts ?? ["contact-1"]]]),
    projectsByBox: new Map([
      ["PNW Forest Monitoring", input.projects ?? ["project-1"]],
    ]),
    platformState: input.state ?? state,
  });
}
const event = (input: Parameters<typeof plan>[0]) => plan(input).events[0];
const noActions: readonly string[] = [];

describe("Salesforce subscription readback planner", () => {
  it.each([
    [
      "integration any direction",
      record({
        generalNewsletter: true,
        lastModifiedByUsername: "INTEGRATION@example.org",
      }),
      undefined,
      "skipped_integration_user",
    ],
    [
      "integration false",
      record({ lastModifiedByUsername: "integration@example.org" }),
      mirror(record({ generalNewsletter: true })),
      "skipped_integration_user",
    ],
    [
      "forms General false",
      record({ lastModifiedByUsername: "forms@example.org" }),
      mirror(record({ generalNewsletter: true })),
      "skipped_form_false",
    ],
    [
      "staff General false",
      record(),
      mirror(record({ generalNewsletter: true })),
      "applied",
    ],
  ])("respects actor precedence: %s", (_name, current, old, outcome) => {
    expect(
      event(old === undefined ? { current } : { current, old })?.outcome,
    ).toBe(outcome);
  });
  it("allows a forms user ticking a box to clear an existing opt-out", () => {
    const result = event({
      current: record({
        projectBoxes: { ...boxes, "PNW Forest Monitoring": true },
        lastModifiedByUsername: "forms@example.org",
      }),
      old: mirror(record()),
      state: {
        ...state,
        consentsByContact: new Map([
          [
            "contact-1",
            [
              {
                id: "project",
                contactId: "contact-1",
                scopeType: "project",
                scopeId: "project-1",
                optedOutAt: T,
              },
            ],
          ],
        ]),
      },
    });
    expect(result?.outcome).toBe("applied");
  });

  it.each([
    [
      "inserts consent and suppression",
      state,
      "applied",
      ["insert_consent", "insert_suppression"],
    ],
    [
      "does not duplicate suppression",
      {
        ...state,
        newsletterSuppressionsByEmail: new Map([
          ["person@example.org", { reason: "platform_optout", updatedAt: T }],
        ]),
      },
      "applied",
      ["insert_consent"],
    ],
    [
      "protects newer subscriber",
      {
        ...state,
        newsletterSubscribersByEmail: new Map([
          [
            "person@example.org",
            { status: "subscribed", lastChangedAt: "2026-11-07T13:00:00.000Z" },
          ],
        ]),
      },
      "skipped_platform_newer",
      noActions,
    ],
  ])("handles General false: %s", (_name, platformState, outcome, kinds) => {
    const result = event({
      current: record(),
      old: mirror(record({ generalNewsletter: true })),
      state: platformState,
    });
    expect(result?.outcome).toBe(outcome);
    expect(result?.actions.map((action) => action.kind)).toEqual(kinds);
  });
  it("retains actions in dry run", () => {
    const result = event({
      current: record(),
      old: mirror(record({ generalNewsletter: true })),
      mode: "dry_run",
    });
    expect(result).toMatchObject({ outcome: "would_apply" });
    expect(result?.actions.map((action) => action.kind)).toEqual([
      "insert_consent",
      "insert_suppression",
    ]);
  });

  it.each([
    [
      "hard suppression",
      { ...state, suppressionEmails: new Set(["person@example.org"]) },
      "skipped_suppressed",
    ],
    [
      "cleaned address",
      {
        ...state,
        newsletterSuppressionsByEmail: new Map([
          ["person@example.org", { reason: "cleaned", updatedAt: T }],
        ]),
      },
      "skipped_cleaned_address",
    ],
    [
      "newer consent",
      {
        ...state,
        consentsByContact: new Map([
          [
            "contact-1",
            [
              {
                id: "new",
                contactId: "contact-1",
                scopeType: "newsletter" as const,
                scopeId: null,
                optedOutAt: "2026-11-07T13:00:00.000Z",
              },
            ],
          ],
        ]),
      },
      "skipped_platform_newer",
    ],
    [
      "newer suppression",
      {
        ...state,
        newsletterSuppressionsByEmail: new Map([
          [
            "person@example.org",
            {
              reason: "platform_optout",
              updatedAt: "2026-11-07T13:00:00.000Z",
            },
          ],
        ]),
      },
      "skipped_platform_newer",
    ],
  ])("protects General true for %s", (_name, platformState, outcome) => {
    expect(
      event({
        current: record({ generalNewsletter: true }),
        old: mirror(record()),
        state: platformState,
      })?.outcome,
    ).toBe(outcome);
  });
  it.each(["platform_optout", "unsubscribed"] as const)(
    "clears and subscribes General true with %s",
    (reason) => {
      const result = event({
        current: record({ generalNewsletter: true }),
        old: mirror(record()),
        state: {
          ...state,
          consentsByContact: new Map([
            [
              "contact-1",
              [
                {
                  id: "consent",
                  contactId: "contact-1",
                  scopeType: "newsletter",
                  scopeId: null,
                  optedOutAt: T,
                },
              ],
            ],
          ]),
          newsletterSuppressionsByEmail: new Map([
            ["person@example.org", { reason, updatedAt: T }],
          ]),
        },
      });
      expect(result?.actions.map((action) => action.kind)).toEqual([
        "clear_consent",
        "delete_suppression",
        "upsert_subscriber",
      ]);
    },
  );
  it("reports no change for already subscribed General true", () => {
    expect(
      event({
        current: record({ generalNewsletter: true }),
        old: mirror(record()),
        state: {
          ...state,
          newsletterSubscribersByEmail: new Map([
            ["person@example.org", { status: "subscribed", lastChangedAt: T }],
          ]),
        },
      }),
    ).toMatchObject({ outcome: "no_change", actions: [] });
  });

  it.each([
    ["no projects", [], ["contact-1"], "skipped_no_projects_for_box", 0],
    ["no contacts", ["project-1"], [], "skipped_no_contact", 0],
    [
      "2 contacts x 2 projects",
      ["project-1", "project-2"],
      ["contact-1", "contact-2"],
      "applied",
      4,
    ],
  ])("handles Box false: %s", (_name, projects, contacts, outcome, count) => {
    const result = event({
      current: record(),
      old: mirror(
        record({ projectBoxes: { ...boxes, "PNW Forest Monitoring": true } }),
      ),
      projects,
      contacts,
    });
    expect(result?.outcome).toBe(outcome);
    expect(result?.actions).toHaveLength(count);
  });
  it("does not reinsert an existing project opt-out", () => {
    expect(
      event({
        current: record(),
        old: mirror(
          record({ projectBoxes: { ...boxes, "PNW Forest Monitoring": true } }),
        ),
        state: {
          ...state,
          consentsByContact: new Map([
            [
              "contact-1",
              [
                {
                  id: "project",
                  contactId: "contact-1",
                  scopeType: "project",
                  scopeId: "project-1",
                  optedOutAt: T,
                },
              ],
            ],
          ]),
        },
      }),
    ).toMatchObject({ outcome: "no_change", actions: [] });
  });
  it.each([
    ["none", [], "no_change", []],
    [
      "all newer",
      [
        {
          id: "new",
          contactId: "contact-1",
          scopeType: "project" as const,
          scopeId: "project-1",
          optedOutAt: "2026-11-07T13:00:00.000Z",
        },
      ],
      "skipped_platform_newer",
      [],
    ],
    [
      "mixed",
      [
        {
          id: "old",
          contactId: "contact-1",
          scopeType: "project" as const,
          scopeId: "project-1",
          optedOutAt: T,
        },
        {
          id: "new",
          contactId: "contact-1",
          scopeType: "project" as const,
          scopeId: "project-2",
          optedOutAt: "2026-11-07T13:00:00.000Z",
        },
      ],
      "applied",
      ["old"],
    ],
  ])("handles Box true: %s", (_name, rows, outcome, ids) => {
    const result = event({
      current: record({
        projectBoxes: { ...boxes, "PNW Forest Monitoring": true },
      }),
      old: mirror(record()),
      projects: ["project-1", "project-2"],
      state: { ...state, consentsByContact: new Map([["contact-1", rows]]) },
    });
    expect(result?.outcome).toBe(outcome);
    if (ids.length === 0) expect(result?.actions).toEqual([]);
    else expect(result?.actions[0]).toMatchObject({ consentIds: ids });
  });

  it.each([
    [true, [], "applied", ["insert_suppression"]],
    [true, ["contact-1"], "applied", ["insert_consent", "insert_suppression"]],
    [false, [], "skipped_no_contact", noActions],
    [false, ["contact-1"], "no_change", noActions],
  ])("handles unsubscribed-from-all %s", (value, contacts, outcome, kinds) => {
    const result = event({
      current: record({ unsubscribedFromAll: value }),
      old: mirror(record({ unsubscribedFromAll: !value })),
      contacts,
    });
    expect(result?.outcome).toBe(outcome);
    expect(result?.actions.map((action) => action.kind)).toEqual(kinds);
  });
  it("clears only old all opt-outs", () => {
    const rows = [
      {
        id: "old",
        contactId: "contact-1",
        scopeType: "all" as const,
        scopeId: null,
        optedOutAt: T,
      },
      {
        id: "new",
        contactId: "contact-1",
        scopeType: "all" as const,
        scopeId: null,
        optedOutAt: "2026-11-07T13:00:00.000Z",
      },
    ];
    expect(
      event({
        current: record(),
        old: mirror(record({ unsubscribedFromAll: true })),
        state: { ...state, consentsByContact: new Map([["contact-1", rows]]) },
      })?.actions[0],
    ).toMatchObject({ consentIds: ["old"] });
  });

  describe("email opt-out ledger (PRD #768)", () => {
    const unticked = {
      current: record(),
      old: mirror(record({ unsubscribedFromAll: true })),
    };

    it("clears the ledger all row of a person with no contact", () => {
      const result = event({
        ...unticked,
        contacts: [],
        state: {
          ...state,
          emailOptOutAllByEmail: new Map([["person@example.org", T]]),
        },
      });
      expect(result?.outcome).toBe("applied");
      expect(result?.actions).toEqual([
        { kind: "clear_email_opt_out_all", email: "person@example.org" },
      ]);
    });

    it("clears both the contact consent and the ledger row", () => {
      const result = event({
        ...unticked,
        state: {
          ...state,
          consentsByContact: new Map([
            [
              "contact-1",
              [
                {
                  id: "consent-1",
                  contactId: "contact-1",
                  scopeType: "all" as const,
                  scopeId: null,
                  optedOutAt: T,
                },
              ],
            ],
          ]),
          emailOptOutAllByEmail: new Map([["person@example.org", T]]),
        },
      });
      expect(result?.actions.map((action) => action.kind)).toEqual([
        "clear_consent",
        "clear_email_opt_out_all",
      ]);
    });

    it("keeps a ledger row newer than the Salesforce change", () => {
      const result = event({
        ...unticked,
        contacts: [],
        state: {
          ...state,
          emailOptOutAllByEmail: new Map([
            ["person@example.org", "2026-11-07T13:00:00.000Z"],
          ]),
        },
      });
      expect(result?.outcome).toBe("skipped_platform_newer");
      expect(result?.actions).toEqual([]);
    });
  });

  it("emits only true fields for a new record with null from values", () => {
    const result = plan({
      current: record({
        generalNewsletter: true,
        projectBoxes: {
          ...boxes,
          "PNW Forest Monitoring": true,
          "Beech and Butternut": true,
        },
      }),
    });
    expect(result.events).toHaveLength(3);
    expect(result.events.every((value) => value.fromValue === null)).toBe(true);
    expect(plan({}).events).toEqual([]);
  });
  it.each([
    ["identical overlap", record(), mirror(record())],
    [
      "mirror-only fields",
      record({
        oregonShoresNewsletter: true,
        emailBounced: true,
        email: "other@example.org",
      }),
      mirror(record()),
    ],
    [
      "deleted records",
      record({ isDeleted: true, generalNewsletter: true }),
      undefined,
    ],
  ])("does not emit events for %s", (_name, current, old) => {
    expect(
      plan(old === undefined ? { current } : { current, old }).events,
    ).toEqual([]);
  });
  it("baselines all records into the mirror", () => {
    const result = plan({
      current: record({ generalNewsletter: true }),
      baseline: true,
    });
    expect(result).toMatchObject({ events: [] });
    expect(result.mirrorUpserts).toHaveLength(1);
  });
});
