import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  contactConsent,
  contacts,
  createSalesforceSubscriptionOutboxRepository,
  createStage5RepositoryBundle,
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
  return {
    context,
    campaigns: createStage5RepositoryBundle(context.db),
    outbox: createSalesforceSubscriptionOutboxRepository(context.db),
  };
}

async function insertContact(context: Context, id: string, email: string | null) {
  await context.db.insert(contacts).values({
    id,
    displayName: id,
    primaryEmail: email,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
}

describe("salesforce subscription outbox", () => {
  it("migration applies and each in-scope writer enqueues normalized rows", async () => {
    const { context, campaigns } = await setup();
    await insertContact(context, "contact-1", " Primary@Example.ORG ");

    await campaigns.contactConsent.recordOptOut(
      "contact-1",
      { type: "project", id: "project-1" },
      "recipient_click",
    );
    await campaigns.newsletterSuppressions.upsert({
      email: " News@Example.ORG ",
      reason: "platform_optout",
      source: "recipient_click",
    });
    await campaigns.suppressionList.upsertFromBounce(
      " Bounce@Example.ORG ",
      "hard_bounce",
      "event-1",
      new Date("2026-02-03T04:05:06.000Z"),
    );
    await campaigns.newsletterSubscribers.signUp({
      email: " Signup@Example.ORG ",
      optinTime: "2026-02-04T04:05:06.000Z",
      optinIp: "127.0.0.1",
      source: "website",
    });

    const rows = await context.db.select().from(salesforceSubscriptionOutbox);
    expect(rows.map((row) => ({
      email: row.email,
      kind: row.eventKind,
      projectId: row.projectId,
    }))).toEqual(expect.arrayContaining([
      { email: "primary@example.org", kind: "project_opt_out", projectId: "project-1" },
      { email: "news@example.org", kind: "newsletter_opt_out", projectId: null },
      { email: "bounce@example.org", kind: "hard_bounce", projectId: null },
      { email: "signup@example.org", kind: "newsletter_signup", projectId: null },
    ]));
  });

  it("does not enqueue a repeat contact opt-out", async () => {
    const { context, campaigns } = await setup();
    await insertContact(context, "contact-1", "person@example.org");
    await campaigns.contactConsent.recordOptOut(
      "contact-1",
      { type: "newsletter" },
      "recipient_click",
    );
    await campaigns.contactConsent.recordOptOut(
      "contact-1",
      { type: "newsletter" },
      "recipient_click",
    );
    expect((await context.db.select().from(salesforceSubscriptionOutbox))).toHaveLength(1);
  });

  it("rolls back consent when the outbox insert fails", async () => {
    const { context, campaigns } = await setup();
    await insertContact(context, "contact-rollback", "rollback@example.org");
    await context.client.exec(`
      CREATE FUNCTION reject_subscription_outbox() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'test outbox failure'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_subscription_outbox
      BEFORE INSERT ON salesforce_subscription_outbox
      FOR EACH ROW EXECUTE FUNCTION reject_subscription_outbox();
    `);

    await expect(campaigns.contactConsent.recordOptOut(
      "contact-rollback",
      { type: "newsletter" },
      "recipient_click",
    )).rejects.toThrow();
    expect(await context.db.select().from(contactConsent).where(
      eq(contactConsent.contactId, "contact-rollback"),
    )).toEqual([]);
  });

  it("excludes cleaned, manual, soft bounce, complaint, and repeated signup", async () => {
    const { context, campaigns } = await setup();
    await campaigns.newsletterSuppressions.upsert({
      email: "cleaned@example.org",
      reason: "cleaned",
      source: "provider_event",
    });
    for (const reason of ["manual", "soft_bounce_strike3", "complaint"] as const) {
      await campaigns.suppressionList.upsertFromBounce(
        `${reason}@example.org`,
        reason,
        `event-${reason}`,
        new Date(),
      );
    }
    const signup = {
      email: "repeat@example.org",
      optinTime: "2026-02-04T04:05:06.000Z",
      optinIp: "127.0.0.1",
      source: "website",
    };
    await campaigns.newsletterSubscribers.signUp(signup);
    await campaigns.newsletterSubscribers.signUp(signup);

    const rows = await context.db.select().from(salesforceSubscriptionOutbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventKind).toBe("newsletter_signup");
  });

  it("claims oldest rows once, transitions status, and exposes no delete method", async () => {
    const { context, campaigns, outbox } = await setup();
    await campaigns.newsletterSubscribers.signUp({
      email: "claim@example.org",
      optinTime: "2026-01-01T00:00:00.000Z",
      optinIp: "127.0.0.1",
      source: "website",
    });
    const [pending] = await context.db.select().from(salesforceSubscriptionOutbox);
    if (pending === undefined) throw new Error("Expected a pending outbox row.");
    const now = new Date(pending.nextAttemptAt.getTime() + 60_000);
    const first = await outbox.claimPending(500, now);
    const second = await outbox.claimPending(500, now);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect("delete" in outbox).toBe(false);

    const claimed = first[0];
    if (claimed === undefined) throw new Error("Expected a claimed outbox row.");
    await outbox.markSent([claimed.id], now);
    const [stored] = await context.db.select().from(salesforceSubscriptionOutbox);
    expect(stored?.status).toBe("sent");
    expect(stored?.sentAt).toEqual(now);
  });

  it("claims an email's rows still in backoff together with its due rows", async () => {
    const { context, outbox } = await setup();
    const now = new Date("2026-02-01T00:00:00.000Z");
    const inBackoffId = crypto.randomUUID();
    const dueId = crypto.randomUUID();
    await context.db.insert(salesforceSubscriptionOutbox).values([
      {
        // An older sign-up still waiting to retry...
        id: inBackoffId,
        email: "order@example.org",
        eventKind: "newsletter_signup",
        occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        attempts: 1,
        nextAttemptAt: new Date(now.getTime() + 60 * 60_000),
      },
      {
        // ...and a newer opt-out that is due now.
        id: dueId,
        email: "order@example.org",
        eventKind: "newsletter_opt_out",
        occurredAt: new Date("2026-01-02T00:00:00.000Z"),
        nextAttemptAt: now,
      },
    ]);

    const claimed = await outbox.claimPending(500, now);

    expect(claimed.map((row) => row.id).sort()).toEqual(
      [inBackoffId, dueId].sort(),
    );
  });

  it("uses exponential backoff and parks on attempt 10", async () => {
    const { context, campaigns, outbox } = await setup();
    await campaigns.newsletterSubscribers.signUp({
      email: "retry@example.org",
      optinTime: "2026-01-01T00:00:00.000Z",
      optinIp: "127.0.0.1",
      source: "website",
    });
    const [pending] = await context.db.select().from(salesforceSubscriptionOutbox);
    if (pending === undefined) throw new Error("Expected a pending outbox row.");
    const now = new Date(pending.nextAttemptAt.getTime() + 60_000);
    const [claimed] = await outbox.claimPending(1, now);
    if (claimed === undefined) throw new Error("Expected a claimed outbox row.");
    await outbox.markTransient([claimed.id], now, "TEMP");
    let [stored] = await context.db.select().from(salesforceSubscriptionOutbox);
    expect(stored?.attempts).toBe(1);
    expect(stored?.nextAttemptAt).toEqual(new Date(now.getTime() + 2 * 60_000));

    await context.db
      .update(salesforceSubscriptionOutbox)
      .set({ attempts: 9, nextAttemptAt: now, claimedAt: now })
      .where(eq(salesforceSubscriptionOutbox.id, claimed.id));
    await outbox.markTransient([claimed.id], now, "TEMP");
    [stored] = await context.db.select().from(salesforceSubscriptionOutbox);
    expect(stored?.attempts).toBe(10);
    expect(stored?.status).toBe("parked");
  });
});
