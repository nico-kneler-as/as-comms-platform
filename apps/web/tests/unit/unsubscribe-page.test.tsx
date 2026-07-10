import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as unsubscribeAllPost } from "../../app/u/[token]/all/route";
import { POST as unsubscribePost } from "../../app/u/[token]/confirm/route";
import UnsubscribeTokenPage from "../../app/u/[token]/page";
import { UnsubscribePageView } from "../../app/u/[token]/_components/unsubscribe-page-view";
import {
  loadUnsubscribePageModel,
  type UnsubscribePageModel,
} from "../../app/u/[token]/_lib/unsubscribe";
import { getStage1WebRuntime } from "../../src/server/stage1-runtime";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

Object.assign(globalThis, { React });

async function seedTarget(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly kind: "project" | "newsletter";
    readonly token: string;
    readonly contactId?: string | null;
    readonly newsletterSubscriberId?: string | null;
  },
) {
  const campaigns = (await getStage1WebRuntime()).campaigns;
  const contactId =
    input.contactId === undefined
      ? input.kind === "project"
        ? "contact-unsubscribe"
        : null
      : input.contactId;
  const newsletterSubscriberId =
    input.newsletterSubscriberId === undefined
      ? input.kind === "newsletter"
        ? input.token === "token-news-null-contact"
          ? "seed-newsletter-null-contact"
          : "seed-newsletter-default"
        : null
      : input.newsletterSubscriberId;

  if (contactId !== null) {
    await runtime.context.repositories.contacts.upsert({
      id: contactId,
      salesforceContactId: null,
      displayName: "Taylor Recipient",
      primaryEmail: "taylor@example.org",
      primaryPhone: null,
      createdAt: "2026-05-15T12:00:00.000Z",
      updatedAt: "2026-05-15T12:00:00.000Z",
    });
  }
  let persistedNewsletterSubscriberId: string | null = null;
  if (newsletterSubscriberId !== null) {
    // Drizzle's execute() result type here is intentionally opaque in the web
    // test runtime, so we seed via SQL and narrow the returned id locally.
    const seededSubscriber = await runtime.context.db.execute<{ id: string }>(sql`
            insert into newsletter_subscribers (
              id,
              email,
              first_name,
              last_name,
              status,
              member_rating,
              optin_time,
              optin_ip,
              confirm_time,
              confirm_ip,
              last_changed_at,
              interests,
              tags,
              source,
              created_at,
              updated_at
            ) values (
              gen_random_uuid(),
              ${"taylor@example.org"},
              ${"Taylor"},
              ${"Recipient"},
              ${"subscribed"},
              ${2},
              ${"2026-05-15T12:00:00.000Z"}::timestamptz,
              null,
              null,
              null,
              ${"2026-05-15T12:00:00.000Z"}::timestamptz,
              null,
              null,
              ${"mailchimp_import"},
              ${"2026-05-15T12:00:00.000Z"}::timestamptz,
              ${"2026-05-15T12:00:00.000Z"}::timestamptz
            )
            on conflict (email) do update
            set
              status = excluded.status,
              updated_at = excluded.updated_at
            returning id
          `);
    persistedNewsletterSubscriberId =
      (seededSubscriber as { rows?: readonly { id?: string }[] }).rows?.[0]?.id?.toString() ??
      null;
  }

  await runtime.context.repositories.projectDimensions.upsert({
    projectId: "project-host",
    projectName: "Forests",
    projectAlias: "forests",
    connectedToProjectId: null,
    source: "manual",
    isActive: true,
    aiKnowledgeUrl: null,
    aiKnowledgeSyncedAt: null,
    aiKnowledgeSources: [],
    aiOperatingContext: "",
    aiAutoSyncSchedule: "never",
    aiOptimizedSynthesizedAt: null,
    aiOptimizedInputHash: null,
  });
  await runtime.context.repositories.projectDimensions.upsert({
    projectId: "project-sub",
    projectName: "Beech Leaf Disease",
    projectAlias: null,
    connectedToProjectId: "project-host",
    source: "manual",
    isActive: true,
    aiKnowledgeUrl: null,
    aiKnowledgeSyncedAt: null,
    aiKnowledgeSources: [],
    aiOperatingContext: "",
    aiAutoSyncSchedule: "never",
    aiOptimizedSynthesizedAt: null,
    aiOptimizedInputHash: null,
  });

  const run = await campaigns.campaignRuns.create({
    id: `run-${input.token}`,
    kind: input.kind,
    launchType: "normal_email",
    projectId: input.kind === "project" ? "project-sub" : null,
    name: null,
    fromEmail: "forests@adventurescientists.org",
    fromName: "Adventure Scientists",
    replyToEmail: "forests@adventurescientists.org",
    subjectTemplate: "Hello",
    bodyHtmlTemplate: "<p>Hello</p>",
    bodyTextTemplate: "Hello",
    preheader: null,
    audienceCriteria: {
      projectId: input.kind === "project" ? "project-sub" : null,
      projectIds: input.kind === "project" ? ["project-sub"] : [],
      statuses: [],
      contactIds: [],
      newsletterSubscriberIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    audienceSize: 1,
    createdByUserId: null,
    lastEditedByUserId: null,
  });

  await campaigns.audienceSnapshots.bulkInsert(run.id, [
    {
      id: `snapshot-${input.token}`,
      contactId,
      newsletterSubscriberId: persistedNewsletterSubscriberId,
      frozenEmail: "taylor@example.org",
      frozenFirstName: "Taylor",
      frozenProjectName:
        input.kind === "project" ? "Beech Leaf Disease" : null,
      frozenProjectId: input.kind === "project" ? "project-sub" : null,
      frozenAliasEmail: "forests@adventurescientists.org",
      unsubscribeToken: input.token,
      deliveryStatus: "sent",
      providerMessageId: `${input.token}-message-id`,
    },
  ]);

  await campaigns.orgSettings.update({
    physicalAddressLine1: "123 Research Way",
    physicalCity: "Bozeman",
    physicalState: "MT",
    physicalZip: "59715",
    physicalCountry: "USA",
  });
}

function renderModel(model: UnsubscribePageModel): string {
  return renderToStaticMarkup(<UnsubscribePageView model={model} />);
}

describe("public unsubscribe page", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    runtime = await createStage1WebTestRuntime();
    await seedTarget(runtime, { kind: "project", token: "token-project" });
    await seedTarget(runtime, { kind: "newsletter", token: "token-news" });
    await seedTarget(runtime, {
      kind: "newsletter",
      token: "token-news-null-contact",
      contactId: null,
      newsletterSubscriberId: "newsletter-subscriber-1",
    });
    // CSV-imported project recipient: project send, no contact, frozen email.
    await seedTarget(runtime, {
      kind: "project",
      token: "token-project-csv",
      contactId: null,
    });
    // Org-sender CSV recipient: newsletter-kind send, but no contact AND no
    // newsletter subscriber — a one-off uploaded email, not a subscriber.
    await seedTarget(runtime, {
      kind: "newsletter",
      token: "token-org-csv",
      contactId: null,
      newsletterSubscriberId: null,
    });
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("GET renders a pending confirmation page without recording an opt-out", async () => {
    const page = await UnsubscribeTokenPage({
      params: Promise.resolve({ token: "token-project" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Unsubscribe from Forests emails?");
    expect(html).toContain("Confirm unsubscribe");
    expect(html).toContain("taylor@example.org");
    expect(html).toContain('action="/u/token-project/confirm"');
    if (!runtime) {
      throw new Error("runtime not initialized");
    }
    const campaigns = (await getStage1WebRuntime()).campaigns;
    const consentRows = await campaigns.contactConsent.listForContact(
      "contact-unsubscribe",
    );
    expect(consentRows).toHaveLength(0);
  });

  it("POST records the scope-specific opt-out and redirects with ?confirmed=1", async () => {
    const response = await unsubscribePost(
      new Request("http://localhost/u/token-project/confirm", { method: "POST" }),
      { params: Promise.resolve({ token: "token-project" }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost/u/token-project?confirmed=1",
    );
    if (!runtime) {
      throw new Error("runtime not initialized");
    }
    const campaigns = (await getStage1WebRuntime()).campaigns;
    const consentRows = await campaigns.contactConsent.listForContact(
      "contact-unsubscribe",
    );
    expect(consentRows).toHaveLength(1);
    expect(consentRows[0]).toMatchObject({
      scopeType: "project",
      scopeId: "project-host",
      source: "recipient_click",
      sourceRunId: "run-token-project",
    });
  });

  it("GET with ?confirmed=1 renders the success page", async () => {
    const page = await UnsubscribeTokenPage({
      params: Promise.resolve({ token: "token-project" }),
      searchParams: Promise.resolve({ confirmed: "1" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("You&#x27;ve been unsubscribed from Forests emails.");
    expect(html).toContain("taylor@example.org");
  });

  it("renders a valid project unsubscribe page for a no-contact (CSV) recipient", async () => {
    const page = await UnsubscribeTokenPage({
      params: Promise.resolve({ token: "token-project-csv" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    // Not the "invalid link" page — a working confirm page.
    expect(html).toContain("Unsubscribe from Forests emails?");
    expect(html).toContain("Confirm unsubscribe");
    expect(html).toContain(
      'action="/u/token-project-csv/confirm"',
    );
  });

  it("POST suppresses a no-contact (CSV) recipient by email", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }
    const campaigns = (await getStage1WebRuntime()).campaigns;
    expect(
      await campaigns.suppressionList.isSuppressed(
        "taylor@example.org",
        new Date(),
      ),
    ).toBe(false);

    const response = await unsubscribePost(
      new Request("http://localhost/u/token-project-csv/confirm", {
        method: "POST",
      }),
      { params: Promise.resolve({ token: "token-project-csv" }) },
    );

    expect(response.status).toBe(303);
    expect(
      await campaigns.suppressionList.isSuppressed(
        "taylor@example.org",
        new Date(),
      ),
    ).toBe(true);
  });

  it("POST suppresses an org-sender CSV recipient (newsletter-kind, no subscriber) via the suppression list, not newsletter suppressions", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }
    const campaigns = (await getStage1WebRuntime()).campaigns;

    const response = await unsubscribePost(
      new Request("http://localhost/u/token-org-csv/confirm", {
        method: "POST",
      }),
      { params: Promise.resolve({ token: "token-org-csv" }) },
    );

    expect(response.status).toBe(303);
    // Suppressed via the general suppression list (which CSV sends honor).
    expect(
      await campaigns.suppressionList.isSuppressed(
        "taylor@example.org",
        new Date(),
      ),
    ).toBe(true);
    // NOT added to newsletter suppressions (they didn't leave the newsletter).
    expect(
      await campaigns.newsletterSuppressions.findByEmail("taylor@example.org"),
    ).toBeNull();
  });

  it("loads a valid newsletter page model for a null-contact recipient", async () => {
    const page = await UnsubscribeTokenPage({
      params: Promise.resolve({ token: "token-news-null-contact" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Unsubscribe from the AS newsletter?");
    expect(html).toContain("Confirm unsubscribe");
    expect(html).toContain('action="/u/token-news-null-contact/confirm"');
  });

  it("GET does not record an opt-out for link prefetchers (regression test)", async () => {
    // Simulates Outlook/Gmail link scanners that load the URL.
    // This test is the load-bearing assertion for the GET-unsubscribe
    // fix — link scanners must not be able to silently opt anyone out.
    for (let pass = 0; pass < 3; pass += 1) {
      await UnsubscribeTokenPage({
        params: Promise.resolve({ token: "token-project" }),
        searchParams: Promise.resolve({}),
      });
    }
    if (!runtime) {
      throw new Error("runtime not initialized");
    }
    const campaigns = (await getStage1WebRuntime()).campaigns;
    const consentRows = await campaigns.contactConsent.listForContact(
      "contact-unsubscribe",
    );
    expect(consentRows).toHaveLength(0);
  });

  it("renders a friendly error page for an invalid token", async () => {
    const page = await UnsubscribeTokenPage({
      params: Promise.resolve({ token: "missing-token" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("We couldn&#x27;t find this unsubscribe link.");
    expect(html).toContain("info@adventurescientists.org");
  });

  it("renders a valid confirm page for a non-newsletter null-contact target", async () => {
    const webRuntime = await getStage1WebRuntime();
    const originalFindSnapshot =
      webRuntime.campaigns.audienceSnapshots.findByUnsubscribeToken.bind(
        webRuntime.campaigns.audienceSnapshots,
      );
    const originalFindRun =
      webRuntime.campaigns.campaignRuns.findById.bind(
        webRuntime.campaigns.campaignRuns,
      );
    const originalFindProject = webRuntime.settings.projects.findById.bind(
      webRuntime.settings.projects,
    );

    webRuntime.campaigns.audienceSnapshots.findByUnsubscribeToken = () =>
      Promise.resolve({
        id: "snapshot-project-null-contact",
        campaignRunId: "run-project-null-contact",
        contactId: null,
        newsletterSubscriberId: null,
        frozenEmail: "taylor@example.org",
        frozenFirstName: "Taylor",
        frozenProjectName: "Forests",
        frozenProjectId: "project-host",
        frozenAliasEmail: "forests@adventurescientists.org",
        unsubscribeToken: "token-project-csv",
        deliveryStatus: "sent",
        providerMessageId: "provider-project-null-contact",
        subjectVariant: null,
        sentAt: null,
        deliveredAt: null,
        bouncedAt: null,
        openedAt: null,
        clickedAt: null,
        complainedAt: null,
        unsubscribedAt: null,
        lastEventAt: null,
        createdAt: "2026-05-15T12:00:00.000Z",
      });
    webRuntime.campaigns.campaignRuns.findById = () =>
      Promise.resolve({
        id: "run-project-null-contact",
        kind: "project",
        launchType: "normal_email",
        state: "scheduled",
        projectId: "project-host",
        name: null,
        fromEmail: "forests@adventurescientists.org",
        fromName: "Adventure Scientists",
        replyToEmail: "forests@adventurescientists.org",
        subjectTemplate: "Hello",
        subjectTemplateB: null,
        abTestEnabled: false,
        bodyHtmlTemplate: "<p>Hello</p>",
        bodyTextTemplate: "Hello",
        bodyDesignJson: null,
        preheader: null,
        audienceCriteria: {
          projectId: "project-host",
          projectIds: ["project-host"],
          statuses: [],
          contactIds: [],
          newsletterSubscriberIds: [],
          expeditionIds: [],
          lastActivityWindow: "all_time",
          hasReplied: "either",
          hasClicked: "either",
        },
        audienceSize: 1,
        scheduledAt: null,
        startedAt: null,
        completedAt: null,
        finalizedAt: null,
        cancelledAt: null,
        cancelledReason: null,
        createdByUserId: null,
        lastEditedByUserId: null,
        createdAt: "2026-05-15T12:00:00.000Z",
        updatedAt: "2026-05-15T12:00:00.000Z",
      });
    webRuntime.settings.projects.findById = (() =>
      Promise.resolve({
        projectId: "project-host",
        projectName: "Forests",
        projectAlias: "forests",
        connectedToProjectId: null,
        source: "manual",
        isActive: true,
        aiKnowledgeUrl: null,
        aiKnowledgeSyncedAt: null,
        aiKnowledgeSources: [],
        aiOperatingContext: "",
        aiAutoSyncSchedule: "never",
        aiOptimizedSynthesizedAt: null,
        aiOptimizedInputHash: null,
      })) as unknown as typeof webRuntime.settings.projects.findById;

    const model = await loadUnsubscribePageModel({
      runtime: webRuntime,
      token: "token-project-csv",
      requestedAllBanner: false,
      confirmed: false,
    });

    webRuntime.campaigns.audienceSnapshots.findByUnsubscribeToken =
      originalFindSnapshot;
    webRuntime.campaigns.campaignRuns.findById = originalFindRun;
    webRuntime.settings.projects.findById = originalFindProject;

    expect(model.state).toBe("pending");
    expect(model.variant).toBe("project");
  });

  it("renders the same success state for an already-unsubscribed token", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }
    const campaigns = (await getStage1WebRuntime()).campaigns;
    await campaigns.contactConsent.recordOptOut(
      "contact-unsubscribe",
      { type: "project", id: "project-host" },
      "provider_event",
      "run-token-project",
    );

    const page = await UnsubscribeTokenPage({
      params: Promise.resolve({ token: "token-project" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("You&#x27;ve been unsubscribed from Forests emails.");
    const consentRows = await campaigns.contactConsent.listForContact(
      "contact-unsubscribe",
    );
    expect(consentRows).toHaveLength(1);
  });

  it("records an all-scope opt-out via the POST handler and redirects back with the banner state", async () => {
    const response = await unsubscribeAllPost(
      new Request("http://localhost/u/token-project/all", { method: "POST" }),
      { params: Promise.resolve({ token: "token-project" }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost/u/token-project?all=1",
    );
    if (!runtime) {
      throw new Error("runtime not initialized");
    }
    const campaigns = (await getStage1WebRuntime()).campaigns;
    const consentRows = await campaigns.contactConsent.listForContact(
      "contact-unsubscribe",
    );
    expect(consentRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scopeType: "all",
          scopeId: null,
          source: "recipient_click",
          sourceRunId: "run-token-project",
        }),
      ]),
    );
  });

  it("writes a newsletter suppression for a null-contact newsletter confirm click", async () => {
    const response = await unsubscribePost(
      new Request("http://localhost/u/token-news-null-contact/confirm", {
        method: "POST",
      }),
      { params: Promise.resolve({ token: "token-news-null-contact" }) },
    );

    expect(response.status).toBe(303);
    const campaigns = (await getStage1WebRuntime()).campaigns;
    const suppression = await campaigns.newsletterSuppressions.findByEmail(
      "taylor@example.org",
    );

    expect(suppression).toMatchObject({
      email: "taylor@example.org",
      reason: "platform_optout",
      source: "recipient_click",
    });

    await unsubscribePost(
      new Request("http://localhost/u/token-news-null-contact/confirm", {
        method: "POST",
      }),
      { params: Promise.resolve({ token: "token-news-null-contact" }) },
    );

    expect(
      await campaigns.newsletterSuppressions.findByEmail("taylor@example.org"),
    ).toMatchObject({
      email: "taylor@example.org",
      reason: "platform_optout",
      source: "recipient_click",
    });
  });

  it("writes a newsletter suppression for a null-contact newsletter all click", async () => {
    const response = await unsubscribeAllPost(
      new Request("http://localhost/u/token-news-null-contact/all", {
        method: "POST",
      }),
      { params: Promise.resolve({ token: "token-news-null-contact" }) },
    );

    expect(response.status).toBe(303);
    const campaigns = (await getStage1WebRuntime()).campaigns;

    expect(
      await campaigns.newsletterSuppressions.findByEmail("taylor@example.org"),
    ).toMatchObject({
      email: "taylor@example.org",
      reason: "platform_optout",
      source: "recipient_click",
    });
  });

  it("matches the project snapshot", () => {
    const html = renderModel({
      state: "success",
      token: "token-project",
      variant: "project",
      headline: "You've been unsubscribed from Forests emails.",
      body:
        "You won't receive any more broadcast emails from this project. Your project-team correspondence — replies to direct conversations, trip logistics, gear pickups — will keep flowing as usual.",
      email: "taylor@example.org",
      ctaPrompt:
        "Want to unsubscribe from all Adventure Scientists emails instead?",
      ctaLabel: "Unsubscribe from all AS emails →",
      showAllBanner: false,
      showAllCta: true,
      footerAddress: "123 Research Way • Bozeman, MT, 59715 • USA",
    });

    expect(html).toMatchSnapshot();
  });

  it("matches the newsletter snapshot", () => {
    const html = renderModel({
      state: "success",
      token: "token-news",
      variant: "newsletter",
      headline: "You've been unsubscribed from the AS newsletter.",
      body:
        "You won't receive the monthly Adventure Scientists newsletter anymore. If you're an active volunteer, project-specific emails will keep coming.",
      email: "taylor@example.org",
      ctaPrompt:
        "Want to stop every Adventure Scientists email — project updates included?",
      ctaLabel: "Unsubscribe from all AS emails →",
      showAllBanner: false,
      showAllCta: true,
      footerAddress: "123 Research Way • Bozeman, MT, 59715 • USA",
    });

    expect(html).toMatchSnapshot();
  });

  it("matches the all-opt-out banner snapshot", () => {
    const html = renderModel({
      state: "success",
      token: "token-project",
      variant: "project",
      headline: "You've been unsubscribed from Forests emails.",
      body:
        "You won't receive any more broadcast emails from this project. Your project-team correspondence — replies to direct conversations, trip logistics, gear pickups — will keep flowing as usual.",
      email: "taylor@example.org",
      ctaPrompt:
        "Want to unsubscribe from all Adventure Scientists emails instead?",
      ctaLabel: "Unsubscribe from all AS emails →",
      showAllBanner: true,
      showAllCta: false,
      footerAddress: "123 Research Way • Bozeman, MT, 59715 • USA",
    });

    expect(html).toMatchSnapshot();
  });
});
