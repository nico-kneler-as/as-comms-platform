import { describe, expect, it } from "vitest";

import { salesforceSubscriptionBoxValues, type SalesforceSubscriptionBox } from "@as-comms/contracts";

import {
  planSubscriptionBackfill,
  type SubscriptionBackfillInput,
} from "../src/salesforce-subscription-backfill.js";

const boxes = Object.fromEntries(salesforceSubscriptionBoxValues.map((box) => [box, false])) as Record<SalesforceSubscriptionBox, boolean>;
const base = (): SubscriptionBackfillInput => ({
  contacts: [], memberships: [], projectBoxes: [], connectedProjects: [], existing: [],
  newsletterSubscribers: [], newsletterSuppressions: [], suppressionList: [], consents: [],
  creationSource: "Platform backfill 2026-11",
});
const contact = (overrides: Partial<SubscriptionBackfillInput["contacts"][number]> = {}) => ({
  salesforceContactId: "003contact", email: "person@example.org", hasOptedOutOfEmail: false, doNotContact: false, ...overrides,
});
const existing = (overrides: Partial<SubscriptionBackfillInput["existing"][number]> = {}) => ({
  salesforceRecordId: "a01000000000001AAA", email: "person@example.org", contactId: "003contact",
  generalNewsletter: false, oregonShoresNewsletter: false, projectBoxes: { ...boxes },
  unsubscribedFromAll: false, unsubscribedAt: null, emailBounced: false, ...overrides,
});
const plan = (input: SubscriptionBackfillInput) => planSubscriptionBackfill(input);

describe("planSubscriptionBackfill", () => {
  it.each([
    ["contact gets a linked created record", { contacts: [contact()] }, { contactId: "003contact", creationSource: "Platform backfill 2026-11" }],
    ["subscriber without contact gets general", { newsletterSubscribers: [{ email: "person@example.org", status: "subscribed" }] }, { generalNewsletter: true, creationSource: "Platform backfill 2026-11" }],
    ["contact mailchimp unsubscribe turns general off", { contacts: [contact()], existing: [existing({ generalNewsletter: true })], newsletterSuppressions: [{ email: "person@example.org", reason: "unsubscribed" as const }] }, { generalNewsletter: false }],
    ["platform optout turns general off", { contacts: [contact()], existing: [existing({ generalNewsletter: true })], newsletterSuppressions: [{ email: "person@example.org", reason: "platform_optout" as const }] }, { generalNewsletter: false }],
    ["complaint turns general off", { contacts: [contact()], existing: [existing({ generalNewsletter: true })], suppressionList: [{ email: "person@example.org", reason: "complaint" as const }] }, { generalNewsletter: false }],
    ["subscribed hard bounce keeps general and flags bounce", { contacts: [contact()], newsletterSubscribers: [{ email: "person@example.org", status: "subscribed" }], suppressionList: [{ email: "person@example.org", reason: "hard_bounce" as const }] }, { generalNewsletter: true, emailBounced: true }],
    ["cleaned contact turns general on and flags bounce", { contacts: [contact()], newsletterSuppressions: [{ email: "person@example.org", reason: "cleaned" as const }] }, { generalNewsletter: true, emailBounced: true }],
  ] as const)("%s", (_name, partial, expected) => {
    const result = plan({ ...base(), ...partial });
    expect(result.writes).toHaveLength(1);
    expect(result.writes[0]?.change).toMatchObject(expected);
  });

  it("does not create non-contact unsubscribed, cleaned, or quarantined subscribers", () => {
    for (const input of [
      { newsletterSubscribers: [{ email: "person@example.org", status: "subscribed" }], newsletterSuppressions: [{ email: "person@example.org", reason: "unsubscribed" as const }] },
      { newsletterSubscribers: [{ email: "person@example.org", status: "subscribed" }], newsletterSuppressions: [{ email: "person@example.org", reason: "cleaned" as const }] },
      { newsletterSubscribers: [{ email: "person@example.org", status: "quarantined" }] },
    ]) expect(plan({ ...base(), ...input }).writes).toEqual([]);
  });

  it("sets all opt out, preserves unknown opt-out date, and turns every tick off", () => {
    const ticked = Object.fromEntries(salesforceSubscriptionBoxValues.map((box) => [box, true])) as Record<SalesforceSubscriptionBox, boolean>;
    const sfOptOut = plan({ ...base(), contacts: [contact({ hasOptedOutOfEmail: true })], existing: [existing({ generalNewsletter: true, projectBoxes: ticked })] }).writes[0];
    expect(sfOptOut?.change).toMatchObject({ unsubscribedFromAll: true, generalNewsletter: false, projectBoxes: boxes });
    expect(sfOptOut?.change).not.toHaveProperty("unsubscribedAt");
    const all = plan({ ...base(), contacts: [contact()], existing: [existing({ generalNewsletter: true, oregonShoresNewsletter: true, projectBoxes: ticked })], consents: [
      { salesforceContactId: "003contact", email: null, scopeType: "all" as const, scopeId: null, optedOutAt: "2026-01-02T00:00:00.000Z" },
      { salesforceContactId: "003contact", email: null, scopeType: "all" as const, scopeId: null, optedOutAt: "2026-01-01T00:00:00.000Z" },
    ] }).writes[0];
    expect(all?.change).toMatchObject({ unsubscribedFromAll: true, unsubscribedAt: "2026-01-01T00:00:00.000Z", oregonShoresNewsletter: false });
  });

  it("leaves quarantined contact general state alone and lists Salesforce-only ticks", () => {
    const quarantined = plan({ ...base(), contacts: [contact()], existing: [existing({ generalNewsletter: true })], newsletterSubscribers: [{ email: "person@example.org", status: "quarantined" }] });
    expect(quarantined.writes).toEqual([]);
    expect(quarantined.summary.quarantinedContactsLeftAlone).toBe(1);
    const ticked = plan({ ...base(), contacts: [contact()], existing: [existing({ generalNewsletter: true })] });
    expect(ticked.sfTickedNotOnPlatform).toEqual([{ email: "person@example.org", salesforceRecordId: "a01000000000001AAA", contactId: "003contact" }]);
  });

  it("handles membership statuses, project consent host fallback, missing memberships, and relinks", () => {
    const projectBoxes = [{ projectId: "host", box: "Beech and Butternut" }];
    for (const status of ["Lead", "Failed", "Aborted", "Denied", "", "  declined  "]) {
      const result = plan({ ...base(), contacts: [contact()], memberships: [{ salesforceContactId: "003contact", projectId: "host", status }], projectBoxes });
      expect(result.writes[0]?.change.projectBoxes?.["Beech and Butternut"]).toBe(status.trim().toLowerCase() === "declined" ? undefined : true);
    }
    const blocked = plan({ ...base(), contacts: [contact()], existing: [existing({ projectBoxes: { ...boxes, "Beech and Butternut": true } })], projectBoxes, connectedProjects: [{ projectId: "sub", connectedToProjectId: "host" }], consents: [{ salesforceContactId: "003contact", email: null, scopeType: "project", scopeId: "sub", optedOutAt: "2026-01-01T00:00:00.000Z" }] });
    expect(blocked.writes[0]?.change.projectBoxes).toEqual({ "Beech and Butternut": false });
    const noMembership = plan({ ...base(), contacts: [contact()], existing: [existing({ projectBoxes: { ...boxes, "Beech and Butternut": true } })] });
    expect(noMembership.writes).toEqual([]);
    const relink = plan({ ...base(), contacts: [contact()], existing: [existing({ contactId: "003old" })] });
    expect(relink.writes[0]?.change.contactId).toBe("003contact");
    const noRelink = plan({ ...base(), existing: [existing({ contactId: "003old" })] });
    expect(noRelink.writes).toEqual([]);
  });

  it("leaves General untouched for a contact with no newsletter history", () => {
    const write = plan({ ...base(), contacts: [contact()] }).writes[0];
    expect(write?.change).not.toHaveProperty("generalNewsletter");
  });

  it("never clears unsubscribed-from-all or bounced", () => {
    const result = plan({ ...base(), contacts: [contact()], existing: [existing({ unsubscribedFromAll: true, unsubscribedAt: "2026-01-01T00:00:00.000+0000", emailBounced: true })] });
    expect(result.writes).toEqual([]);
  });

  it("compares unsubscribed-at as an instant, whatever the format", () => {
    const allConsent = { salesforceContactId: "003contact", email: null, scopeType: "all" as const, scopeId: null, optedOutAt: "2026-01-01T00:00:00.000Z" };
    const same = plan({ ...base(), contacts: [contact()], existing: [existing({ unsubscribedFromAll: true, unsubscribedAt: "2026-01-01T00:00:00.000+0000" })], consents: [allConsent] });
    expect(same.writes).toEqual([]);
    const different = plan({ ...base(), contacts: [contact()], existing: [existing({ unsubscribedFromAll: true, unsubscribedAt: "2026-03-01T00:00:00.000+0000" })], consents: [allConsent] });
    expect(different.writes[0]?.change).toMatchObject({ unsubscribedAt: "2026-01-01T00:00:00.000Z" });
  });

  it("normalizes mixed-case inputs and is idempotent after applying its writes", () => {
    const initial = { ...base(), contacts: [contact({ email: " Person@Example.ORG " })], newsletterSubscribers: [{ email: "PERSON@example.org", status: "subscribed" }] };
    const first = plan(initial);
    expect(first.writes[0]?.email).toBe("person@example.org");
    const appliedExisting = first.writes.map((write) => ({
      ...existing({ email: write.email, salesforceRecordId: "a01created", contactId: write.change.contactId ?? null }),
      generalNewsletter: write.change.generalNewsletter ?? false,
      oregonShoresNewsletter: write.change.oregonShoresNewsletter ?? false,
      projectBoxes: Object.fromEntries(salesforceSubscriptionBoxValues.map((box) => [box, write.change.projectBoxes?.[box] ?? false])) as Record<SalesforceSubscriptionBox, boolean>,
      unsubscribedFromAll: write.change.unsubscribedFromAll ?? false,
      unsubscribedAt: write.change.unsubscribedAt ?? null,
      emailBounced: write.change.emailBounced ?? false,
    }));
    expect(plan({ ...initial, existing: appliedExisting }).writes).toEqual([]);
  });
});
