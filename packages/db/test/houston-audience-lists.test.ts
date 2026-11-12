import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  createSalesforceSubscriptionReadbackRepository,
  createStage5RepositoryBundle,
  emailOptOuts,
  salesforceSubscriptionOutbox,
} from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";

type Context = Awaited<ReturnType<typeof createTestStage1Context>>;
let contexts: Context[] = [];

afterEach(async () => {
  await Promise.all(contexts.map((context) => context.dispose()));
  contexts = [];
});

async function setup() {
  const context = await createTestStage1Context();
  contexts.push(context);
  return { context, campaigns: createStage5RepositoryBundle(context.db) };
}

/** The backfill statement of migration 0103, so the test runs the real SQL. */
async function readBackfillStatement(): Promise<string> {
  const migration = await readFile(
    new URL("../drizzle/0103_houston_audience_lists.sql", import.meta.url),
    "utf8",
  );
  const statement = migration
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .find((part) => part.startsWith('INSERT INTO "email_opt_outs"'));
  if (statement === undefined) {
    throw new Error("Backfill statement not found in migration 0103.");
  }
  return statement;
}

describe("Houston audience lists (PRD #768)", () => {
  it("seeds the Insiders list with no members", async () => {
    const { campaigns } = await setup();

    await expect(campaigns.audienceLists.findById("insiders")).resolves.toMatchObject({
      id: "insiders",
      name: "Insiders",
      membersReplacedAt: null,
    });
    await expect(campaigns.audienceLists.listAll()).resolves.toMatchObject([
      { id: "insiders", memberCount: 0 },
    ]);
  });

  it("replaces members wholesale, dedupes by normalized email, and stamps who replaced them", async () => {
    const { campaigns } = await setup();

    await campaigns.audienceLists.replaceMembers(
      "insiders",
      [{ email: "old@example.org", firstName: "Old", lastName: null }],
      null,
    );
    const inserted = await campaigns.audienceLists.replaceMembers(
      "insiders",
      [
        { email: " Ada@Example.org ", firstName: "Ada", lastName: "Lovelace" },
        { email: "ada@example.org", firstName: "Duplicate", lastName: null },
        { email: "grace@example.org", firstName: " ", lastName: "Hopper" },
      ],
      null,
    );

    expect(inserted).toBe(2);
    await expect(campaigns.audienceLists.listMembers("insiders")).resolves.toMatchObject([
      { normalizedEmail: "ada@example.org", firstName: "Ada", lastName: "Lovelace" },
      { normalizedEmail: "grace@example.org", firstName: null, lastName: "Hopper" },
    ]);
    const list = await campaigns.audienceLists.findById("insiders");
    expect(list?.membersReplacedAt).not.toBeNull();
    await expect(campaigns.audienceLists.listAll()).resolves.toMatchObject([
      { id: "insiders", memberCount: 2 },
    ]);
  });

  it("creates a new list", async () => {
    const { campaigns } = await setup();

    const created = await campaigns.audienceLists.create({
      name: " Board ",
      actorUserId: null,
    });

    expect(created.name).toBe("Board");
    await expect(campaigns.audienceLists.findById(created.id)).resolves.toMatchObject({
      name: "Board",
    });
  });
});

describe("email opt-out ledger (PRD #768)", () => {
  it("records idempotently and keeps the earliest opt-out", async () => {
    const { campaigns } = await setup();

    const first = await campaigns.emailOptOuts.record({
      email: " Someone@Example.org ",
      scope: { type: "list", listId: "insiders" },
      source: "recipient_click",
      occurredAt: new Date("2026-11-12T10:00:00.000Z"),
    });
    const second = await campaigns.emailOptOuts.record({
      email: "someone@example.org",
      scope: { type: "list", listId: "insiders" },
      source: "recipient_click",
      occurredAt: new Date("2026-11-13T10:00:00.000Z"),
    });

    expect(second.id).toBe(first.id);
    expect(second.optedOutAt).toBe("2026-11-12T10:00:00.000Z");
    expect(second.normalizedEmail).toBe("someone@example.org");
  });

  it("lists emails by scope and only once the opt-out has happened", async () => {
    const { campaigns } = await setup();
    const at = new Date("2026-11-12T12:00:00.000Z");

    await campaigns.emailOptOuts.record({
      email: "everything@example.org",
      scope: { type: "all" },
      source: "recipient_click",
      occurredAt: new Date("2026-11-12T09:00:00.000Z"),
    });
    await campaigns.emailOptOuts.record({
      email: "insiders@example.org",
      scope: { type: "list", listId: "insiders" },
      source: "recipient_click",
      occurredAt: new Date("2026-11-12T09:00:00.000Z"),
    });
    await campaigns.emailOptOuts.record({
      email: "later@example.org",
      scope: { type: "all" },
      source: "recipient_click",
      occurredAt: new Date("2026-11-12T18:00:00.000Z"),
    });

    await expect(campaigns.emailOptOuts.listEmails({ type: "all" }, at)).resolves.toEqual(
      new Set(["everything@example.org"]),
    );
    await expect(
      campaigns.emailOptOuts.listEmails({ type: "list", listId: "insiders" }, at),
    ).resolves.toEqual(new Set(["insiders@example.org"]));
    await expect(
      campaigns.emailOptOuts.listEmails({ type: "list", listId: "board" }, at),
    ).resolves.toEqual(new Set());
  });

  it("backfills one all row per outbox email, keeping the earliest, and is safe to run twice", async () => {
    const { context, campaigns } = await setup();
    await context.db.insert(salesforceSubscriptionOutbox).values([
      {
        id: crypto.randomUUID(),
        email: "Clicked@Example.org",
        eventKind: "all_opt_out",
        occurredAt: new Date("2026-11-02T10:00:00.000Z"),
      },
      {
        id: crypto.randomUUID(),
        email: " clicked@example.org ",
        eventKind: "all_opt_out",
        occurredAt: new Date("2026-11-01T10:00:00.000Z"),
      },
      {
        id: crypto.randomUUID(),
        email: "newsletter-only@example.org",
        eventKind: "newsletter_opt_out",
        occurredAt: new Date("2026-11-01T10:00:00.000Z"),
      },
    ]);
    const backfill = await readBackfillStatement();

    await context.client.exec(backfill);
    await context.client.exec(backfill);

    const rows = await context.db.select().from(emailOptOuts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      normalizedEmail: "clicked@example.org",
      scopeType: "all",
      scopeId: null,
      source: "backfill_salesforce_outbox",
    });
    expect(rows[0]?.optedOutAt.toISOString()).toBe("2026-11-01T10:00:00.000Z");
    await expect(
      campaigns.emailOptOuts.listEmails({ type: "all" }, new Date("2026-11-12T00:00:00.000Z")),
    ).resolves.toEqual(new Set(["clicked@example.org"]));
  });
});

describe("email opt-out ledger: Salesforce and clearing (PRD #768)", () => {
  it("recordAll queues the Salesforce all_opt_out only when asked", async () => {
    const { context, campaigns } = await setup();

    await campaigns.emailOptOuts.recordAll({
      email: "Csv-Insider@Example.org",
      source: "recipient_click",
      occurredAt: new Date("2026-11-12T10:00:00.000Z"),
      notifySalesforce: true,
    });
    await campaigns.emailOptOuts.recordAll({
      email: "contact@example.org",
      source: "recipient_click",
      occurredAt: new Date("2026-11-12T10:00:00.000Z"),
      notifySalesforce: false,
    });

    const outbox = await context.db.select().from(salesforceSubscriptionOutbox);
    expect(outbox.map((row) => [row.email, row.eventKind])).toEqual([
      ["csv-insider@example.org", "all_opt_out"],
    ]);
    await expect(
      campaigns.emailOptOuts.listEmails({ type: "all" }, new Date("2026-11-13T00:00:00.000Z")),
    ).resolves.toEqual(new Set(["csv-insider@example.org", "contact@example.org"]));
  });

  it("a Salesforce re-subscribe clears the all row, keeps it for audit, and a new click records again", async () => {
    const { context, campaigns } = await setup();
    const at = new Date("2026-11-13T00:00:00.000Z");
    await campaigns.emailOptOuts.recordAll({
      email: "person@example.org",
      source: "recipient_click",
      occurredAt: new Date("2026-11-07T11:00:00.000Z"),
      notifySalesforce: false,
    });
    const readback = createSalesforceSubscriptionReadbackRepository(context.db);

    const state = await readback.loadPlatformState({
      emails: ["person@example.org"],
      contactIds: [],
    });
    expect(state.emailOptOutAllByEmail?.get("person@example.org")).toBe(
      "2026-11-07T11:00:00.000Z",
    );

    await readback.persistBatch({
      mode: "apply",
      mirrorUpserts: [],
      events: [
        {
          id: crypto.randomUUID(),
          salesforceRecordId: "esp-1",
          email: "person@example.org",
          field: "unsubscribed_from_all",
          projectBox: null,
          fromValue: true,
          toValue: false,
          sfModifiedAt: "2026-11-07T12:00:00.000Z",
          sfModifiedByUsername: "staff@example.org",
          contactsMatched: 0,
          outcome: "applied",
          actions: [{ kind: "clear_email_opt_out_all", email: "person@example.org" }],
        },
      ],
    });

    await expect(campaigns.emailOptOuts.listEmails({ type: "all" }, at)).resolves.toEqual(
      new Set(),
    );
    const rows = await context.db.select().from(emailOptOuts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ clearedBySource: "salesforce" });
    expect(rows[0]?.clearedAt).not.toBeNull();

    await campaigns.emailOptOuts.recordAll({
      email: "person@example.org",
      source: "recipient_click",
      occurredAt: new Date("2026-11-12T10:00:00.000Z"),
      notifySalesforce: false,
    });
    await expect(campaigns.emailOptOuts.listEmails({ type: "all" }, at)).resolves.toEqual(
      new Set(["person@example.org"]),
    );
    expect(await context.db.select().from(emailOptOuts)).toHaveLength(2);
  });
});

describe("newsletter suppression upsert keeps bounces", () => {
  it("never turns a cleaned address into a plain opt-out", async () => {
    const { campaigns } = await setup();
    await campaigns.newsletterSuppressions.upsert({
      email: "dead@example.org",
      reason: "cleaned",
      source: "mailchimp_import",
    });
    await campaigns.newsletterSuppressions.upsert({
      email: "dead@example.org",
      reason: "platform_optout",
      source: "recipient_click",
    });
    await campaigns.newsletterSuppressions.upsert({
      email: "live@example.org",
      reason: "unsubscribed",
      source: "mailchimp_import",
    });
    await campaigns.newsletterSuppressions.upsert({
      email: "live@example.org",
      reason: "platform_optout",
      source: "recipient_click",
    });

    await expect(
      campaigns.newsletterSuppressions.findByEmail("dead@example.org"),
    ).resolves.toMatchObject({ reason: "cleaned", source: "mailchimp_import" });
    await expect(
      campaigns.newsletterSuppressions.findByEmail("live@example.org"),
    ).resolves.toMatchObject({ reason: "platform_optout", source: "recipient_click" });
  });
});

describe("newsletter suppressions for exclusion", () => {
  it("lists every suppression with its reason, source and when it was recorded", async () => {
    const { campaigns } = await setup();
    await campaigns.newsletterSuppressions.upsert({
      email: "Unsubscribed@Example.org",
      reason: "unsubscribed",
      source: "mailchimp_import",
    });
    await campaigns.newsletterSuppressions.upsert({
      email: "bounced@example.org",
      reason: "cleaned",
      source: "mailchimp_import",
    });

    const rows = await campaigns.newsletterSuppressions.listForExclusion();

    expect(
      rows.map((row) => [row.email, row.reason, row.source]).sort(),
    ).toEqual([
      ["bounced@example.org", "cleaned", "mailchimp_import"],
      ["unsubscribed@example.org", "unsubscribed", "mailchimp_import"],
    ]);
    expect(rows.every((row) => row.createdAt instanceof Date)).toBe(true);
  });
});
