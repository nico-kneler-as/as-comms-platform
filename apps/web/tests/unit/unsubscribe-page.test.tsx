import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as unsubscribeAllPost } from "../../app/u/[token]/all/route";
import { POST as unsubscribePost } from "../../app/u/[token]/confirm/route";
import UnsubscribeTokenPage from "../../app/u/[token]/page";
import { UnsubscribePageView } from "../../app/u/[token]/_components/unsubscribe-page-view";
import type { UnsubscribePageModel } from "../../app/u/[token]/_lib/unsubscribe";
import { getStage1WebRuntime } from "../../src/server/stage1-runtime";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

Object.assign(globalThis, { React });

async function seedTarget(
  runtime: Stage1WebTestRuntime,
  input: { readonly kind: "project" | "newsletter"; readonly token: string },
) {
  const campaigns = (await getStage1WebRuntime()).campaigns;

  await runtime.context.repositories.contacts.upsert({
    id: "contact-unsubscribe",
    salesforceContactId: null,
    displayName: "Taylor Recipient",
    primaryEmail: "taylor@example.org",
    primaryPhone: null,
    createdAt: "2026-05-15T12:00:00.000Z",
    updatedAt: "2026-05-15T12:00:00.000Z",
  });

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
    id: `run-${input.kind}`,
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
      id: `snapshot-${input.kind}`,
      contactId: "contact-unsubscribe",
      newsletterSubscriberId: null,
      frozenEmail: "taylor@example.org",
      frozenFirstName: "Taylor",
      frozenProjectName:
        input.kind === "project" ? "Beech Leaf Disease" : null,
      frozenProjectId: input.kind === "project" ? "project-sub" : null,
      frozenAliasEmail: "forests@adventurescientists.org",
      unsubscribeToken: input.token,
      deliveryStatus: "sent",
      providerMessageId: `${input.kind}-message-id`,
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
      sourceRunId: "run-project",
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

  it("renders the same success state for an already-unsubscribed token", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }
    const campaigns = (await getStage1WebRuntime()).campaigns;
    await campaigns.contactConsent.recordOptOut(
      "contact-unsubscribe",
      { type: "project", id: "project-host" },
      "provider_event",
      "run-project",
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
          sourceRunId: "run-project",
        }),
      ]),
    );
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
