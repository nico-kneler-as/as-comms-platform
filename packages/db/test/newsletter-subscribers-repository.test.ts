import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";

import {
  newsletterSubscribers,
  newsletterSuppressions,
} from "../src/index.js";
import {
  clearMailchimpNewsletterSuppressionByEmail,
  countSendableNewsletterSubscribers,
  getNewsletterSubscriberByEmail,
  getNewsletterSuppressionByEmail,
  listSendableNewsletterSubscribers,
  listNewsletterSubscribers,
  searchNewsletterSubscribers,
  signUpNewsletterSubscriber,
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

  it("clears an unsubscribed suppression for a Mailchimp re-subscription", async () => {
    await upsertNewsletterSuppression(context.db, {
      email: "unsubscribed@example.com",
      reason: "unsubscribed",
      source: "mailchimp_import",
    });

    await expect(
      clearMailchimpNewsletterSuppressionByEmail(
        context.db,
        "unsubscribed@example.com",
      ),
    ).resolves.toBe(true);
    await expect(
      getNewsletterSuppressionByEmail(context.db, "unsubscribed@example.com"),
    ).resolves.toBeNull();
  });

  it("clears a cleaned suppression for a Mailchimp re-subscription", async () => {
    await upsertNewsletterSuppression(context.db, {
      email: "cleaned@example.com",
      reason: "cleaned",
      source: "mailchimp_import",
    });

    await expect(
      clearMailchimpNewsletterSuppressionByEmail(
        context.db,
        "cleaned@example.com",
      ),
    ).resolves.toBe(true);
    await expect(
      getNewsletterSuppressionByEmail(context.db, "cleaned@example.com"),
    ).resolves.toBeNull();
  });

  it("preserves a platform opt-out when processing a Mailchimp re-subscription", async () => {
    await upsertNewsletterSuppression(context.db, {
      email: "platform-optout@example.com",
      reason: "platform_optout",
      source: "recipient_click",
    });

    await expect(
      clearMailchimpNewsletterSuppressionByEmail(
        context.db,
        "platform-optout@example.com",
      ),
    ).resolves.toBe(false);
    await expect(
      getNewsletterSuppressionByEmail(context.db, "platform-optout@example.com"),
    ).resolves.toMatchObject({ reason: "platform_optout" });
  });

  it("returns false when no suppression exists", async () => {
    await expect(
      clearMailchimpNewsletterSuppressionByEmail(
        context.db,
        "missing@example.com",
      ),
    ).resolves.toBe(false);
  });

  it("normalizes email before clearing a Mailchimp suppression", async () => {
    await upsertNewsletterSuppression(context.db, {
      email: "normalized@example.com",
      reason: "unsubscribed",
      source: "mailchimp_import",
    });

    await expect(
      clearMailchimpNewsletterSuppressionByEmail(
        context.db,
        " Normalized@Example.com ",
      ),
    ).resolves.toBe(true);
    await expect(
      getNewsletterSuppressionByEmail(context.db, "normalized@example.com"),
    ).resolves.toBeNull();
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

  it("searches sendable subscribers by email, first name, and last name while respecting limit", async () => {
    await upsertNewsletterSubscriber(context.db, {
      email: "alpha@example.com",
      firstName: "Alpha",
      lastName: "Anderson",
      status: "subscribed",
    });
    await upsertNewsletterSubscriber(context.db, {
      email: "bravo@example.com",
      firstName: "Beatrice",
      lastName: "Bravo",
      status: "subscribed",
    });
    await upsertNewsletterSubscriber(context.db, {
      email: "charlie@example.com",
      firstName: "Charlie",
      lastName: "Chaplin",
      status: "pending",
    });
    await upsertNewsletterSubscriber(context.db, {
      email: "suppressed@example.com",
      firstName: "Suppress",
      lastName: "Target",
      status: "subscribed",
    });
    await upsertNewsletterSuppression(context.db, {
      email: "suppressed@example.com",
      reason: "cleaned",
      source: "mailchimp_import",
    });

    const byEmail = await searchNewsletterSubscribers(
      context.db,
      "alpha@example",
      10,
    );
    const byFirstName = await searchNewsletterSubscribers(context.db, "beat", 10);
    const byLastName = await searchNewsletterSubscribers(context.db, "brav", 10);
    const limited = await searchNewsletterSubscribers(context.db, "a", 1);

    expect(byEmail.map((row) => row.email)).toEqual(["alpha@example.com"]);
    expect(byFirstName.map((row) => row.email)).toEqual(["bravo@example.com"]);
    expect(byLastName.map((row) => row.email)).toEqual(["bravo@example.com"]);
    expect(limited).toHaveLength(1);
    expect(limited[0]?.email).toBe("alpha@example.com");
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

  it("signs up a new subscriber as subscribed with opt-in metadata and website source", async () => {
    const result = await signUpNewsletterSubscriber(context.db, {
      email: "new-signup@example.com",
      firstName: "Nina",
      lastName: "Signup",
      optinTime: "2026-07-09T12:00:00.000Z",
      optinIp: "203.0.113.42",
      source: "website_signup",
    });

    expect(result.disposition).toBe("created");
    expect(result.subscriber).toMatchObject({
      email: "new-signup@example.com",
      firstName: "Nina",
      lastName: "Signup",
      status: "subscribed",
      optinTime: "2026-07-09T12:00:00.000Z",
      optinIp: "203.0.113.42",
      source: "website_signup",
      confirmTime: null,
      confirmIp: null,
    });
  });

  it("keeps duplicate signup attempts idempotent on the unique email index", async () => {
    const first = await signUpNewsletterSubscriber(context.db, {
      email: "repeat@example.com",
      firstName: "Repeat",
      optinTime: "2026-07-09T12:00:00.000Z",
      optinIp: "203.0.113.10",
      source: "website_signup",
    });
    const second = await signUpNewsletterSubscriber(context.db, {
      email: " repeat@example.com ",
      firstName: "Changed",
      optinTime: "2026-07-09T12:05:00.000Z",
      optinIp: "203.0.113.11",
      source: "website_signup",
    });
    const rows = await context.db
      .select({ value: count() })
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, "repeat@example.com"));

    expect(first.disposition).toBe("created");
    expect(second.disposition).toBe("already_subscribed");
    expect(second.subscriber.id).toBe(first.subscriber.id);
    expect(second.subscriber.firstName).toBe("Repeat");
    expect(rows[0]?.value ?? 0).toBe(1);
  });

  it("re-subscribes a previously suppressed email and clears the suppression row", async () => {
    await upsertNewsletterSuppression(context.db, {
      email: "resub@example.com",
      reason: "platform_optout",
      source: "recipient_click",
    });

    const result = await signUpNewsletterSubscriber(context.db, {
      email: "resub@example.com",
      firstName: "Re",
      lastName: "Sub",
      optinTime: "2026-07-09T13:00:00.000Z",
      optinIp: "198.51.100.8",
      source: "website_signup",
    });
    const suppression = await getNewsletterSuppressionByEmail(
      context.db,
      "resub@example.com",
    );

    expect(result.disposition).toBe("resubscribed");
    expect(result.subscriber).toMatchObject({
      email: "resub@example.com",
      firstName: "Re",
      lastName: "Sub",
      status: "subscribed",
      optinIp: "198.51.100.8",
      source: "website_signup",
    });
    expect(suppression).toBeNull();
  });
});
