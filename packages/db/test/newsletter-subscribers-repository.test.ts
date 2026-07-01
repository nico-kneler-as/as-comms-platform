import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";

import {
  newsletterSubscribers,
  newsletterSuppressions,
} from "../src/index.js";
import {
  countSendableNewsletterSubscribers,
  getNewsletterSubscriberByEmail,
  getNewsletterSuppressionByEmail,
  listSendableNewsletterSubscribers,
  listNewsletterSubscribers,
  upsertNewsletterSubscriber,
  upsertNewsletterSuppression,
} from "../src/newsletter-subscribers-repository.js";
import { createTestStage1Context, type TestStage1Context } from "./helpers.js";

describe("newsletter subscribers repository", () => {
  let context: TestStage1Context;

  beforeEach(async () => {
    context = await createTestStage1Context();
  });

  afterEach(async () => {
    await context.dispose();
  });

  it("upserts a subscriber idempotently by normalized email", async () => {
    const created = await upsertNewsletterSubscriber(context.db, {
      email: " Person@Example.com ",
      firstName: "First",
      memberRating: 2,
    });
    const updated = await upsertNewsletterSubscriber(context.db, {
      email: "person@example.com",
      firstName: "Updated",
      lastName: "Name",
      memberRating: 5,
    });
    const rows = await context.db
      .select({ value: count() })
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, "person@example.com"));

    expect(updated.id).toBe(created.id);
    expect(updated.email).toBe("person@example.com");
    expect(updated.firstName).toBe("Updated");
    expect(updated.lastName).toBe("Name");
    expect(updated.memberRating).toBe(5);
    expect(rows[0]?.value ?? 0).toBe(1);
  });

  it("normalizes email on subscriber write and lookup", async () => {
    await upsertNewsletterSubscriber(context.db, {
      email: " Mixed@CASE.com ",
      firstName: "Mixed",
    });

    const fetched = await getNewsletterSubscriberByEmail(
      context.db,
      "mixed@case.com",
    );

    expect(fetched?.email).toBe("mixed@case.com");
    expect(fetched?.firstName).toBe("Mixed");
  });

  it("upserts and fetches suppressions by normalized email", async () => {
    const created = await upsertNewsletterSuppression(context.db, {
      email: " Remove@Example.com ",
      reason: "unsubscribed",
      source: "mailchimp_import",
    });
    const fetched = await getNewsletterSuppressionByEmail(
      context.db,
      "remove@example.com",
    );

    expect(fetched).toEqual(created);
  });

  it("counts sendable subscribers excluding suppressions and non-subscribed statuses", async () => {
    await upsertNewsletterSubscriber(context.db, {
      email: "sendable-1@example.com",
      status: "subscribed",
    });
    await upsertNewsletterSubscriber(context.db, {
      email: "sendable-2@example.com",
      status: "subscribed",
    });
    await upsertNewsletterSubscriber(context.db, {
      email: "suppressed@example.com",
      status: "subscribed",
    });
    await upsertNewsletterSubscriber(context.db, {
      email: "pending@example.com",
      status: "pending",
    });
    await upsertNewsletterSuppression(context.db, {
      email: "suppressed@example.com",
      reason: "cleaned",
      source: "mailchimp_import",
    });

    const countValue = await countSendableNewsletterSubscribers(context.db);

    expect(countValue).toBe(2);
  });

  it("lists sendable subscribers in deterministic email order", async () => {
    const bravo = await upsertNewsletterSubscriber(context.db, {
      email: "bravo@example.com",
      firstName: "Bravo",
      status: "subscribed",
    });
    await upsertNewsletterSubscriber(context.db, {
      email: "charlie@example.com",
      firstName: "Charlie",
      status: "pending",
    });
    const alpha = await upsertNewsletterSubscriber(context.db, {
      email: "alpha@example.com",
      firstName: "Alpha",
      status: "subscribed",
    });
    await upsertNewsletterSubscriber(context.db, {
      email: "suppressed@example.com",
      firstName: "Suppressed",
      status: "subscribed",
    });
    await upsertNewsletterSuppression(context.db, {
      email: "suppressed@example.com",
      reason: "cleaned",
      source: "mailchimp_import",
    });

    const rows = await listSendableNewsletterSubscribers(context.db);

    expect(rows).toEqual([
      {
        id: alpha.id,
        email: "alpha@example.com",
        firstName: "Alpha",
      },
      {
        id: bravo.id,
        email: "bravo@example.com",
        firstName: "Bravo",
      },
    ]);
  });

  it("lists subscribers in engaged-first order and filters by minimum rating", async () => {
    await upsertNewsletterSubscriber(context.db, {
      email: "low@example.com",
      memberRating: 1,
      lastChangedAt: "2026-06-19T10:00:00.000Z",
    });
    await upsertNewsletterSubscriber(context.db, {
      email: "high@example.com",
      memberRating: 5,
      lastChangedAt: "2026-06-19T09:00:00.000Z",
    });
    await upsertNewsletterSubscriber(context.db, {
      email: "medium@example.com",
      memberRating: 3,
      lastChangedAt: "2026-06-19T11:00:00.000Z",
    });

    const listed = await listNewsletterSubscribers(context.db, {
      limit: 10,
    });
    const filtered = await listNewsletterSubscribers(context.db, {
      limit: 10,
      minMemberRating: 3,
    });

    expect(listed.map((row) => row.email)).toEqual([
      "high@example.com",
      "medium@example.com",
      "low@example.com",
    ]);
    expect(filtered.map((row) => row.email)).toEqual([
      "high@example.com",
      "medium@example.com",
    ]);
  });

  it("handles duplicate suppression upserts without throwing a unique error", async () => {
    const first = await upsertNewsletterSuppression(context.db, {
      email: "dup@example.com",
      reason: "unsubscribed",
      source: "mailchimp_import",
    });
    const second = await upsertNewsletterSuppression(context.db, {
      email: " dup@example.com ",
      reason: "platform_optout",
      source: "admin_action",
    });
    const rows = await context.db
      .select({ value: count() })
      .from(newsletterSuppressions)
      .where(eq(newsletterSuppressions.email, "dup@example.com"));

    expect(second.id).toBe(first.id);
    expect(second.reason).toBe("platform_optout");
    expect(second.source).toBe("admin_action");
    expect(rows[0]?.value ?? 0).toBe(1);
  });
});
