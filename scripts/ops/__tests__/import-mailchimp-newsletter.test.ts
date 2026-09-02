import { describe, expect, it } from "vitest";

import {
  countSendableNewsletterSubscribers,
  getNewsletterSubscriberByEmail,
  getNewsletterSuppressionByEmail,
  newsletterSubscribers,
  newsletterSuppressions,
  upsertNewsletterSuppression,
} from "@as-comms/db";
import { createTestStage1Context } from "@as-comms/db/test-helpers";

import {
  parseSubscriberRows,
  parseSuppressionRows,
  runNewsletterImport,
} from "../import-mailchimp-newsletter.js";

const subscribedFixture = [
  "First Name,Last Name,Email Address,Status,MEMBER_RATING,OPTIN_TIME,OPTIN_IP,CONFIRM_TIME,CONFIRM_IP,LAST_CHANGED,What content are you interested in?,TAGS",
  'Alice,Smith,"  MixedCase@Example.com  ",subscribed,4,2026-06-18T10:00:00.000Z,198.51.100.10,2026-06-18T11:00:00.000Z,198.51.100.11,2026-06-19T12:00:00.000Z,"Wildlife, Forests","alpha, beta"',
  ",,,subscribed,5,,,,,,Mountains,tagged",
  'Bob,Jones,bob@example.com,,not-a-number,,,,,"",Desert,solo',
].join("\n");

const importSubscribedFixture = [
  "First Name,Last Name,Email Address,Status,MEMBER_RATING,OPTIN_TIME,OPTIN_IP,CONFIRM_TIME,CONFIRM_IP,LAST_CHANGED,What content are you interested in?,TAGS",
  "Keep,Person,keep@example.com,subscribed,5,2026-06-18T10:00:00.000Z,198.51.100.1,2026-06-18T11:00:00.000Z,198.51.100.2,2026-06-19T12:00:00.000Z,Wildlife,tag-1",
  "Suppressed,Person,suppressed@example.com,subscribed,3,2026-06-10T08:00:00.000Z,198.51.100.3,2026-06-10T09:00:00.000Z,198.51.100.4,2026-06-11T10:00:00.000Z,Forests,tag-2",
].join("\n");

const unsubscribedFixture = [
  "Email Address,Status",
  "suppressed@example.com,unsubscribed",
].join("\n");

const cleanedFixture = [
  "Email Address,Status",
  "cleaned@example.com,cleaned",
].join("\n");

async function countRows(
  context: Awaited<ReturnType<typeof createTestStage1Context>>,
): Promise<{ readonly subscribers: number; readonly suppressions: number }> {
  const [subscriberRows, suppressionRows] = await Promise.all([
    context.db.select().from(newsletterSubscribers),
    context.db.select().from(newsletterSuppressions),
  ]);

  return {
    subscribers: subscriberRows.length,
    suppressions: suppressionRows.length,
  };
}

describe("import-mailchimp-newsletter", () => {
  it("parses subscribed rows including quoted commas and blank-email skips", () => {
    const rows = parseSubscriberRows(subscribedFixture);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      email: "  MixedCase@Example.com  ",
      firstName: "Alice",
      lastName: "Smith",
      status: "subscribed",
      memberRating: 4,
      optinTime: "2026-06-18T10:00:00.000Z",
      confirmTime: "2026-06-18T11:00:00.000Z",
      lastChangedAt: "2026-06-19T12:00:00.000Z",
      interests: "Wildlife, Forests",
      tags: "alpha, beta",
      source: "mailchimp_import",
    });
    expect(rows[1]).toMatchObject({
      email: "bob@example.com",
      status: "subscribed",
      memberRating: null,
      optinTime: null,
      confirmTime: null,
      lastChangedAt: null,
      interests: "Desert",
      tags: "solo",
    });
  });

  it("parses suppression rows and skips blanks", () => {
    const rows = parseSuppressionRows(
      ["Email Address", "first@example.com", "", "second@example.com"].join("\n"),
      "cleaned",
    );

    expect(rows).toEqual([
      {
        email: "first@example.com",
        reason: "cleaned",
        source: "mailchimp_import",
      },
      {
        email: "second@example.com",
        reason: "cleaned",
        source: "mailchimp_import",
      },
    ]);
  });

  it("imports subscribers and suppressions end-to-end", async () => {
    const context = await createTestStage1Context();

    try {
      const summary = await runNewsletterImport(
        { db: context.db },
        {
          subscribedCsv: importSubscribedFixture,
          unsubscribedCsv: unsubscribedFixture,
          cleanedCsv: cleanedFixture,
          execute: true,
        },
      );

      await expect(
        getNewsletterSubscriberByEmail(context.db, "keep@example.com"),
      ).resolves.toMatchObject({
        email: "keep@example.com",
        firstName: "Keep",
        memberRating: 5,
      });
      await expect(
        getNewsletterSubscriberByEmail(context.db, "suppressed@example.com"),
      ).resolves.toMatchObject({
        email: "suppressed@example.com",
        firstName: "Suppressed",
        memberRating: 3,
      });
      await expect(
        getNewsletterSuppressionByEmail(context.db, "suppressed@example.com"),
      ).resolves.toMatchObject({
        email: "suppressed@example.com",
        reason: "unsubscribed",
      });
      await expect(
        getNewsletterSuppressionByEmail(context.db, "cleaned@example.com"),
      ).resolves.toMatchObject({
        email: "cleaned@example.com",
        reason: "cleaned",
      });
      await expect(countSendableNewsletterSubscribers(context.db)).resolves.toBe(1);

      expect(summary.subscribed.subscribersUpserted).toBe(2);
      expect(summary.unsubscribed.suppressionsUpserted).toBe(1);
      expect(summary.cleaned.suppressionsUpserted).toBe(1);
      expect(summary.totals.sendableSubscribersAfterRun).toBe(1);
    } finally {
      await context.dispose();
    }
  });

  it("is idempotent when run twice", async () => {
    const context = await createTestStage1Context();

    try {
      await runNewsletterImport(
        { db: context.db },
        {
          subscribedCsv: importSubscribedFixture,
          unsubscribedCsv: unsubscribedFixture,
          cleanedCsv: cleanedFixture,
          execute: true,
        },
      );
      const firstCounts = await countRows(context);

      await runNewsletterImport(
        { db: context.db },
        {
          subscribedCsv: importSubscribedFixture,
          unsubscribedCsv: unsubscribedFixture,
          cleanedCsv: cleanedFixture,
          execute: true,
        },
      );
      const secondCounts = await countRows(context);

      expect(secondCounts).toEqual(firstCounts);
      expect(secondCounts).toEqual({
        subscribers: 2,
        suppressions: 2,
      });
    } finally {
      await context.dispose();
    }
  });

  it("clears an unsubscribed suppression when a subscribed row is imported", async () => {
    const context = await createTestStage1Context();

    try {
      await upsertNewsletterSuppression(context.db, {
        email: "keep@example.com",
        reason: "unsubscribed",
        source: "mailchimp_import",
      });

      const summary = await runNewsletterImport(
        { db: context.db },
        {
          subscribedCsv: importSubscribedFixture,
          execute: true,
        },
      );

      await expect(
        getNewsletterSuppressionByEmail(context.db, "keep@example.com"),
      ).resolves.toBeNull();
      expect(summary.subscribed.suppressionsCleared).toBe(1);
      expect(summary.totals.suppressionsCleared).toBe(1);
    } finally {
      await context.dispose();
    }
  });

  it("preserves a platform opt-out when a subscribed row is imported", async () => {
    const context = await createTestStage1Context();

    try {
      await upsertNewsletterSuppression(context.db, {
        email: "keep@example.com",
        reason: "platform_optout",
        source: "recipient_click",
      });

      const summary = await runNewsletterImport(
        { db: context.db },
        {
          subscribedCsv: importSubscribedFixture,
          execute: true,
        },
      );

      await expect(
        getNewsletterSuppressionByEmail(context.db, "keep@example.com"),
      ).resolves.toMatchObject({ reason: "platform_optout" });
      expect(summary.subscribed.suppressionsCleared).toBe(0);
    } finally {
      await context.dispose();
    }
  });

  it("dry-runs suppression clearing without deleting the suppression", async () => {
    const context = await createTestStage1Context();

    try {
      await upsertNewsletterSuppression(context.db, {
        email: "keep@example.com",
        reason: "unsubscribed",
        source: "mailchimp_import",
      });

      const summary = await runNewsletterImport(
        { db: context.db },
        {
          subscribedCsv: importSubscribedFixture,
          execute: false,
        },
      );

      await expect(
        getNewsletterSuppressionByEmail(context.db, "keep@example.com"),
      ).resolves.toMatchObject({ reason: "unsubscribed" });
      expect(summary.subscribed.suppressionsCleared).toBe(1);
      expect(summary.totals.suppressionsCleared).toBe(1);
    } finally {
      await context.dispose();
    }
  });

  it("records the supplied source while retaining the Mailchimp default", async () => {
    const context = await createTestStage1Context();

    try {
      await runNewsletterImport(
        { db: context.db },
        {
          subscribedCsv: importSubscribedFixture,
          source: "salesforce_esp",
          execute: true,
        },
      );

      await expect(
        getNewsletterSubscriberByEmail(context.db, "keep@example.com"),
      ).resolves.toMatchObject({ source: "salesforce_esp" });

      await runNewsletterImport(
        { db: context.db },
        {
          subscribedCsv: importSubscribedFixture,
          execute: true,
        },
      );

      await expect(
        getNewsletterSubscriberByEmail(context.db, "keep@example.com"),
      ).resolves.toMatchObject({ source: "mailchimp_import" });
    } finally {
      await context.dispose();
    }
  });

  it("dry-runs without writing while returning counts", async () => {
    const context = await createTestStage1Context();

    try {
      const summary = await runNewsletterImport(
        { db: context.db },
        {
          subscribedCsv: importSubscribedFixture,
          unsubscribedCsv: unsubscribedFixture,
          cleanedCsv: cleanedFixture,
          execute: false,
        },
      );

      await expect(countRows(context)).resolves.toEqual({
        subscribers: 0,
        suppressions: 0,
      });
      expect(summary.execute).toBe(false);
      expect(summary.subscribed.subscribersUpserted).toBe(2);
      expect(summary.unsubscribed.suppressionsUpserted).toBe(1);
      expect(summary.cleaned.suppressionsUpserted).toBe(1);
      expect(summary.totals.sendableSubscribersAfterRun).toBeNull();
    } finally {
      await context.dispose();
    }
  });
});
