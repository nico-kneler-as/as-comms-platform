import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const requireAdmin = vi.hoisted(() => vi.fn());
const requireSession = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/auth/session", () => ({
  requireAdmin,
  requireSession,
}));

import {
  getAudienceBuilderBootstrap,
  loadSmsCsvAudienceSummaryAction,
  loadMemberStatusCountsForProjects,
  previewAudienceAction,
  resolveAudienceCountAction,
  resolveStoredCampaignAudience,
  searchNewsletterSubscribersAction,
  searchProjectVolunteersAction,
  uploadBroadcastAudienceCsvAction,
} from "../../app/broadcasts/_lib/audience-data-source";
import {
  createOrgSenderForTests,
  createStage1WebTestRuntime,
  setOrgSenderEnabledForTests,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

function sessionUser() {
  return {
    id: "user:operator",
    email: "operator@example.org",
  };
}

async function seedUser(runtime: Stage1WebTestRuntime): Promise<void> {
  const now = new Date("2026-06-01T12:00:00.000Z");
  await runtime.context.settings.users.upsert({
    id: "user:operator",
    name: "Operator User",
    email: "operator@example.org",
    emailVerified: now,
    image: null,
    role: "operator",
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedProject(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly projectId: string;
    readonly projectName: string;
    readonly email: string;
  },
): Promise<void> {
  await runtime.context.repositories.projectDimensions.upsert({
    projectId: input.projectId,
    projectName: input.projectName,
    projectAlias: input.projectName,
    connectedToProjectId: null,
    isActive: true,
    aiKnowledgeUrl: null,
    aiKnowledgeSyncedAt: null,
    aiKnowledgeSources: [],
    aiOperatingContext: "",
    aiAutoSyncSchedule: "never",
    aiOptimizedSynthesizedAt: null,
    aiOptimizedInputHash: null,
    source: "manual",
  });

  await runtime.context.settings.aliases.create({
    id: `${input.projectId}:alias:0`,
    alias: input.email,
    signature: "",
    projectId: input.projectId,
    createdAt: new Date("2026-06-01T12:00:00.000Z"),
    updatedAt: new Date("2026-06-01T12:00:00.000Z"),
    createdBy: null,
    updatedBy: null,
  });
  await runtime.context.settings.projects.setPostmarkSenderStatus(
    input.projectId,
    "verified",
  );
}

async function seedContact(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly contactId: string;
    readonly displayName: string;
    readonly email: string;
  },
): Promise<void> {
  await runtime.context.repositories.contacts.upsert({
    id: input.contactId,
    salesforceContactId: null,
    displayName: input.displayName,
    primaryEmail: input.email,
    primaryPhone: null,
    createdAt: "2026-06-01T12:00:00.000Z",
    updatedAt: "2026-06-01T12:00:00.000Z",
  });
}

async function seedContactIdentity(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly normalizedValue: string;
    readonly isPrimary?: boolean;
  },
): Promise<void> {
  await runtime.context.repositories.contactIdentities.upsert({
    id: input.id,
    contactId: input.contactId,
    kind: "email",
    normalizedValue: input.normalizedValue,
    isPrimary: input.isPrimary ?? false,
    source: "manual",
    verifiedAt: null,
  });
}

async function seedMembership(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly projectId: string;
    readonly status: string;
  },
): Promise<void> {
  await runtime.context.repositories.contactMemberships.upsert({
    id: input.id,
    contactId: input.contactId,
    projectId: input.projectId,
    expeditionId: null,
    role: null,
    status: input.status,
    source: "manual",
    salesforceMembershipId: null,
    salesforceDeletedAt: null,
    salesforceReconciledAt: null,
    createdAt: "2026-06-01T12:00:00.000Z",
  });
}

async function seedSmsConsent(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly phoneE164: string;
    readonly status: "opted_in" | "revoked";
    readonly createdAt: string;
  },
): Promise<void> {
  await runtime.context.repositories.consentRecords.insert({
    id: input.id,
    contactId: input.contactId,
    phoneE164: input.phoneE164,
    status: input.status,
    source: "operator_attestation",
    sourceDetail: null,
    consentedAt:
      input.status === "opted_in" ? new Date(input.createdAt) : null,
    revokedAt: input.status === "revoked" ? new Date(input.createdAt) : null,
    recordedByUserId: "user:operator",
    notes: null,
    createdAt: new Date(input.createdAt),
    updatedAt: new Date(input.createdAt),
  });
}

async function seedNewsletterSubscriber(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly id: string;
    readonly email: string;
    readonly firstName: string | null;
    readonly lastName?: string | null;
    readonly status: "subscribed" | "pending";
  },
): Promise<void> {
  await runtime.context.db.execute(sql`
    insert into newsletter_subscribers (
      id,
      email,
      first_name,
      last_name,
      status,
      source,
      created_at,
      updated_at
    ) values (
      ${input.id}::uuid,
      ${input.email},
      ${input.firstName},
      ${input.lastName ?? null},
      ${input.status},
      'mailchimp_import',
      ${new Date("2026-06-01T12:00:00.000Z").toISOString()}::timestamptz,
      ${new Date("2026-06-01T12:00:00.000Z").toISOString()}::timestamptz
    )
  `);
}

async function seedNewsletterSuppression(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly id: string;
    readonly email: string;
  },
): Promise<void> {
  await runtime.context.db.execute(sql`
    insert into newsletter_suppressions (
      id,
      email,
      reason,
      source,
      created_at,
      updated_at
    ) values (
      ${input.id}::uuid,
      ${input.email},
      'unsubscribed',
      'mailchimp_import',
      ${new Date("2026-06-01T12:00:00.000Z").toISOString()}::timestamptz,
      ${new Date("2026-06-01T12:00:00.000Z").toISOString()}::timestamptz
    )
  `);
}

async function createProjectBroadcastDraft(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly runId: string;
    readonly projectId: string | null;
    readonly fromEmail: string;
    readonly launchType?: "normal_email" | "sms";
  },
) {
  return runtime.runtime.campaigns.campaignRuns.create({
    id: input.runId,
    kind: "project",
    launchType: input.launchType ?? "normal_email",
    projectId: input.projectId,
    name: "CSV audience import",
    fromEmail: input.launchType === "sms" ? null : input.fromEmail,
    fromName: input.launchType === "sms" ? null : "Adventure Scientists",
    replyToEmail: input.launchType === "sms" ? null : input.fromEmail,
    subjectTemplate: input.launchType === "sms" ? null : "Subject",
    bodyHtmlTemplate: "<p>Hello</p>",
    bodyTextTemplate: input.launchType === "sms" ? "Hi {{firstName}}" : "Hello",
    bodyDesignJson: null,
    preheader: null,
    audienceCriteria: {
      projectId: input.projectId,
      projectIds: input.projectId === null ? [] : [input.projectId],
      statuses: [],
      contactIds: [],
      newsletterSubscriberIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
      initialFilter: "csv_upload",
    },
    audienceSize: null,
    createdByUserId: "user:operator",
    lastEditedByUserId: "user:operator",
  });
}

describe("campaign audience data source", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    requireAdmin.mockReset();
    requireSession.mockReset();
    requireAdmin.mockResolvedValue(sessionUser());
    requireSession.mockResolvedValue(sessionUser());

    runtime = await createStage1WebTestRuntime();
    await seedUser(runtime);
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("includes enabled org senders alongside project aliases and excludes disabled org senders", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedProject(runtime, {
      projectId: "project-1",
      projectName: "Beech Leaf Disease",
      email: "forests@example.org",
    });
    const enabledOrgSender = await createOrgSenderForTests(runtime, {
      email: "info@adventurescientists.org",
      label: "Adventure Scientists",
    });
    const disabledOrgSender = await createOrgSenderForTests(runtime, {
      email: "disabled@adventurescientists.org",
      label: "Disabled sender",
    });
    await setOrgSenderEnabledForTests(runtime, disabledOrgSender.id, false);
    (
      runtime.runtime.connection as {
        sql: (strings: TemplateStringsArray, ...values: readonly unknown[]) => Promise<readonly unknown[]>;
      }
    ).sql = vi.fn(() => Promise.resolve([]));

    const bootstrap = await getAudienceBuilderBootstrap();

    expect(bootstrap.senderOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: "forests@example.org",
          projectId: "project-1",
          senderType: "project",
        }),
        expect.objectContaining({
          email: enabledOrgSender.email,
          projectId: null,
          senderType: "org",
        }),
      ]),
    );
    expect(
      bootstrap.senderOptions.some(
        (option) => option.email === "disabled@adventurescientists.org",
      ),
    ).toBe(false);
  });

  it("searches all contacts for org-sender specific audiences when no project scope is supplied", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedContact(runtime, {
      contactId: "contact-1",
      displayName: "Allie Example",
      email: "allie@example.org",
    });

    const result = await searchProjectVolunteersAction({
      aliasProjectIds: [],
      query: "allie",
    });

    expect(result).toMatchObject({
      ok: true,
      data: [
        expect.objectContaining({
          contactId: "contact-1",
          email: "allie@example.org",
          project: null,
        }),
      ],
    });
  });

  it("keeps email totals unchanged and counts only SMS-reachable contacts per status on the SMS path", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedProject(runtime, {
      projectId: "project-1",
      projectName: "Beech Leaf Disease",
      email: "forests@example.org",
    });
    await seedProject(runtime, {
      projectId: "project-2",
      projectName: "CA Biodiversity",
      email: "cabio@example.org",
    });

    await seedContact(runtime, {
      contactId: "contact-1",
      displayName: "Reachable Waitlist",
      email: "reachable@example.org",
    });
    await seedContact(runtime, {
      contactId: "contact-2",
      displayName: "Revoked Waitlist",
      email: "revoked@example.org",
    });
    await seedContact(runtime, {
      contactId: "contact-3",
      displayName: "No Phone Denied",
      email: "nophone@example.org",
    });
    await seedContact(runtime, {
      contactId: "contact-4",
      displayName: "Other Project Reachable",
      email: "other@example.org",
    });

    await seedMembership(runtime, {
      id: "membership-1",
      contactId: "contact-1",
      projectId: "project-1",
      status: "Waitlist",
    });
    await seedMembership(runtime, {
      id: "membership-2",
      contactId: "contact-2",
      projectId: "project-1",
      status: "Waitlist",
    });
    await seedMembership(runtime, {
      id: "membership-3",
      contactId: "contact-3",
      projectId: "project-1",
      status: "Denied",
    });
    await seedMembership(runtime, {
      id: "membership-4",
      contactId: "contact-4",
      projectId: "project-2",
      status: "Waitlist",
    });

    await seedSmsConsent(runtime, {
      id: "consent-1",
      contactId: "contact-1",
      phoneE164: "+14065550101",
      status: "opted_in",
      createdAt: "2026-06-01T12:00:00.000Z",
    });
    await seedSmsConsent(runtime, {
      id: "consent-2",
      contactId: "contact-2",
      phoneE164: "+14065550102",
      status: "revoked",
      createdAt: "2026-06-01T12:00:00.000Z",
    });
    await seedSmsConsent(runtime, {
      id: "consent-3",
      contactId: "contact-3",
      phoneE164: "",
      status: "opted_in",
      createdAt: "2026-06-01T12:00:00.000Z",
    });
    await seedSmsConsent(runtime, {
      id: "consent-4",
      contactId: "contact-4",
      phoneE164: "+14065550104",
      status: "opted_in",
      createdAt: "2026-06-01T12:00:00.000Z",
    });

    const emailResult = await loadMemberStatusCountsForProjects(["project-1"]);
    const smsResult = await loadMemberStatusCountsForProjects(
      ["project-1"],
      "sms",
    );

    expect(emailResult).toMatchObject({
      ok: true,
      data: {
        Waitlist: 2,
        Denied: 1,
      },
    });
    expect(smsResult).toMatchObject({
      ok: true,
      data: {
        Waitlist: 1,
        Denied: 0,
      },
    });
  });

  it("resolves stored newsletter runs with no contact ids to the sendable subscriber audience", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedNewsletterSubscriber(runtime, {
      id: "11111111-1111-1111-1111-111111111111",
      email: "alpha@example.org",
      firstName: "Alpha",
      status: "subscribed",
    });
    await seedNewsletterSubscriber(runtime, {
      id: "22222222-2222-2222-2222-222222222222",
      email: "suppressed@example.org",
      firstName: "Suppressed",
      status: "subscribed",
    });
    await seedNewsletterSubscriber(runtime, {
      id: "33333333-3333-3333-3333-333333333333",
      email: "pending@example.org",
      firstName: "Pending",
      status: "pending",
    });
    await seedNewsletterSuppression(runtime, {
      id: "44444444-4444-4444-4444-444444444444",
      email: "suppressed@example.org",
    });

    const audience = await resolveStoredCampaignAudience({
      kind: "newsletter",
      criteria: {
        projectId: null,
        projectIds: [],
        statuses: [],
        contactIds: [],
        expeditionIds: [],
        lastActivityWindow: "all_time",
        hasReplied: "either",
        hasClicked: "either",
      },
      at: new Date("2026-06-15T12:00:00.000Z"),
    });

    expect(audience).toEqual([
      {
        contactId: null,
        newsletterSubscriberId: "11111111-1111-1111-1111-111111111111",
        frozenEmail: "alpha@example.org",
        frozenFirstName: "Alpha",
        frozenProjectName: null,
        frozenProjectId: null,
        frozenAliasEmail: null,
      },
    ]);
  });

  it("resolves specific newsletter subscriber picks as non-contact audience members and excludes suppressed picks", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedNewsletterSubscriber(runtime, {
      id: "55555555-5555-5555-5555-555555555555",
      email: "picked@example.org",
      firstName: "Picked",
      status: "subscribed",
    });
    await seedNewsletterSubscriber(runtime, {
      id: "66666666-6666-6666-6666-666666666666",
      email: "suppressed-picked@example.org",
      firstName: "Suppressed",
      status: "subscribed",
    });
    await seedNewsletterSuppression(runtime, {
      id: "77777777-7777-7777-7777-777777777777",
      email: "suppressed-picked@example.org",
    });

    const audience = await resolveStoredCampaignAudience({
      kind: "newsletter",
      criteria: {
        projectId: null,
        projectIds: [],
        statuses: [],
        contactIds: [],
        newsletterSubscriberIds: [
          "66666666-6666-6666-6666-666666666666",
          "55555555-5555-5555-5555-555555555555",
        ],
        expeditionIds: [],
        lastActivityWindow: "all_time",
        hasReplied: "either",
        hasClicked: "either",
      },
      at: new Date("2026-06-15T12:00:00.000Z"),
    });

    expect(audience).toEqual([
      {
        contactId: null,
        newsletterSubscriberId: "55555555-5555-5555-5555-555555555555",
        frozenEmail: "picked@example.org",
        frozenFirstName: "Picked",
        frozenProjectName: null,
        frozenProjectId: null,
        frozenAliasEmail: null,
      },
    ]);
  });

  it("counts all_available newsletter audiences from sendable subscribers", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedNewsletterSubscriber(runtime, {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      email: "alpha@example.org",
      firstName: "Alpha",
      status: "subscribed",
    });
    await seedNewsletterSubscriber(runtime, {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      email: "bravo@example.org",
      firstName: "Bravo",
      status: "subscribed",
    });
    await seedNewsletterSuppression(runtime, {
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      email: "bravo@example.org",
    });

    const result = await resolveAudienceCountAction({
      runId: "newsletter-preview",
      kind: "newsletter",
      criteria: {
        projectId: null,
        projectIds: [],
        statuses: [],
        contactIds: [],
        expeditionIds: [],
        lastActivityWindow: "all_time",
        hasReplied: "either",
        hasClicked: "either",
        initialFilter: "all_available",
      },
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        count: 1,
        hasAppliedFilters: true,
      },
    });
  });

  it("searches newsletter subscribers for org-sender specific audiences", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedNewsletterSubscriber(runtime, {
      id: "88888888-8888-8888-8888-888888888888",
      email: "alpha@example.org",
      firstName: "Alpha",
      lastName: "Lane",
      status: "subscribed",
    });
    await seedNewsletterSubscriber(runtime, {
      id: "99999999-9999-9999-9999-999999999999",
      email: "suppressed@example.org",
      firstName: "Suppressed",
      lastName: "Lane",
      status: "subscribed",
    });
    await seedNewsletterSuppression(runtime, {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      email: "suppressed@example.org",
    });

    const result = await searchNewsletterSubscribersAction({
      query: "alpha",
    });

    expect(result).toMatchObject({
      ok: true,
      data: [
        {
          subscriberId: "88888888-8888-8888-8888-888888888888",
          email: "alpha@example.org",
          firstName: "Alpha",
        },
      ],
    });
  });

  it("imports a CSV audience, returns counts plus preview, and persists the stored rows", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedProject(runtime, {
      projectId: "project-csv",
      projectName: "Corals",
      email: "corals@example.org",
    });
    await seedContact(runtime, {
      contactId: "contact-csv",
      displayName: "Existing Contact",
      email: "existing@example.org",
    });
    await createProjectBroadcastDraft(runtime, {
      runId: "run-csv",
      projectId: "project-csv",
      fromEmail: "corals@example.org",
    });

    const upload = await uploadBroadcastAudienceCsvAction({
      runId: "run-csv",
      csvText: [
        "email,firstName,lastName",
        "existing@example.org,Existing,Contact",
        "new@example.org,New,Recipient",
        "existing@example.org,Duplicate,Ignored",
        "bad-email,Bad,Row",
      ].join("\n"),
    });

    expect(upload).toMatchObject({
      ok: true,
      data: {
        importedCount: 2,
        invalidSkippedCount: 1,
        duplicatesRemovedCount: 1,
        sample: [
          {
            email: "existing@example.org",
            name: "Existing Contact",
          },
          {
            email: "new@example.org",
            name: "New Recipient",
          },
        ],
      },
    });

    const count = await resolveAudienceCountAction({
      runId: "run-csv",
      kind: "project",
      criteria: {
        projectId: null,
        projectIds: [],
        statuses: [],
        contactIds: [],
        newsletterSubscriberIds: [],
        expeditionIds: [],
        lastActivityWindow: "all_time",
        hasReplied: "either",
        hasClicked: "either",
        initialFilter: "csv_upload",
      },
    });
    const preview = await previewAudienceAction({
      runId: "run-csv",
      kind: "project",
      criteria: {
        projectId: null,
        projectIds: [],
        statuses: [],
        contactIds: [],
        newsletterSubscriberIds: [],
        expeditionIds: [],
        lastActivityWindow: "all_time",
        hasReplied: "either",
        hasClicked: "either",
        initialFilter: "csv_upload",
      },
    });
    const audience = await resolveStoredCampaignAudience({
      runId: "run-csv",
      kind: "project",
      criteria: {
        projectId: null,
        projectIds: [],
        statuses: [],
        contactIds: [],
        newsletterSubscriberIds: [],
        expeditionIds: [],
        lastActivityWindow: "all_time",
        hasReplied: "either",
        hasClicked: "either",
        initialFilter: "csv_upload",
      },
      at: new Date("2026-06-01T12:00:00.000Z"),
      fromEmail: "corals@example.org",
      projectId: "project-csv",
    });

    expect(count).toMatchObject({
      ok: true,
      data: {
        count: 2,
        hasAppliedFilters: true,
      },
    });
    expect(preview).toMatchObject({
      ok: true,
      data: [
        {
          email: "existing@example.org",
          name: "Existing Contact",
        },
        {
          email: "new@example.org",
          name: "New Recipient",
        },
      ],
    });
    expect(audience).toEqual([
      {
        contactId: "contact-csv",
        newsletterSubscriberId: null,
        frozenEmail: "existing@example.org",
        frozenFirstName: "Existing",
        frozenProjectName: "Corals",
        frozenProjectId: "project-csv",
        frozenAliasEmail: "corals@example.org",
      },
      {
        contactId: null,
        newsletterSubscriberId: null,
        frozenEmail: "new@example.org",
        frozenFirstName: "New",
        frozenProjectName: "Corals",
        frozenProjectId: "project-csv",
        frozenAliasEmail: "corals@example.org",
      },
    ]);
  });

  it("accepts SMS CSV uploads, counts matched contacts, and reports dropped rows without project filtering", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedProject(runtime, {
      projectId: "project-sms-meta",
      projectName: "Corals",
      email: "corals@example.org",
    });
    await seedProject(runtime, {
      projectId: "project-other",
      projectName: "Forests",
      email: "forests@example.org",
    });
    await seedContact(runtime, {
      contactId: "contact-primary",
      displayName: "Ada Lovelace",
      email: "primary@example.org",
    });
    await seedContact(runtime, {
      contactId: "contact-identity",
      displayName: "Grace Hopper",
      email: "grace.primary@example.org",
    });
    await seedContactIdentity(runtime, {
      id: "identity-secondary",
      contactId: "contact-identity",
      normalizedValue: "secondary@example.org",
      isPrimary: true,
    });
    await seedContact(runtime, {
      contactId: "contact-ambiguous-a",
      displayName: "Ambiguous One",
      email: "shared@example.org",
    });
    await seedContact(runtime, {
      contactId: "contact-ambiguous-b",
      displayName: "Ambiguous Two",
      email: "other@example.org",
    });
    await seedContactIdentity(runtime, {
      id: "identity-ambiguous",
      contactId: "contact-ambiguous-b",
      normalizedValue: "shared@example.org",
    });
    await seedContact(runtime, {
      contactId: "contact-no-consent",
      displayName: "No Consent",
      email: "noconsent@example.org",
    });
    await seedContact(runtime, {
      contactId: "contact-revoked",
      displayName: "Revoked Contact",
      email: "revoked@example.org",
    });
    await seedContact(runtime, {
      contactId: "contact-no-phone",
      displayName: "No Phone",
      email: "nophone@example.org",
    });
    await seedSmsConsent(runtime, {
      id: "consent-primary",
      contactId: "contact-primary",
      phoneE164: "+14065550101",
      status: "opted_in",
      createdAt: "2026-06-01T12:01:00.000Z",
    });
    await seedSmsConsent(runtime, {
      id: "consent-identity",
      contactId: "contact-identity",
      phoneE164: "+14065550102",
      status: "opted_in",
      createdAt: "2026-06-01T12:02:00.000Z",
    });
    await seedSmsConsent(runtime, {
      id: "consent-revoked",
      contactId: "contact-revoked",
      phoneE164: "+14065550103",
      status: "revoked",
      createdAt: "2026-06-01T12:03:00.000Z",
    });
    await seedSmsConsent(runtime, {
      id: "consent-no-phone",
      contactId: "contact-no-phone",
      phoneE164: "",
      status: "opted_in",
      createdAt: "2026-06-01T12:04:00.000Z",
    });
    await createProjectBroadcastDraft(runtime, {
      runId: "run-sms-csv",
      projectId: "project-sms-meta",
      fromEmail: "corals@example.org",
      launchType: "sms",
    });

    const upload = await uploadBroadcastAudienceCsvAction({
      runId: "run-sms-csv",
      csvText: [
        "email",
        "primary@example.org",
        "secondary@example.org",
        "shared@example.org",
        "noconsent@example.org",
        "revoked@example.org",
        "nophone@example.org",
        "missing@example.org",
      ].join("\n"),
    });

    expect(upload).toMatchObject({
      ok: true,
      data: {
        importedCount: 7,
        invalidSkippedCount: 0,
        duplicatesRemovedCount: 0,
      },
    });

    const criteria = {
      projectId: "project-other",
      projectIds: ["project-other"],
      statuses: [],
      contactIds: [],
      newsletterSubscriberIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time" as const,
      hasReplied: "either" as const,
      hasClicked: "either" as const,
      initialFilter: "csv_upload" as const,
    };
    const count = await resolveAudienceCountAction({
      runId: "run-sms-csv",
      kind: "project",
      criteria,
    });
    const preview = await previewAudienceAction({
      runId: "run-sms-csv",
      kind: "project",
      criteria,
    });
    const summary = await loadSmsCsvAudienceSummaryAction({
      runId: "run-sms-csv",
    });

    expect(count).toMatchObject({
      ok: true,
      data: {
        count: 5,
        hasAppliedFilters: true,
      },
    });
    expect(preview).toMatchObject({
      ok: true,
      data: [
        {
          contactId: "contact-primary",
          name: "Ada Lovelace",
          email: "primary@example.org",
        },
        {
          contactId: "contact-identity",
          name: "Grace Hopper",
          email: "grace.primary@example.org",
        },
        {
          contactId: "contact-no-consent",
          name: "No Consent",
          email: "noconsent@example.org",
        },
        {
          contactId: "contact-revoked",
          name: "Revoked Contact",
          email: "revoked@example.org",
        },
        {
          contactId: "contact-no-phone",
          name: "No Phone",
          email: "nophone@example.org",
        },
      ],
    });
    expect(summary).toMatchObject({
      ok: true,
      data: {
        importedCount: 7,
        matchedCount: 5,
        reachableCount: 2,
        droppedCount: 5,
        deduplicatedByPhone: 0,
        droppedByReason: {
          no_contact_match: 1,
          ambiguous_match: 1,
          no_consent: 1,
          revoked: 1,
          no_phone: 1,
        },
        droppedRows: [
          { email: "shared@example.org", reason: "ambiguous_match" },
          { email: "noconsent@example.org", reason: "no_consent" },
          { email: "revoked@example.org", reason: "revoked" },
          { email: "nophone@example.org", reason: "no_phone" },
          { email: "missing@example.org", reason: "no_contact_match" },
        ],
      },
    });
  });

  it("rejects CSV uploads over the shared row cap with a clear message", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedProject(runtime, {
      projectId: "project-cap",
      projectName: "Corals",
      email: "corals@example.org",
    });
    await createProjectBroadcastDraft(runtime, {
      runId: "run-cap",
      projectId: "project-cap",
      fromEmail: "corals@example.org",
    });

    const rows = ["email"];
    for (let index = 0; index < 5001; index += 1) {
      rows.push(`person${String(index)}@example.org`);
    }

    const result = await uploadBroadcastAudienceCsvAction({
      runId: "run-cap",
      csvText: rows.join("\n"),
    });

    expect(result).toMatchObject({
      ok: false,
      message: "CSV can include at most 5,000 recipient rows.",
    });
  });

  it("rejects CSV uploads that do not include an email header", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedProject(runtime, {
      projectId: "project-header",
      projectName: "Corals",
      email: "corals@example.org",
    });
    await createProjectBroadcastDraft(runtime, {
      runId: "run-header",
      projectId: "project-header",
      fromEmail: "corals@example.org",
    });

    const result = await uploadBroadcastAudienceCsvAction({
      runId: "run-header",
      csvText: ["firstName", "Ada"].join("\n"),
    });

    expect(result).toMatchObject({
      ok: false,
      message: 'CSV must include an "email" column.',
    });
  });

  it("replaces the previously uploaded CSV rows on re-upload", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedProject(runtime, {
      projectId: "project-reupload",
      projectName: "Corals",
      email: "corals@example.org",
    });
    await createProjectBroadcastDraft(runtime, {
      runId: "run-reupload",
      projectId: "project-reupload",
      fromEmail: "corals@example.org",
    });

    const firstUpload = await uploadBroadcastAudienceCsvAction({
      runId: "run-reupload",
      csvText: ["email", "first@example.org"].join("\n"),
    });
    expect(firstUpload.ok).toBe(true);

    const secondUpload = await uploadBroadcastAudienceCsvAction({
      runId: "run-reupload",
      csvText: ["email", "second@example.org"].join("\n"),
    });
    expect(secondUpload.ok).toBe(true);

    const preview = await previewAudienceAction({
      runId: "run-reupload",
      kind: "project",
      criteria: {
        projectId: null,
        projectIds: [],
        statuses: [],
        contactIds: [],
        newsletterSubscriberIds: [],
        expeditionIds: [],
        lastActivityWindow: "all_time",
        hasReplied: "either",
        hasClicked: "either",
        initialFilter: "csv_upload",
      },
    });

    expect(preview).toMatchObject({
      ok: true,
      data: [
        {
          email: "second@example.org",
          name: "second@example.org",
        },
      ],
    });
  });
});
