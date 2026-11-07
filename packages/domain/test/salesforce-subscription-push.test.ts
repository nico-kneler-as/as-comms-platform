import { describe, expect, it } from "vitest";

import { salesforceSubscriptionBoxValues } from "@as-comms/contracts";

import {
  buildSubscriptionPreferenceChanges,
  type OutboxRow,
} from "../src/salesforce-subscription-push.js";

function row(
  id: string,
  eventKind: OutboxRow["eventKind"],
  overrides: Partial<OutboxRow> = {},
): OutboxRow {
  return {
    id,
    email: "person@example.org",
    contactId: null,
    eventKind,
    projectId: eventKind === "project_opt_out" ? "project-1" : null,
    occurredAt: "2026-01-01T00:00:00.000Z",
    status: "pending",
    attempts: 0,
    nextAttemptAt: "2026-01-01T00:00:00.000Z",
    lastErrorKind: null,
    lastErrorCode: null,
    sentAt: null,
    claimedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function build(rows: readonly OutboxRow[], overrides: {
  projectBoxes?: ReadonlyMap<string, string>;
  projectHosts?: ReadonlyMap<string, string>;
  salesforceContactIds?: ReadonlyMap<string, string>;
} = {}) {
  return buildSubscriptionPreferenceChanges({
    rows,
    projectBoxes: overrides.projectBoxes ?? new Map(),
    projectHosts: overrides.projectHosts ?? new Map(),
    salesforceContactIds: overrides.salesforceContactIds ?? new Map(),
  });
}

describe("buildSubscriptionPreferenceChanges", () => {
  it.each([
    ["newsletter_opt_out", { generalNewsletter: false }],
    ["newsletter_signup", { generalNewsletter: true }],
    ["hard_bounce", { emailBounced: true }],
  ] as const)("maps %s", (eventKind, expected) => {
    expect(build([row(crypto.randomUUID(), eventKind)]).changes[0]).toEqual({
      email: "person@example.org",
      ...expected,
    });
  });

  it.each([
    ["newsletter_opt_out", "newsletter_signup", true],
    ["newsletter_signup", "newsletter_opt_out", false],
  ] as const)("applies %s then %s in occurrence order", (first, second, expected) => {
    const result = build([
      row(crypto.randomUUID(), second, { occurredAt: "2026-01-02T00:00:00.000Z" }),
      row(crypto.randomUUID(), first, { occurredAt: "2026-01-01T00:00:00.000Z" }),
    ]);
    expect(result.changes[0]?.generalNewsletter).toBe(expected);
  });

  it("uses a connected host box and skips a project with no box", () => {
    const hostResult = build([row(crypto.randomUUID(), "project_opt_out")], {
      projectHosts: new Map([["project-1", "host-1"]]),
      projectBoxes: new Map([["host-1", "PNW Forest Monitoring"]]),
    });
    expect(hostResult.changes[0]?.projectBoxes).toEqual({
      "PNW Forest Monitoring": false,
    });

    const skippedId = crypto.randomUUID();
    const skippedResult = build([row(skippedId, "project_opt_out")]);
    expect(skippedResult.changes).toEqual([]);
    expect(skippedResult.rowIdsByEmail.size).toBe(0);
    expect(skippedResult.skipped).toEqual([
      { rowId: skippedId, reason: "no_box_for_project" },
    ]);
  });

  it("all opt-out unticks every project box", () => {
    const occurredAt = "2026-03-04T05:06:07.000Z";
    const change = build([
      row(crypto.randomUUID(), "all_opt_out", { occurredAt }),
    ]).changes[0];
    expect(change).toMatchObject({
      generalNewsletter: false,
      oregonShoresNewsletter: false,
      unsubscribedFromAll: true,
      unsubscribedAt: occurredAt,
    });
    expect(change?.projectBoxes).toEqual(
      Object.fromEntries(salesforceSubscriptionBoxValues.map((box) => [box, false])),
    );
  });

  it("a bounce leaves an existing box change alone", () => {
    const result = build(
      [
        row(crypto.randomUUID(), "project_opt_out"),
        row(crypto.randomUUID(), "hard_bounce", {
          occurredAt: "2026-01-02T00:00:00.000Z",
          projectId: null,
        }),
      ],
      { projectBoxes: new Map([["project-1", "Beech and Butternut"]]) },
    );
    expect(result.changes[0]).toMatchObject({
      projectBoxes: { "Beech and Butternut": false },
      emailBounced: true,
    });
  });

  it("sends a mapped Salesforce contact id and omits absent ids and creationSource", () => {
    const mapped = build(
      [row(crypto.randomUUID(), "newsletter_signup", { contactId: "contact-1" })],
      { salesforceContactIds: new Map([["contact-1", "003000000000001AAA"]]) },
    ).changes[0];
    expect(mapped).toMatchObject({ contactId: "003000000000001AAA" });
    expect(mapped).not.toHaveProperty("creationSource");

    const absent = build([
      row(crypto.randomUUID(), "newsletter_signup", { contactId: "contact-2" }),
    ]).changes[0];
    expect(absent).not.toHaveProperty("contactId");
    expect(absent).not.toHaveProperty("creationSource");
  });
});
