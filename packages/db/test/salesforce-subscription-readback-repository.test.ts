import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { PlannedReadbackEvent } from "@as-comms/domain";

import {
  createSubscriptionBoxAudienceSource,
  createSalesforceSubscriptionReadbackRepository,
  createStage5RepositoryBundle,
  contactConsent,
  contactConsentClears,
  contactIdentities,
  integrationHealth,
  contacts,
  newsletterSubscribers,
  newsletterSuppressions,
  projectDimensions,
  salesforceSubscriptionPreferences,
  salesforceSubscriptionReadbackEvents,
  salesforceSubscriptionOutbox,
} from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";

const mirror = {
  salesforceRecordId: "esp-1",
  email: "person@example.org",
  salesforceContactId: "sf-1",
  generalNewsletter: false,
  oregonShoresNewsletter: false,
  projectBoxes: {
    "PNW Forest Monitoring": false,
    "Beech and Butternut": false,
    "Tracking Whitebark Pine": false,
    "Coral Reef Expansion": false,
    "Monitoring Killer Whales Project": false,
  },
  unsubscribedFromAll: false,
  unsubscribedAt: null,
  emailBounced: false,
  recordCreationSource: null,
  isDeleted: false,
  sfLastModifiedAt: "2026-11-07T12:00:00.000Z",
  sfLastModifiedById: null,
  capturedAt: "2026-11-07T12:00:00.000Z",
} as const;

const actionEvent = (
  actions: PlannedReadbackEvent["actions"],
  outcome: PlannedReadbackEvent["outcome"] = "applied",
) => ({
  id: crypto.randomUUID(),
  salesforceRecordId: "esp-1",
  email: "person@example.org",
  field: "general_newsletter" as const,
  projectBox: null,
  fromValue: false,
  toValue: true,
  sfModifiedAt: "2026-11-07T12:00:00.000Z",
  sfModifiedByUsername: "staff@example.org",
  contactsMatched: 1,
  outcome,
  actions,
});
async function seedContact(
  context: Awaited<ReturnType<typeof createTestStage1Context>>,
  input: {
    id: string;
    salesforceContactId?: string | null;
    email?: string | null;
  },
) {
  await context.db.insert(contacts).values({
    id: input.id,
    salesforceContactId: input.salesforceContactId ?? null,
    displayName: input.id,
    primaryEmail: input.email ?? null,
    primaryPhone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("salesforce subscription readback repository", () => {
  let context: Awaited<ReturnType<typeof createTestStage1Context>> | undefined;
  afterEach(async () => {
    await context?.dispose();
    context = undefined;
  });

  it("clears consent into immutable history and never enqueues an outbox row", async () => {
    context = await createTestStage1Context();
    await context.db.insert(contacts).values({
      id: "contact-1",
      salesforceContactId: "sf-1",
      displayName: "Person",
      primaryEmail: "person@example.org",
      primaryPhone: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await context.db.insert(contactConsent).values({
      id: "consent-1",
      contactId: "contact-1",
      scopeType: "newsletter",
      scopeId: null,
      source: "import",
      sourceRunId: null,
      optedOutAt: new Date("2026-11-07T11:00:00.000Z"),
      createdAt: new Date(),
    });
    const repository = createSalesforceSubscriptionReadbackRepository(
      context.db,
    );
    await repository.persistBatch({
      mode: "apply",
      mirrorUpserts: [mirror],
      events: [
        {
          id: crypto.randomUUID(),
          salesforceRecordId: "esp-1",
          email: "person@example.org",
          field: "general_newsletter",
          projectBox: null,
          fromValue: false,
          toValue: true,
          sfModifiedAt: "2026-11-07T12:00:00.000Z",
          sfModifiedByUsername: "staff@example.org",
          contactsMatched: 1,
          outcome: "applied",
          actions: [{ kind: "clear_consent", consentIds: ["consent-1"] }],
        },
      ],
    });
    expect(
      await context.db
        .select()
        .from(contactConsent)
        .where(eq(contactConsent.id, "consent-1")),
    ).toHaveLength(0);
    expect(
      await context.db
        .select()
        .from(contactConsentClears)
        .where(eq(contactConsentClears.consentId, "consent-1")),
    ).toHaveLength(1);
    expect(
      await context.db.select().from(salesforceSubscriptionOutbox),
    ).toHaveLength(0);
    expect((await repository.loadMirror(["esp-1"])).size).toBe(1);
  });

  it("matches contacts by Salesforce id, email identity and primary email without duplicates", async () => {
    context = await createTestStage1Context();
    await seedContact(context, {
      id: "by-sf",
      salesforceContactId: "sf-match",
    });
    await seedContact(context, { id: "by-identity" });
    await seedContact(context, {
      id: "by-primary",
      email: "primary@example.org",
    });
    await seedContact(context, {
      id: "all-three",
      salesforceContactId: "sf-all",
      email: "all@example.org",
    });
    await context.db.insert(contactIdentities).values([
      {
        id: "email-identity",
        contactId: "by-identity",
        kind: "email",
        normalizedValue: "identity@example.org",
        isPrimary: true,
        source: "manual",
        verifiedAt: null,
      },
      {
        id: "email-all",
        contactId: "all-three",
        kind: "email",
        normalizedValue: "all@example.org",
        isPrimary: true,
        source: "manual",
        verifiedAt: null,
      },
    ]);
    const matches = await createSalesforceSubscriptionReadbackRepository(
      context.db,
    ).loadContacts([
      {
        salesforceRecordId: "sf",
        salesforceContactId: "sf-match",
        email: "none@example.org",
      },
      {
        salesforceRecordId: "identity",
        salesforceContactId: null,
        email: "identity@example.org",
      },
      {
        salesforceRecordId: "primary",
        salesforceContactId: null,
        email: "primary@example.org",
      },
      {
        salesforceRecordId: "all",
        salesforceContactId: "sf-all",
        email: "all@example.org",
      },
      {
        salesforceRecordId: "none",
        salesforceContactId: null,
        email: "none@example.org",
      },
    ]);
    expect(matches.get("sf")).toEqual(["by-sf"]);
    expect(matches.get("identity")).toEqual(["by-identity"]);
    expect(matches.get("primary")).toEqual(["by-primary"]);
    expect(matches.get("all")).toEqual(["all-three"]);
    expect(matches.get("none")).toEqual([]);
  });

  it("maps host subscription boxes to connected projects and returns a Date max", async () => {
    context = await createTestStage1Context();
    await context.db.insert(projectDimensions).values([
      {
        projectId: "host",
        projectName: "Host",
        projectAlias: "Host",
        isActive: false,
        connectedToProjectId: null,
        subscriptionBox: "PNW Forest Monitoring",
        aiKnowledgeUrl: null,
        aiKnowledgeSyncedAt: null,
        aiKnowledgeSources: [],
        aiOperatingContext: "",
        aiAutoSyncSchedule: "never",
        aiOptimizedSynthesizedAt: null,
        aiOptimizedInputHash: null,
        source: "manual",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        projectId: "child",
        projectName: "Child",
        projectAlias: "Child",
        isActive: false,
        connectedToProjectId: "host",
        subscriptionBox: null,
        aiKnowledgeUrl: null,
        aiKnowledgeSyncedAt: null,
        aiKnowledgeSources: [],
        aiOperatingContext: "",
        aiAutoSyncSchedule: "never",
        aiOptimizedSynthesizedAt: null,
        aiOptimizedInputHash: null,
        source: "manual",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        projectId: "orphan",
        projectName: "Orphan",
        projectAlias: null,
        isActive: false,
        connectedToProjectId: null,
        subscriptionBox: null,
        aiKnowledgeUrl: null,
        aiKnowledgeSyncedAt: null,
        aiKnowledgeSources: [],
        aiOperatingContext: "",
        aiAutoSyncSchedule: "never",
        aiOptimizedSynthesizedAt: null,
        aiOptimizedInputHash: null,
        source: "manual",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const repository = createSalesforceSubscriptionReadbackRepository(
      context.db,
    );
    await expect(repository.maxMirrorModifiedAt()).resolves.toBeNull();
    expect(await repository.loadProjectsByBox()).toEqual(
      new Map([["PNW Forest Monitoring", ["host", "child"]]]),
    );
    await repository.persistBatch({
      mode: "dry_run",
      mirrorUpserts: [mirror],
      events: [],
    });
    await expect(repository.maxMirrorModifiedAt()).resolves.toBeInstanceOf(
      Date,
    );
  });

  it("provides box-audience contact matching, host resolution, and heartbeat freshness", async () => {
    context = await createTestStage1Context();
    await seedContact(context, {
      id: "by-salesforce-id",
      salesforceContactId: "salesforce-contact",
    });
    await seedContact(context, { id: "by-email" });
    await context.db.insert(contactIdentities).values({
      id: "identity-by-email",
      contactId: "by-email",
      kind: "email",
      normalizedValue: "email-match@example.org",
      isPrimary: true,
      source: "manual",
      verifiedAt: null,
    });
    await context.db.insert(projectDimensions).values([
      {
        projectId: "host",
        projectName: "Host",
        projectAlias: "Host",
        isActive: true,
        connectedToProjectId: null,
        subscriptionBox: "Beech and Butternut",
        aiKnowledgeUrl: null,
        aiKnowledgeSyncedAt: null,
        aiKnowledgeSources: [],
        aiOperatingContext: "",
        aiAutoSyncSchedule: "never",
        aiOptimizedSynthesizedAt: null,
        aiOptimizedInputHash: null,
        source: "manual",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        projectId: "child",
        projectName: "Child",
        projectAlias: "Child",
        isActive: true,
        connectedToProjectId: "host",
        subscriptionBox: null,
        aiKnowledgeUrl: null,
        aiKnowledgeSyncedAt: null,
        aiKnowledgeSources: [],
        aiOperatingContext: "",
        aiAutoSyncSchedule: "never",
        aiOptimizedSynthesizedAt: null,
        aiOptimizedInputHash: null,
        source: "manual",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const repository = createSalesforceSubscriptionReadbackRepository(context.db);
    const withBeechTicked = (input: {
      readonly salesforceRecordId: string;
      readonly salesforceContactId: string | null;
      readonly email: string;
      readonly isDeleted?: boolean;
      readonly unsubscribedFromAll?: boolean;
    }) => ({
      ...mirror,
      ...input,
      projectBoxes: {
        ...mirror.projectBoxes,
        "Beech and Butternut": true,
      },
      isDeleted: input.isDeleted ?? false,
      unsubscribedFromAll: input.unsubscribedFromAll ?? false,
    });
    await repository.persistBatch({
      mode: "dry_run",
      mirrorUpserts: [
        withBeechTicked({
          salesforceRecordId: "match-by-id",
          salesforceContactId: "salesforce-contact",
          email: "different@example.org",
        }),
        withBeechTicked({
          salesforceRecordId: "match-by-email",
          salesforceContactId: null,
          email: "email-match@example.org",
        }),
        withBeechTicked({
          salesforceRecordId: "deleted",
          salesforceContactId: "salesforce-contact",
          email: "deleted@example.org",
          isDeleted: true,
        }),
        withBeechTicked({
          salesforceRecordId: "all-unsubscribed",
          salesforceContactId: "salesforce-contact",
          email: "unsubscribed@example.org",
          unsubscribedFromAll: true,
        }),
      ],
      events: [],
    });
    const logger = { info: vi.fn() };
    const audienceSource = createSubscriptionBoxAudienceSource(context.db, {
      logger,
    });

    await expect(
      audienceSource.listTickedContactIds("Beech and Butternut"),
    ).resolves.toEqual(new Set(["by-salesforce-id", "by-email"]));
    await expect(audienceSource.loadProjectBoxes()).resolves.toEqual(
      new Map([
        ["host", "Beech and Butternut"],
        ["child", "Beech and Butternut"],
      ]),
    );
    await expect(audienceSource.lastRefreshedAt()).resolves.toBeNull();

    const refreshedAt = new Date("2026-11-10T12:00:00.000Z");
    await repository.recordSuccessfulRefresh(refreshedAt);
    await expect(audienceSource.lastRefreshedAt()).resolves.toEqual(refreshedAt);
    expect(
      await context.db
        .select()
        .from(integrationHealth)
        .where(eq(integrationHealth.id, "salesforce_subscription_readback")),
    ).toMatchObject([
      {
        serviceName: "salesforce_subscription_readback",
        category: "crm",
        status: "healthy",
      },
    ]);
  });

  it("applies each action safely and leaves the outbox empty", async () => {
    context = await createTestStage1Context();
    await seedContact(context, {
      id: "contact-1",
      email: "person@example.org",
    });
    const repository = createSalesforceSubscriptionReadbackRepository(
      context.db,
    );
    const eventId = crypto.randomUUID();
    await repository.persistBatch({
      mode: "apply",
      mirrorUpserts: [mirror],
      events: [
        {
          ...actionEvent([
            {
              kind: "insert_consent",
              contactId: "contact-1",
              scopeType: "newsletter",
              scopeId: null,
              optedOutAt: "2026-11-07T12:00:00.000Z",
            },
          ]),
          id: eventId,
        },
        actionEvent([
          { kind: "insert_suppression", email: "person@example.org" },
        ]),
        actionEvent([
          {
            kind: "upsert_subscriber",
            email: "person@example.org",
            changedAt: "2026-11-07T12:00:00.000Z",
          },
        ]),
      ],
    });
    expect(await context.db.select().from(contactConsent)).toHaveLength(1);
    expect(
      await context.db.select().from(newsletterSuppressions),
    ).toMatchObject([{ reason: "platform_optout" }]);
    expect(await context.db.select().from(newsletterSubscribers)).toMatchObject(
      [{ status: "subscribed", source: "salesforce" }],
    );
    expect(
      await context.db.select().from(salesforceSubscriptionOutbox),
    ).toHaveLength(0);
    await context.db.insert(newsletterSuppressions).values({
      email: "cleaned@example.org",
      reason: "cleaned",
      source: "import",
    });
    await repository.persistBatch({
      mode: "apply",
      mirrorUpserts: [],
      events: [
        actionEvent([
          { kind: "insert_suppression", email: "cleaned@example.org" },
        ]),
        actionEvent([
          { kind: "delete_suppression", email: "cleaned@example.org" },
        ]),
      ],
    });
    expect(
      await context.db
        .select()
        .from(newsletterSuppressions)
        .where(eq(newsletterSuppressions.email, "cleaned@example.org")),
    ).toMatchObject([{ reason: "cleaned" }]);
  });

  it("does not change consent, subscribers or suppressions during dry run", async () => {
    context = await createTestStage1Context();
    await seedContact(context, { id: "contact-1" });
    const repository = createSalesforceSubscriptionReadbackRepository(
      context.db,
    );
    await repository.persistBatch({
      mode: "dry_run",
      mirrorUpserts: [mirror],
      events: [
        actionEvent(
          [
            {
              kind: "insert_consent",
              contactId: "contact-1",
              scopeType: "newsletter",
              scopeId: null,
              optedOutAt: "2026-11-07T12:00:00.000Z",
            },
            { kind: "insert_suppression", email: "person@example.org" },
            {
              kind: "upsert_subscriber",
              email: "person@example.org",
              changedAt: "2026-11-07T12:00:00.000Z",
            },
          ],
          "would_apply",
        ),
      ],
    });
    expect(await context.db.select().from(contactConsent)).toEqual([]);
    expect(await context.db.select().from(newsletterSuppressions)).toEqual([]);
    expect(await context.db.select().from(newsletterSubscribers)).toEqual([]);
    expect(
      await context.db.select().from(salesforceSubscriptionPreferences),
    ).toHaveLength(1);
    expect(
      await context.db.select().from(salesforceSubscriptionReadbackEvents),
    ).toHaveLength(1);
  });

  it("flips unsubscribed subscribers but preserves subscribed provenance", async () => {
    context = await createTestStage1Context();
    const repository = createSalesforceSubscriptionReadbackRepository(
      context.db,
    );
    await context.db.insert(newsletterSubscribers).values([
      {
        email: "unsubscribed@example.org",
        status: "unsubscribed",
        source: "mailchimp_import",
        lastChangedAt: new Date("2026-11-07T11:00:00.000Z"),
      },
      {
        email: "subscribed@example.org",
        status: "subscribed",
        source: "mailchimp_import",
        lastChangedAt: new Date("2026-11-07T13:00:00.000Z"),
      },
    ]);
    await repository.persistBatch({
      mode: "apply",
      mirrorUpserts: [],
      events: [
        {
          ...actionEvent([
            {
              kind: "upsert_subscriber",
              email: "unsubscribed@example.org",
              changedAt: "2026-11-07T12:00:00.000Z",
            },
          ]),
          email: "unsubscribed@example.org",
        },
        {
          ...actionEvent([
            {
              kind: "upsert_subscriber",
              email: "subscribed@example.org",
              changedAt: "2026-11-07T12:00:00.000Z",
            },
          ]),
          email: "subscribed@example.org",
        },
      ],
    });
    const rows = await context.db.select().from(newsletterSubscribers);
    expect(
      rows.find((row) => row.email === "unsubscribed@example.org"),
    ).toMatchObject({ status: "subscribed", source: "salesforce" });
    expect(
      rows.find((row) => row.email === "subscribed@example.org"),
    ).toMatchObject({
      status: "subscribed",
      source: "mailchimp_import",
      lastChangedAt: new Date("2026-11-07T13:00:00.000Z"),
    });
  });

  it("copies a clear with event metadata and clears Stage 5 consent", async () => {
    context = await createTestStage1Context();
    await seedContact(context, { id: "contact-1" });
    await context.db.insert(contactConsent).values({
      id: "consent-1",
      contactId: "contact-1",
      scopeType: "newsletter",
      scopeId: null,
      source: "salesforce",
      sourceRunId: null,
      optedOutAt: new Date("2026-11-07T12:00:00.000Z"),
      createdAt: new Date(),
    });
    const repository = createSalesforceSubscriptionReadbackRepository(
      context.db,
    );
    const readbackEvent = actionEvent([
      { kind: "clear_consent", consentIds: ["consent-1"] },
    ]);
    await repository.persistBatch({
      mode: "apply",
      mirrorUpserts: [],
      events: [readbackEvent],
    });
    await expect(
      createStage5RepositoryBundle(context.db).contactConsent.isOptedOut(
        "contact-1",
        { type: "newsletter" },
        new Date("2026-11-07T13:00:00.000Z"),
      ),
    ).resolves.toBe(false);
    expect(await context.db.select().from(contactConsentClears)).toMatchObject([
      {
        consentId: "consent-1",
        salesforceRecordId: "esp-1",
        readbackEventId: readbackEvent.id,
      },
    ]);
    expect(
      await context.db.select().from(salesforceSubscriptionReadbackEvents),
    ).toMatchObject([{ rowsChanged: 1 }]);
  });

  it("rolls mirror, events and changes back when an event insert fails", async () => {
    context = await createTestStage1Context();
    await seedContact(context, { id: "contact-1" });
    const repository = createSalesforceSubscriptionReadbackRepository(
      context.db,
    );
    await expect(
      repository.persistBatch({
        mode: "apply",
        mirrorUpserts: [mirror],
        events: [
          {
            ...actionEvent([
              {
                kind: "insert_consent",
                contactId: "contact-1",
                scopeType: "newsletter",
                scopeId: null,
                optedOutAt: "2026-11-07T12:00:00.000Z",
              },
            ]),
            outcome: "not-a-real-outcome",
          },
        ] as never,
      }),
    ).rejects.toThrow();
    expect(
      await context.db.select().from(salesforceSubscriptionPreferences),
    ).toEqual([]);
    expect(
      await context.db.select().from(salesforceSubscriptionReadbackEvents),
    ).toEqual([]);
    expect(await context.db.select().from(contactConsent)).toEqual([]);
  });
});
