import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

Object.assign(globalThis, { React });
process.env.TZ = "UTC";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => undefined,
    refresh: () => undefined,
  }),
}));

vi.mock("lucide-react", () => ({
  AlertCircle: () => null,
  Archive: () => null,
  ArrowDownLeft: () => null,
  ArrowUpRight: () => null,
  Calendar: () => null,
  Check: () => null,
  CheckCheck: () => null,
  ChevronRight: () => null,
  Copy: () => null,
  CornerUpLeft: () => null,
  Eye: () => null,
  Flag: () => null,
  MousePointerClick: () => null,
  Pencil: () => null,
  Send: () => null,
  Users: () => null,
  X: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { readonly children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { readonly children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogContent: ({ children }: { readonly children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { readonly children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { readonly children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { readonly children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { readonly children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/progress", () => ({
  Progress: ({ value }: { readonly value?: number }) => (
    <div data-progress={value} />
  ),
}));

vi.mock("../../app/broadcasts/actions", () => ({
  cancel: () => Promise.resolve({ ok: true, data: {}, requestId: "req" }),
  duplicateCampaignRun: () =>
    Promise.resolve({
      ok: true,
      data: { runId: "dup" },
      requestId: "req",
    }),
  publishBroadcastWebVersionNow: () =>
    Promise.resolve({ ok: true, data: { url: "https://example.org/b/token" }, requestId: "req" }),
  setBroadcastWebVersionPublished: () =>
    Promise.resolve({ ok: true, data: { url: "https://example.org/b/token" }, requestId: "req" }),
  listCampaignRecipients: () =>
    Promise.resolve({
      ok: true,
      data: { rows: [], total: 0 },
      requestId: "req",
    }),
}));

import type {
  RunDetailHeaderModel,
  RunDetailModel,
} from "../../app/broadcasts/[runId]/_lib/run-detail";
import {
  getRunDetailHeaderModel,
  getRunDetailModel,
} from "../../app/broadcasts/[runId]/_lib/run-detail";
import { MetricTiles } from "../../app/broadcasts/[runId]/_components/metric-tiles";
import { RecipientsTable } from "../../app/broadcasts/[runId]/_components/recipients-table";
import { RepliesInInboxPanel } from "../../app/broadcasts/[runId]/_components/replies-in-inbox-panel";
import { RunAuditLog } from "../../app/broadcasts/[runId]/_components/run-audit-log";
import { WebVersionPanel } from "../../app/broadcasts/[runId]/_components/web-version-panel";
import {
  AudienceCriteriaPanel,
  BotActivityPanel,
  EmailContentPanel,
  LinkClicksPanel,
  SendDetailsPanel,
  SubjectVariantBreakdownPanel,
} from "../../app/broadcasts/[runId]/_components/run-detail-panels";
import { RunDetailShell } from "../../app/broadcasts/[runId]/_components/run-detail-shell";
import {
  createStage1WebTestRuntime,
  insertBroadcastLinkClickForTests,
  insertBroadcastOpenForTests,
  upsertNewsletterSubscriberForTests,
} from "../../src/server/stage1-runtime.test-support";

function buildPostmarkModel(
  state: RunDetailModel["run"]["state"],
  overrides: {
    readonly botActivity?: RunDetailModel["botActivity"];
    readonly linkClicks?: RunDetailModel["linkClicks"];
    readonly subjectVariantBreakdown?: RunDetailModel["subjectVariantBreakdown"];
    readonly webVersion?: RunDetailModel["webVersion"];
    readonly run?: Partial<RunDetailModel["run"]>;
  } = {},
): RunDetailModel {
  const run: RunDetailModel["run"] = {
    id: `run-${state}`,
    kind: "project",
    launchType: "normal_email",
    state,
    projectId: "project-1",
    name: null,
    fromEmail: "forests@adventurescientists.org",
    fromName: "Adventure Scientists",
    replyToEmail: "forests@adventurescientists.org",
    subjectTemplate: `Broadcast ${state}`,
    subjectTemplateB: null,
    abTestEnabled: false,
    bodyHtmlTemplate: "<p>Hello</p>",
    bodyDesignJson: null,
    bodyTextTemplate: "Hello",
    preheader: "Important update",
    audienceCriteria: {
      projectId: "project-1",
      projectIds: ["project-1"],
      statuses: ["Waitlist"],
      contactIds: [],
      newsletterSubscriberIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    audienceSize: 3,
    scheduledAt: "2026-05-15T12:00:00.000Z",
    startedAt:
      state === "sending" || state === "complete" || state === "finalized"
        ? "2026-05-15T12:05:00.000Z"
        : null,
    completedAt:
      state === "complete" || state === "finalized"
        ? "2026-05-15T12:12:00.000Z"
        : null,
    finalizedAt: state === "finalized" ? "2026-06-15T12:12:00.000Z" : null,
    cancelledAt: state === "cancelled" ? "2026-05-15T12:08:00.000Z" : null,
    cancelledReason: state === "cancelled" ? "operator_cancelled" : null,
    createdByUserId: "user-1",
    lastEditedByUserId: "user-1",
    createdAt: "2026-05-15T12:00:00.000Z",
    updatedAt: "2026-05-15T12:12:00.000Z",
    ...overrides.run,
  };

  return {
    provider: "postmark",
    channel: "email",
    run,
    totalAudience: 3,
    senderAlias: "forests@adventurescientists.org",
    kindLabel: "Project",
    dateLabel: "Scheduled",
    dateIso: "2026-05-15T12:00:00.000Z",
    metrics: [
      {
        key: "queued",
        label: "Queued",
        value: state === "draft" ? 3 : 1,
        percentage: 33.3,
        subtitle: null,
      },
      {
        key: "sent",
        label: "Sent",
        value: state === "draft" ? 0 : 2,
        percentage: 66.7,
        subtitle: null,
      },
      {
        key: "delivered",
        label: "Delivered",
        value: state === "draft" ? 0 : 2,
        percentage: 66.7,
        subtitle: "Postmark confirms",
      },
      {
        key: "opened",
        label: "Opened",
        value: state === "draft" ? 0 : 1,
        percentage: 33.3,
        subtitle: null,
      },
      {
        key: "clicked",
        label: "Clicked",
        value: 0,
        percentage: 0,
        subtitle: null,
      },
      {
        key: "bounced",
        label: "Bounced",
        value: 0,
        percentage: 0,
        subtitle: null,
      },
      {
        key: "unsubscribed",
        label: "Unsubscribed",
        value: 0,
        percentage: 0,
        subtitle: null,
      },
      {
        key: "complained",
        label: "Complained",
        value: 0,
        percentage: 0,
        subtitle: null,
      },
    ],
    sentCount: state === "draft" ? 0 : 2,
    queuedCount: state === "draft" ? 3 : 1,
    progressPercent: state === "draft" ? 0 : 67,
    estimatedMinutesRemaining: state === "sending" ? 2 : null,
    recipients: [
      {
        snapshotId: "snapshot-1",
        contactId: "contact-1",
        name: "Taylor",
        email: "taylor@example.org",
        phone: null,
        project: "Forests",
        latestState: "opened",
        latestStateLabel: "Opened",
        lastEventAt: "2026-05-15T12:07:00.000Z",
      },
    ],
    recipientTotal: 1,
    repliesCount: 1,
    recentReplies: [
      {
        contactId: "contact-1",
        contactName: "Taylor",
        email: "taylor@example.org",
        occurredAt: "2026-05-15T13:00:00.000Z",
      },
    ],
    inboxRecipientsHref: "/inbox",
    auditEntries: [
      {
        id: "audit-1",
        action: "campaign_run.created",
        occurredAt: "2026-05-15T12:00:00.000Z",
        actorLabel: "Operator",
        detail: "Draft created.",
      },
    ],
    botActivity:
      overrides.botActivity ?? {
        opens: {
          human: state === "draft" ? 0 : 1,
          bot: 0,
          hasEventData: true,
        },
        clicks: {
          human: 0,
          bot: 0,
          hasEventData: false,
        },
      },
    linkClicks:
      overrides.linkClicks ??
      [
        {
          url: "https://example.org/a",
          totalClicks: 4,
          botClicks: 1,
          uniqueClickers: 2,
        },
        {
          url: "https://example.org/b",
          totalClicks: 2,
          botClicks: 0,
          uniqueClickers: 1,
        },
      ],
    subjectVariantBreakdown: overrides.subjectVariantBreakdown ?? null,
    audienceCriteria: {
      projectIds: ["project-1"],
      statuses: ["Waitlist"],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    canStopUnsent: state === "sending" || state === "scheduled",
    canDuplicate:
      state === "complete" || state === "cancelled" || state === "finalized",
    isAdmin: true,
    webVersion: overrides.webVersion ?? null,
  };
}

function buildMailchimpModel(): RunDetailModel {
  return {
    provider: "mailchimp",
    channel: "email",
    run: {
      id: "mailchimp-run-1",
      kind: "newsletter",
      launchType: "normal_email",
      state: "complete",
      projectId: null,
      name: "April newsletter",
      fromEmail: null,
      fromName: null,
      replyToEmail: null,
      subjectTemplate: "April newsletter",
      subjectTemplateB: null,
      abTestEnabled: false,
      bodyHtmlTemplate: null,
      bodyDesignJson: null,
      bodyTextTemplate: null,
      preheader: null,
      audienceCriteria: {
        projectId: null,
        projectIds: [],
        statuses: [],
        contactIds: [],
        newsletterSubscriberIds: [],
        expeditionIds: [],
        lastActivityWindow: "all_time",
        hasReplied: "either",
        hasClicked: "either",
      },
      audienceSize: 2,
      scheduledAt: null,
      startedAt: "2026-04-10T12:00:00.000Z",
      completedAt: "2026-04-10T12:15:00.000Z",
      finalizedAt: null,
      cancelledAt: null,
      cancelledReason: null,
      createdByUserId: null,
      lastEditedByUserId: null,
      createdAt: "2026-05-15T12:00:00.000Z",
      updatedAt: "2026-05-15T12:00:00.000Z",
    },
    totalAudience: 2,
    senderAlias: "Mailchimp",
    kindLabel: "Newsletter",
    dateLabel: "Completed",
    dateIso: "2026-04-10T12:15:00.000Z",
    metrics: [
      { key: "queued", label: "Queued", value: 2, percentage: 100, subtitle: null },
      { key: "sent", label: "Sent", value: 2, percentage: 100, subtitle: null },
      { key: "delivered", label: "Delivered", value: 1, percentage: 50, subtitle: null },
      { key: "opened", label: "Opened", value: 1, percentage: 50, subtitle: null },
      { key: "clicked", label: "Clicked", value: 0, percentage: 0, subtitle: null },
      { key: "bounced", label: "Bounced", value: 1, percentage: 50, subtitle: null },
      {
        key: "unsubscribed",
        label: "Unsubscribed",
        value: 1,
        percentage: 50,
        subtitle: null,
      },
      {
        key: "complained",
        label: "Complained",
        value: 0,
        percentage: 0,
        subtitle: "Not tracked for Mailchimp imports",
      },
    ],
    sentCount: 2,
    queuedCount: 2,
    progressPercent: 100,
    estimatedMinutesRemaining: null,
    recipients: [
      {
        snapshotId: "member-1",
        contactId: null,
        name: "member-1",
        email: null,
        phone: null,
        project: null,
        latestState: "opened",
        latestStateLabel: "Opened",
        lastEventAt: "2026-05-15T12:07:00.000Z",
      },
    ],
    recipientTotal: 1,
    repliesCount: 0,
    recentReplies: [],
    inboxRecipientsHref: "/inbox",
    auditEntries: [],
    botActivity: {
      opens: { human: 0, bot: 0, hasEventData: false },
      clicks: { human: 0, bot: 0, hasEventData: false },
    },
    webVersion: null,
    linkClicks: [],
    subjectVariantBreakdown: null,
    audienceCriteria: {
      projectIds: [],
      statuses: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    canStopUnsent: false,
    canDuplicate: false,
    isAdmin: true,
  };
}

function buildSmsModel(
  state: RunDetailModel["run"]["state"] = "complete",
): RunDetailModel {
  return {
    provider: "sms",
    channel: "sms",
    run: {
      id: "sms-run-1",
      kind: "project",
      launchType: "sms",
      state,
      projectId: "project-1",
      name: "Trailhead reminder",
      fromEmail: null,
      fromName: null,
      replyToEmail: null,
      subjectTemplate: null,
      subjectTemplateB: null,
      abTestEnabled: false,
      bodyHtmlTemplate: null,
      bodyDesignJson: null,
      bodyTextTemplate: "Meet at the trailhead at 7:30 AM.",
      preheader: null,
      audienceCriteria: {
        projectId: "project-1",
        projectIds: ["project-1"],
        statuses: [],
        contactIds: [],
        newsletterSubscriberIds: [],
        expeditionIds: [],
        lastActivityWindow: "all_time",
        hasReplied: "either",
        hasClicked: "either",
      },
      audienceSize: 6,
      scheduledAt: null,
      startedAt: "2026-07-10T12:00:00.000Z",
      completedAt: "2026-07-10T12:10:00.000Z",
      finalizedAt: null,
      cancelledAt: null,
      cancelledReason: null,
      createdByUserId: null,
      lastEditedByUserId: null,
      createdAt: "2026-07-10T11:55:00.000Z",
      updatedAt: "2026-07-10T12:10:00.000Z",
    },
    totalAudience: 6,
    senderAlias: null,
    kindLabel: "Project",
    dateLabel: "Completed",
    dateIso: "2026-07-10T12:10:00.000Z",
    metrics: [
      { key: "queued", label: "Queued", value: 1, percentage: 16.7, subtitle: null },
      {
        key: "sent",
        label: "Sent",
        value: 3,
        percentage: 50,
        subtitle: "Accepted by Twilio",
      },
      {
        key: "delivered",
        label: "Delivered",
        value: 2,
        percentage: 33.3,
        subtitle: null,
      },
      { key: "failed", label: "Failed", value: 1, percentage: 16.7, subtitle: null },
      {
        key: "suppressed",
        label: "Suppressed",
        value: 1,
        percentage: 16.7,
        subtitle: null,
      },
      { key: "replied", label: "Replied", value: 1, percentage: 16.7, subtitle: null },
    ],
    sentCount: 3,
    queuedCount: 1,
    progressPercent: 50,
    estimatedMinutesRemaining: null,
    recipients: [
      {
        snapshotId: "sms-1",
        contactId: "contact-1",
        name: "Taylor",
        email: null,
        phone: "+15555550123",
        project: null,
        latestState: "delivered",
        latestStateLabel: "Delivered",
        lastEventAt: "2026-07-10T12:01:00.000Z",
      },
    ],
    recipientTotal: 1,
    repliesCount: 1,
    recentReplies: [
      {
        contactId: "contact-1",
        contactName: "Taylor",
        email: "+15555550123",
        occurredAt: "2026-07-10T12:20:00.000Z",
      },
    ],
    inboxRecipientsHref: "/inbox",
    auditEntries: [],
    botActivity: {
      opens: { human: 0, bot: 0, hasEventData: false },
      clicks: { human: 0, bot: 0, hasEventData: false },
    },
    linkClicks: [],
    subjectVariantBreakdown: null,
    audienceCriteria: {
      projectIds: ["project-1"],
      statuses: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    canStopUnsent: false,
    canDuplicate: true,
    isAdmin: true,
    webVersion: null,
  };
}

function buildHeader(model: RunDetailModel): RunDetailHeaderModel {
  const subjectTemplate = model.run.subjectTemplate?.trim() ?? "";
  const runName = model.run.name?.trim() ?? "";

  return {
    runId: model.run.id,
    state: model.run.state,
    subject:
      subjectTemplate.length > 0
        ? subjectTemplate
        : runName.length > 0
          ? runName
          : "Untitled broadcast",
    preheader: model.run.preheader,
    senderAlias: model.senderAlias,
    kindLabel: model.kindLabel,
    dateLabel: model.dateLabel,
    dateIso: model.dateIso,
    canStopUnsent: model.canStopUnsent,
    canDuplicate: model.canDuplicate,
    totalAudience: model.totalAudience,
  };
}

function renderShell(model: RunDetailModel) {
  return renderToStaticMarkup(
    <RunDetailShell
      header={buildHeader(model)}
      metricsSection={<MetricTiles model={model} />}
      emailContentSection={
        <>
          <EmailContentPanel model={model} />
          <SubjectVariantBreakdownPanel model={model} />
          <BotActivityPanel model={model} />
          <LinkClicksPanel model={model} />
        </>
      }
      recipientsSection={
        <RecipientsTable
          runId={model.run.id}
          provider={model.provider}
          rows={model.recipients}
          total={model.recipientTotal}
        />
      }
      rightRailSection={
        <>
          <RepliesInInboxPanel
            repliesCount={model.repliesCount}
            recentReplies={model.recentReplies}
            href={model.inboxRecipientsHref}
            {...(model.provider === "mailchimp"
              ? {
                  subtitle: "0 replies tracked.",
                  emptyMessage:
                    "Reply tracking is not available for historical Mailchimp imports; replies to those campaigns went into Mailchimp's reply tracking.",
            }
          : {})}
            showInboxLink={model.provider !== "mailchimp"}
          />
          <SendDetailsPanel model={model} />
          <AudienceCriteriaPanel model={model} />
          {model.provider === "mailchimp" ? null : (
            <RunAuditLog entries={model.auditEntries} />
          )}
        </>
      }
    />,
  );
}

async function seedProjectForRunTests(
  runtime: Awaited<ReturnType<typeof createStage1WebTestRuntime>>,
  projectId = "project-1",
) {
  await runtime.context.repositories.projectDimensions.upsert({
    projectId,
    projectName: "Project One",
    projectAlias: "project-one",
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
}

async function seedContactForRunTests(
  runtime: Awaited<ReturnType<typeof createStage1WebTestRuntime>>,
  input: {
    readonly id: string;
    readonly name: string;
    readonly email?: string | null;
    readonly phone?: string | null;
  },
) {
  await runtime.context.repositories.contacts.upsert({
    id: input.id,
    salesforceContactId: null,
    displayName: input.name,
    primaryEmail: input.email ?? null,
    primaryPhone: input.phone ?? null,
    createdAt: "2026-07-10T12:00:00.000Z",
    updatedAt: "2026-07-10T12:00:00.000Z",
  });
}

async function seedSmsSenderForRunTests(
  runtime: Awaited<ReturnType<typeof createStage1WebTestRuntime>>,
) {
  await runtime.context.db.execute(sql`
    insert into sms_senders (
      id,
      phone_e164,
      display_name,
      is_active,
      created_at,
      updated_at
    )
    values (
      'sender-sms-1',
      '+15555550999',
      'Primary SMS Sender',
      true,
      '2026-07-10T12:00:00.000Z'::timestamptz,
      '2026-07-10T12:00:00.000Z'::timestamptz
    )
  `);
}

describe("broadcast run detail", () => {
  it("reports web-version state without ever minting a token for a run", async () => {
    const runtime = await createStage1WebTestRuntime();

    try {
      const campaigns = runtime.runtime.campaigns;
      await seedProjectForRunTests(runtime);
      const run = await campaigns.campaignRuns.create({
        id: "run-detail-web-version",
        kind: "project",
        launchType: "html_email",
        projectId: "project-1",
        name: null,
        fromEmail: "project-one@adventurescientists.org",
        fromName: "Adventure Scientists",
        replyToEmail: "project-one@adventurescientists.org",
        subjectTemplate: "Field update",
        subjectTemplateB: null,
        abTestEnabled: false,
        bodyHtmlTemplate: "<p>Hello</p>",
        bodyTextTemplate: "Hello",
        bodyDesignJson: null,
        preheader: null,
        audienceCriteria: {
          projectId: "project-1",
          projectIds: ["project-1"],
          statuses: [],
          contactIds: [],
          newsletterSubscriberIds: [],
          expeditionIds: [],
          lastActivityWindow: "all_time",
          hasReplied: "either",
          hasClicked: "either",
        },
        audienceSize: 0,
        createdByUserId: null,
        lastEditedByUserId: null,
      });

      const withoutRow = await getRunDetailModel({
        runId: run.id,
        provider: "postmark",
        isAdmin: true,
      });
      expect(withoutRow?.webVersion).toMatchObject({
        state: "none",
        url: null,
        canPublish: false,
      });
      // Loading the page must not create a public token for a run that has
      // not sent — otherwise every draft view would mint one.
      await expect(
        campaigns.broadcastWebVersions.findByRunId(run.id),
      ).resolves.toBeNull();

      const version = await campaigns.broadcastWebVersions.ensure(run.id);
      const pending = await getRunDetailModel({
        runId: run.id,
        provider: "postmark",
        isAdmin: true,
      });
      expect(pending?.webVersion?.state).toBe("pending");
      expect(pending?.webVersion?.url).toContain(`/b/${version.publicToken}`);

      await campaigns.broadcastWebVersions.storeRendered(run.id, {
        html: "<p>Rendered</p>",
        title: "Field update",
      });
      const published = await getRunDetailModel({
        runId: run.id,
        provider: "postmark",
        isAdmin: true,
      });
      expect(published?.webVersion?.state).toBe("published");
      expect(published?.webVersion?.renderedAt).not.toBeNull();

      await campaigns.broadcastWebVersions.setPublished(run.id, {
        published: false,
        userId: null,
      });
      const unpublished = await getRunDetailModel({
        runId: run.id,
        provider: "postmark",
        isAdmin: true,
      });
      expect(unpublished?.webVersion?.state).toBe("unpublished");

      // A plain typed email is not eligible for a public page, so the panel is
      // absent rather than showing a dead publish button.
      const plainRun = await campaigns.campaignRuns.create({
        id: "run-detail-plain-email",
        kind: "project",
        launchType: "normal_email",
        projectId: "project-1",
        name: null,
        fromEmail: "project-one@adventurescientists.org",
        fromName: "Adventure Scientists",
        replyToEmail: "project-one@adventurescientists.org",
        subjectTemplate: "Meet at the trailhead",
        subjectTemplateB: null,
        abTestEnabled: false,
        bodyHtmlTemplate: "<p>Hello</p>",
        bodyTextTemplate: "Hello",
        bodyDesignJson: null,
        preheader: null,
        audienceCriteria: {
          projectId: "project-1",
          projectIds: ["project-1"],
          statuses: [],
          contactIds: [],
          newsletterSubscriberIds: [],
          expeditionIds: [],
          lastActivityWindow: "all_time",
          hasReplied: "either",
          hasClicked: "either",
        },
        audienceSize: 0,
        createdByUserId: null,
        lastEditedByUserId: null,
      });
      const plain = await getRunDetailModel({
        runId: plainRun.id,
        provider: "postmark",
        isAdmin: true,
      });
      expect(plain?.webVersion).toBeNull();
    } finally {
      await runtime.dispose();
    }
  });

  it("renders the expected web-version controls for each supported state", () => {
    const published = buildPostmarkModel("complete", {
      webVersion: {
        url: "https://example.org/b/published",
        state: "published",
        canPublish: false,
        renderedAt: "2026-08-01T00:00:00.000Z",
      },
    });
    const pending = buildPostmarkModel("sending", {
      webVersion: {
        url: "https://example.org/b/pending",
        state: "pending",
        canPublish: false,
        renderedAt: null,
      },
    });
    const missing = buildPostmarkModel("complete", {
      webVersion: {
        url: null,
        state: "none",
        canPublish: true,
        renderedAt: null,
      },
    });

    const publishedMarkup = renderToStaticMarkup(
      <WebVersionPanel runId={published.run.id} webVersion={published.webVersion} />,
    );
    expect(publishedMarkup).toContain("Copy link");
    expect(publishedMarkup).toContain("Open");
    expect(publishedMarkup).toContain("Unpublish");

    const pendingMarkup = renderToStaticMarkup(
      <WebVersionPanel runId={pending.run.id} webVersion={pending.webVersion} />,
    );
    expect(pendingMarkup).toContain("Goes live when this broadcast sends.");
    expect(pendingMarkup).not.toContain("Unpublish");

    const missingMarkup = renderToStaticMarkup(
      <WebVersionPanel runId={missing.run.id} webVersion={missing.webVersion} />,
    );
    expect(missingMarkup).toContain("Publish web version");

    const unpublished = buildPostmarkModel("complete", {
      webVersion: {
        url: "https://example.org/b/unpublished",
        state: "unpublished",
        canPublish: false,
        renderedAt: "2026-08-01T00:00:00.000Z",
      },
    });
    const unpublishedMarkup = renderToStaticMarkup(
      <WebVersionPanel
        runId={unpublished.run.id}
        webVersion={unpublished.webVersion}
      />,
    );
    expect(unpublishedMarkup).toContain("Republish");
    expect(unpublishedMarkup).toContain("https://example.org/b/unpublished");
    expect(unpublishedMarkup).not.toContain("Copy link");
    expect(
      renderToStaticMarkup(
        <WebVersionPanel runId={published.run.id} webVersion={null} />,
      ),
    ).toBe("");
  });

  it("uses human headline counts and exposes bot activity when event data exists", async () => {
    const runtime = await createStage1WebTestRuntime();

    try {
      const { campaigns } = runtime.runtime;

      await runtime.context.repositories.projectDimensions.upsert({
        projectId: "project-1",
        projectName: "Project One",
        projectAlias: "project-one",
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

      await runtime.context.repositories.contacts.upsert({
        id: "contact-1",
        salesforceContactId: null,
        displayName: "Taylor",
        primaryEmail: "taylor@example.org",
        primaryPhone: null,
        createdAt: "2026-07-02T12:00:00.000Z",
        updatedAt: "2026-07-02T12:00:00.000Z",
      });
      await runtime.context.repositories.contacts.upsert({
        id: "contact-2",
        salesforceContactId: null,
        displayName: "Jordan",
        primaryEmail: "jordan@example.org",
        primaryPhone: null,
        createdAt: "2026-07-02T12:00:00.000Z",
        updatedAt: "2026-07-02T12:00:00.000Z",
      });
      const newsletterSubscriber = await upsertNewsletterSubscriberForTests(
        runtime,
        {
          email: "newsletter@example.org",
          firstName: "Newsletter",
          lastName: null,
          status: "subscribed",
        memberRating: null,
        optinTime: null,
        optinIp: null,
        confirmTime: null,
        confirmIp: null,
          lastChangedAt: null,
          interests: null,
          tags: null,
          source: "mailchimp_import",
        },
      );

      const run = await campaigns.campaignRuns.create({
        id: "run-detail-link-clicks",
        kind: "project",
        launchType: "normal_email",
        projectId: "project-1",
        name: null,
        fromEmail: "project-one@adventurescientists.org",
        fromName: "Adventure Scientists",
        replyToEmail: "project-one@adventurescientists.org",
        subjectTemplate: "Field update",
        subjectTemplateB: null,
        abTestEnabled: false,
        bodyHtmlTemplate: "<p>Hello</p>",
        bodyTextTemplate: "Hello",
        bodyDesignJson: null,
        preheader: null,
        audienceCriteria: {
          projectId: "project-1",
          projectIds: ["project-1"],
          statuses: [],
          contactIds: [],
          newsletterSubscriberIds: [],
          expeditionIds: [],
          lastActivityWindow: "all_time",
          hasReplied: "either",
          hasClicked: "either",
        },
        audienceSize: 3,
        createdByUserId: null,
        lastEditedByUserId: null,
      });

      await campaigns.audienceSnapshots.bulkInsert(run.id, [
        {
          id: "snapshot-contact-1",
          contactId: "contact-1",
          newsletterSubscriberId: null,
          frozenEmail: "taylor@example.org",
          frozenFirstName: "Taylor",
          frozenProjectName: "Project One",
          frozenProjectId: "project-1",
          frozenAliasEmail: "project-one@adventurescientists.org",
          unsubscribeToken: "token-contact-1",
          deliveryStatus: "sent",
          providerMessageId: "pm-contact-1",
          openedAt: "2026-07-02T12:40:00.000Z",
          clickedAt: "2026-07-02T12:41:00.000Z",
        },
        {
          id: "snapshot-contact-2",
          contactId: "contact-2",
          newsletterSubscriberId: null,
          frozenEmail: "jordan@example.org",
          frozenFirstName: "Jordan",
          frozenProjectName: "Project One",
          frozenProjectId: "project-1",
          frozenAliasEmail: "project-one@adventurescientists.org",
          unsubscribeToken: "token-contact-2",
          deliveryStatus: "sent",
          providerMessageId: "pm-contact-2",
          openedAt: "2026-07-02T12:42:00.000Z",
          clickedAt: "2026-07-02T12:43:00.000Z",
        },
        {
          id: "snapshot-newsletter-1",
          contactId: null,
          newsletterSubscriberId: newsletterSubscriber.id,
          frozenEmail: "newsletter@example.org",
          frozenFirstName: "Newsletter",
          frozenProjectName: "Project One",
          frozenProjectId: "project-1",
          frozenAliasEmail: "project-one@adventurescientists.org",
          unsubscribeToken: "token-newsletter-1",
          deliveryStatus: "sent",
          providerMessageId: "pm-newsletter-1",
          openedAt: "2026-07-02T12:44:00.000Z",
          clickedAt: "2026-07-02T12:45:00.000Z",
        },
      ]);

      await insertBroadcastOpenForTests(runtime, {
        id: "open-contact-1-bot",
        campaignRunId: run.id,
        audienceSnapshotId: "snapshot-contact-1",
        contactId: "contact-1",
        openedAt: "2026-07-02T13:00:00.000Z",
        userAgent: null,
        platform: "Desktop",
        client: null,
        os: null,
        geo: null,
        isBot: true,
        botReason: "fast_activity",
        idempotencyKey: "open-contact-1-bot",
        createdAt: "2026-07-02T13:00:00.000Z",
      });
      await insertBroadcastOpenForTests(runtime, {
        id: "open-contact-1-human",
        campaignRunId: run.id,
        audienceSnapshotId: "snapshot-contact-1",
        contactId: "contact-1",
        openedAt: "2026-07-02T13:01:00.000Z",
        userAgent: null,
        platform: "Desktop",
        client: null,
        os: null,
        geo: null,
        idempotencyKey: "open-contact-1-human",
        createdAt: "2026-07-02T13:01:00.000Z",
      });
      await insertBroadcastOpenForTests(runtime, {
        id: "open-contact-2-bot",
        campaignRunId: run.id,
        audienceSnapshotId: "snapshot-contact-2",
        contactId: "contact-2",
        openedAt: "2026-07-02T13:02:00.000Z",
        userAgent: null,
        platform: "Desktop",
        client: null,
        os: null,
        geo: null,
        isBot: true,
        botReason: "machine_user_agent",
        idempotencyKey: "open-contact-2-bot",
        createdAt: "2026-07-02T13:02:00.000Z",
      });
      await insertBroadcastOpenForTests(runtime, {
        id: "open-newsletter-human",
        campaignRunId: run.id,
        audienceSnapshotId: "snapshot-newsletter-1",
        contactId: null,
        openedAt: "2026-07-02T13:03:00.000Z",
        userAgent: null,
        platform: "Desktop",
        client: null,
        os: null,
        geo: null,
        idempotencyKey: "open-newsletter-human",
        createdAt: "2026-07-02T13:03:00.000Z",
      });

      await insertBroadcastLinkClickForTests(runtime, {
        id: "click-a-1",
        campaignRunId: run.id,
        audienceSnapshotId: "snapshot-contact-1",
        contactId: "contact-1",
        originalLink: "https://example.org/a",
        clickedAt: "2026-07-02T13:00:00.000Z",
        userAgent: null,
        platform: "Desktop",
        client: null,
        os: null,
        geo: null,
        idempotencyKey: "click-a-1",
        createdAt: "2026-07-02T13:00:00.000Z",
      });
      await insertBroadcastLinkClickForTests(runtime, {
        id: "click-a-2",
        campaignRunId: run.id,
        audienceSnapshotId: "snapshot-contact-1",
        contactId: "contact-1",
        originalLink: "https://example.org/a",
        clickedAt: "2026-07-02T13:01:00.000Z",
        userAgent: null,
        platform: "Desktop",
        client: null,
        os: null,
        geo: null,
        isBot: true,
        botReason: "fast_activity",
        idempotencyKey: "click-a-2",
        createdAt: "2026-07-02T13:01:00.000Z",
      });
      await insertBroadcastLinkClickForTests(runtime, {
        id: "click-a-3",
        campaignRunId: run.id,
        audienceSnapshotId: "snapshot-newsletter-1",
        contactId: null,
        originalLink: "https://example.org/a",
        clickedAt: "2026-07-02T13:02:00.000Z",
        userAgent: null,
        platform: "Desktop",
        client: null,
        os: null,
        geo: null,
        idempotencyKey: "click-a-3",
        createdAt: "2026-07-02T13:02:00.000Z",
      });
      await insertBroadcastLinkClickForTests(runtime, {
        id: "click-b-1",
        campaignRunId: run.id,
        audienceSnapshotId: "snapshot-contact-2",
        contactId: "contact-2",
        originalLink: "https://example.org/b",
        clickedAt: "2026-07-02T13:03:00.000Z",
        userAgent: null,
        platform: "Desktop",
        client: null,
        os: null,
        geo: null,
        isBot: true,
        botReason: "machine_user_agent",
        idempotencyKey: "click-b-1",
        createdAt: "2026-07-02T13:03:00.000Z",
      });

      const model = await getRunDetailModel({
        runId: run.id,
        provider: "postmark",
        isAdmin: true,
      });

      expect(model?.linkClicks).toEqual([
        {
          url: "https://example.org/a",
          totalClicks: 3,
          botClicks: 1,
          uniqueClickers: 2,
        },
        {
          url: "https://example.org/b",
          totalClicks: 1,
          botClicks: 1,
          uniqueClickers: 1,
        },
      ]);
      expect(model?.botActivity).toEqual({
        opens: {
          human: 2,
          bot: 1,
          hasEventData: true,
        },
        clicks: {
          human: 2,
          bot: 1,
          hasEventData: true,
        },
      });
      expect(
        model?.metrics.find((metric) => metric.key === "opened")?.value,
      ).toBe(2);
      expect(
        model?.metrics.find((metric) => metric.key === "clicked")?.value,
      ).toBe(2);
    } finally {
      await runtime.dispose();
    }
  });

  it("falls back to snapshot headline counts when no event data exists", async () => {
    const runtime = await createStage1WebTestRuntime();

    try {
      const { campaigns } = runtime.runtime;

      await runtime.context.repositories.projectDimensions.upsert({
        projectId: "project-1",
        projectName: "Project One",
        projectAlias: "project-one",
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

      const run = await campaigns.campaignRuns.create({
        id: "run-detail-legacy-fallback",
        kind: "project",
        launchType: "normal_email",
        projectId: "project-1",
        name: null,
        fromEmail: "project-one@adventurescientists.org",
        fromName: "Adventure Scientists",
        replyToEmail: "project-one@adventurescientists.org",
        subjectTemplate: "Legacy update",
        subjectTemplateB: null,
        abTestEnabled: false,
        bodyHtmlTemplate: "<p>Hello</p>",
        bodyTextTemplate: "Hello",
        bodyDesignJson: null,
        preheader: null,
        audienceCriteria: {
          projectId: "project-1",
          projectIds: ["project-1"],
          statuses: [],
          contactIds: [],
          newsletterSubscriberIds: [],
          expeditionIds: [],
          lastActivityWindow: "all_time",
          hasReplied: "either",
          hasClicked: "either",
        },
        audienceSize: 2,
        createdByUserId: null,
        lastEditedByUserId: null,
      });

      await campaigns.audienceSnapshots.bulkInsert(run.id, [
        {
          id: "legacy-snapshot-1",
          contactId: null,
          newsletterSubscriberId: null,
          frozenEmail: "legacy-1@example.org",
          frozenFirstName: "Legacy One",
          frozenProjectName: "Project One",
          frozenProjectId: "project-1",
          frozenAliasEmail: "project-one@adventurescientists.org",
          unsubscribeToken: "legacy-token-1",
          deliveryStatus: "sent",
          providerMessageId: "legacy-pm-1",
          openedAt: "2026-07-02T12:50:00.000Z",
          clickedAt: "2026-07-02T12:51:00.000Z",
        },
        {
          id: "legacy-snapshot-2",
          contactId: null,
          newsletterSubscriberId: null,
          frozenEmail: "legacy-2@example.org",
          frozenFirstName: "Legacy Two",
          frozenProjectName: "Project One",
          frozenProjectId: "project-1",
          frozenAliasEmail: "project-one@adventurescientists.org",
          unsubscribeToken: "legacy-token-2",
          deliveryStatus: "sent",
          providerMessageId: "legacy-pm-2",
          openedAt: "2026-07-02T12:52:00.000Z",
        },
      ]);

      const model = await getRunDetailModel({
        runId: run.id,
        provider: "postmark",
        isAdmin: true,
      });

      expect(model?.botActivity).toEqual({
        opens: {
          human: 0,
          bot: 0,
          hasEventData: false,
        },
        clicks: {
          human: 0,
          bot: 0,
          hasEventData: false,
        },
      });
      expect(
        model?.metrics.find((metric) => metric.key === "opened")?.value,
      ).toBe(2);
      expect(
        model?.metrics.find((metric) => metric.key === "clicked")?.value,
      ).toBe(1);
    } finally {
      await runtime.dispose();
    }
  });

  it("matches the sending Postmark snapshot", () => {
    expect(renderShell(buildPostmarkModel("sending"))).toMatchSnapshot();
  });

  it("loads SMS metrics from sms_messages and excludes inbound rows", async () => {
    const runtime = await createStage1WebTestRuntime();

    try {
      await seedProjectForRunTests(runtime);
      await seedContactForRunTests(runtime, {
        id: "contact-sms-1",
        name: "Taylor",
        phone: "+15555550101",
      });
      await seedContactForRunTests(runtime, {
        id: "contact-sms-2",
        name: "Jordan",
        phone: "+15555550102",
      });
      await seedSmsSenderForRunTests(runtime);

      const run = await runtime.runtime.campaigns.campaignRuns.create({
        id: "run-detail-sms-metrics",
        kind: "project",
        launchType: "sms",
        projectId: "project-1",
        name: "Trailhead reminder",
        fromEmail: null,
        fromName: null,
        replyToEmail: null,
        subjectTemplate: null,
        subjectTemplateB: null,
        abTestEnabled: false,
        bodyHtmlTemplate: null,
        bodyTextTemplate: "Meet at the trailhead at 7:30 AM.",
        bodyDesignJson: null,
        preheader: null,
        audienceCriteria: {
          projectId: "project-1",
          projectIds: ["project-1"],
          statuses: [],
          contactIds: [],
          newsletterSubscriberIds: [],
          expeditionIds: [],
          lastActivityWindow: "all_time",
          hasReplied: "either",
          hasClicked: "either",
        },
        audienceSize: 6,
        createdByUserId: null,
        lastEditedByUserId: null,
      });

      const rows = [
        {
          id: "sms-queued",
          contactId: "contact-sms-1",
          phoneE164: "+15555550101",
          sendStatus: "queued" as const,
          sentAt: null,
        },
        {
          id: "sms-suppressed",
          contactId: "contact-sms-1",
          phoneE164: "+15555550101",
          sendStatus: "suppressed" as const,
          sentAt: null,
        },
        {
          id: "sms-sent",
          contactId: "contact-sms-1",
          phoneE164: "+15555550101",
          sendStatus: "sent" as const,
          sentAt: new Date("2026-07-10T12:01:00.000Z"),
        },
        {
          id: "sms-delivered",
          contactId: "contact-sms-2",
          phoneE164: "+15555550102",
          sendStatus: "delivered" as const,
          sentAt: new Date("2026-07-10T12:02:00.000Z"),
        },
        {
          id: "sms-failed",
          contactId: "contact-sms-2",
          phoneE164: "+15555550102",
          sendStatus: "failed" as const,
          sentAt: null,
        },
        {
          id: "sms-undelivered",
          contactId: "contact-sms-2",
          phoneE164: "+15555550102",
          sendStatus: "undelivered" as const,
          sentAt: new Date("2026-07-10T12:03:00.000Z"),
        },
      ];

      for (const [index, row] of rows.entries()) {
        const createdAtIso = `2026-07-10T12:0${String(index)}:00.000Z`;
        await runtime.context.repositories.smsMessages.insert({
          id: row.id,
          twilioMessageSid: `SM${row.id}`,
          direction: "outbound",
          contactId: row.contactId,
          phoneE164: row.phoneE164,
          senderId: "sender-sms-1",
          broadcastRunId: run.id,
          body: `Body ${row.id}`,
          segments: 1,
          encoding: "GSM-7",
          mediaUrls: null,
          sendStatus: row.sendStatus,
          failedReason: null,
          failedDetail: null,
          sentAt: row.sentAt,
          receivedAt: null,
          actorId: null,
          createdAt: new Date(createdAtIso),
          updatedAt: new Date(createdAtIso),
        });
      }

      await runtime.context.repositories.smsMessages.insert({
        id: "sms-inbound-received",
        twilioMessageSid: "SMinbound",
        direction: "inbound",
        contactId: "contact-sms-1",
        phoneE164: "+15555550101",
        senderId: "sender-sms-1",
        broadcastRunId: null,
        body: "Reply message",
        segments: 1,
        encoding: "GSM-7",
        mediaUrls: null,
        sendStatus: "received",
        failedReason: null,
        failedDetail: null,
        sentAt: null,
        receivedAt: new Date("2026-07-10T12:04:00.000Z"),
        actorId: null,
        createdAt: new Date("2026-07-10T12:04:00.000Z"),
        updatedAt: new Date("2026-07-10T12:04:00.000Z"),
      });

      const model = await getRunDetailModel({
        runId: run.id,
        isAdmin: true,
      });

      expect(model?.provider).toBe("sms");
      expect(model?.channel).toBe("sms");
      expect(model?.metrics).toEqual([
        expect.objectContaining({ key: "queued", value: 1, percentage: 16.7 }),
        expect.objectContaining({ key: "sent", value: 3, percentage: 50 }),
        expect.objectContaining({ key: "delivered", value: 1, percentage: 16.7 }),
        expect.objectContaining({ key: "failed", value: 2, percentage: 33.3 }),
        expect.objectContaining({ key: "suppressed", value: 1, percentage: 16.7 }),
        expect.objectContaining({ key: "replied", value: 0, percentage: 0 }),
      ]);
      expect(model?.totalAudience).toBe(6);
      expect(model?.recipientTotal).toBe(6);
      expect(model?.recipients.map((row) => row.latestState)).toEqual([
        "queued",
        "suppressed",
        "sent",
        "delivered",
        "failed",
        "failed",
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("counts SMS replies after completion only for run recipients", async () => {
    const runtime = await createStage1WebTestRuntime();

    try {
      await seedProjectForRunTests(runtime);
      await seedContactForRunTests(runtime, {
        id: "contact-sms-1",
        name: "Taylor",
        phone: "+15555550101",
      });
      await seedContactForRunTests(runtime, {
        id: "contact-sms-2",
        name: "Jordan",
        phone: "+15555550102",
      });
      await seedSmsSenderForRunTests(runtime);

      const run = await runtime.runtime.campaigns.campaignRuns.create({
        id: "run-detail-sms-replies",
        kind: "project",
        launchType: "sms",
        projectId: "project-1",
        name: "Gear check",
        fromEmail: null,
        fromName: null,
        replyToEmail: null,
        subjectTemplate: null,
        subjectTemplateB: null,
        abTestEnabled: false,
        bodyHtmlTemplate: null,
        bodyTextTemplate: "Reply if you need a gear check.",
        bodyDesignJson: null,
        preheader: null,
        audienceCriteria: {
          projectId: "project-1",
          projectIds: ["project-1"],
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
      await runtime.runtime.campaigns.campaignRuns.update(run.id, {
        state: "complete",
        startedAt: "2026-07-10T12:05:00.000Z",
        completedAt: "2026-07-10T12:10:00.000Z",
      });

      await runtime.context.repositories.smsMessages.insert({
        id: "sms-run-recipient",
        twilioMessageSid: "SMrecipient",
        direction: "outbound",
        contactId: "contact-sms-1",
        phoneE164: "+15555550101",
        senderId: "sender-sms-1",
        broadcastRunId: run.id,
        body: "Reply if you need a gear check.",
        segments: 1,
        encoding: "GSM-7",
        mediaUrls: null,
        sendStatus: "delivered",
        failedReason: null,
        failedDetail: null,
        sentAt: new Date("2026-07-10T12:05:00.000Z"),
        receivedAt: null,
        actorId: null,
        createdAt: new Date("2026-07-10T12:05:00.000Z"),
        updatedAt: new Date("2026-07-10T12:05:00.000Z"),
      });

      const sourceEvidenceIds = [
        "source-sms-before",
        "source-sms-after",
        "source-sms-nonrecipient",
      ] as const;
      for (const sourceEvidenceId of sourceEvidenceIds) {
        await runtime.context.repositories.sourceEvidence.append({
          id: sourceEvidenceId,
          provider: "twilio",
          providerRecordType: "message",
          providerRecordId: sourceEvidenceId,
          receivedAt: "2026-07-10T12:20:00.000Z",
          occurredAt: "2026-07-10T12:20:00.000Z",
          payloadRef: `payloads/twilio/${sourceEvidenceId}.json`,
          idempotencyKey: `twilio:${sourceEvidenceId}`,
          checksum: `checksum:${sourceEvidenceId}`,
        });
      }

      await runtime.context.repositories.canonicalEvents.upsert({
        id: "canonical-sms-before",
        contactId: "contact-sms-1",
        eventType: "communication.sms.inbound",
        channel: "sms",
        occurredAt: "2026-07-10T12:09:00.000Z",
        sourceEvidenceId: "source-sms-before",
        idempotencyKey: "canonical-sms-before",
        contentFingerprint: null,
        provenance: {
          primaryProvider: "twilio",
          primarySourceEvidenceId: "source-sms-before",
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: "message",
          sourceRecordId: "source-sms-before",
          messageKind: "one_to_one",
          campaignRef: null,
          threadRef: {
            crossProviderCollapseKey: "+15555550101",
            providerThreadId: "+15555550101",
          },
          direction: "inbound",
          notes: null,
        },
        reviewState: "clear",
      });
      await runtime.context.repositories.canonicalEvents.upsert({
        id: "canonical-sms-after",
        contactId: "contact-sms-1",
        eventType: "communication.sms.inbound",
        channel: "sms",
        occurredAt: "2026-07-10T12:20:00.000Z",
        sourceEvidenceId: "source-sms-after",
        idempotencyKey: "canonical-sms-after",
        contentFingerprint: null,
        provenance: {
          primaryProvider: "twilio",
          primarySourceEvidenceId: "source-sms-after",
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: "message",
          sourceRecordId: "source-sms-after",
          messageKind: "one_to_one",
          campaignRef: null,
          threadRef: {
            crossProviderCollapseKey: "+15555550101",
            providerThreadId: "+15555550101",
          },
          direction: "inbound",
          notes: null,
        },
        reviewState: "clear",
      });
      await runtime.context.repositories.canonicalEvents.upsert({
        id: "canonical-sms-nonrecipient",
        contactId: "contact-sms-2",
        eventType: "communication.sms.inbound",
        channel: "sms",
        occurredAt: "2026-07-10T12:25:00.000Z",
        sourceEvidenceId: "source-sms-nonrecipient",
        idempotencyKey: "canonical-sms-nonrecipient",
        contentFingerprint: null,
        provenance: {
          primaryProvider: "twilio",
          primarySourceEvidenceId: "source-sms-nonrecipient",
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: "message",
          sourceRecordId: "source-sms-nonrecipient",
          messageKind: "one_to_one",
          campaignRef: null,
          threadRef: {
            crossProviderCollapseKey: "+15555550102",
            providerThreadId: "+15555550102",
          },
          direction: "inbound",
          notes: null,
        },
        reviewState: "clear",
      });

      const model = await getRunDetailModel({
        runId: run.id,
        isAdmin: true,
      });

      expect(model?.repliesCount).toBe(1);
      expect(model?.metrics.find((metric) => metric.key === "replied")?.value).toBe(1);
      expect(model?.recentReplies).toEqual([
        {
          contactId: "contact-sms-1",
          contactName: "Taylor",
          email: "+15555550101",
          occurredAt: "2026-07-10T12:20:00.000Z",
        },
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("falls back the header title from subject to name to Untitled broadcast", async () => {
    const runtime = await createStage1WebTestRuntime();

    try {
      const audienceCriteria = {
        projectId: null,
        projectIds: [],
        statuses: [],
        contactIds: [],
        newsletterSubscriberIds: [],
        expeditionIds: [],
        lastActivityWindow: "all_time" as const,
        hasReplied: "either" as const,
        hasClicked: "either" as const,
      };
      const { campaigns } = runtime.runtime;
      await campaigns.campaignRuns.create({
        id: "run-header-subject",
        kind: "project",
        launchType: "normal_email",
        projectId: null,
        name: null,
        fromEmail: null,
        fromName: null,
        replyToEmail: null,
        subjectTemplate: "  Subject wins  ",
        subjectTemplateB: null,
        abTestEnabled: false,
        bodyHtmlTemplate: null,
        bodyTextTemplate: null,
        bodyDesignJson: null,
        preheader: null,
        audienceCriteria,
        audienceSize: null,
        createdByUserId: null,
        lastEditedByUserId: null,
      });
      await campaigns.campaignRuns.create({
        id: "run-header-name",
        kind: "project",
        launchType: "sms",
        projectId: null,
        name: null,
        fromEmail: null,
        fromName: null,
        replyToEmail: null,
        subjectTemplate: "   ",
        subjectTemplateB: null,
        abTestEnabled: false,
        bodyHtmlTemplate: null,
        bodyTextTemplate: null,
        bodyDesignJson: null,
        preheader: null,
        audienceCriteria,
        audienceSize: null,
        createdByUserId: null,
        lastEditedByUserId: null,
      });
      await campaigns.campaignRuns.create({
        id: "run-header-untitled",
        kind: "project",
        launchType: "sms",
        projectId: null,
        name: null,
        fromEmail: null,
        fromName: null,
        replyToEmail: null,
        subjectTemplate: "   ",
        subjectTemplateB: null,
        abTestEnabled: false,
        bodyHtmlTemplate: null,
        bodyTextTemplate: null,
        bodyDesignJson: null,
        preheader: null,
        audienceCriteria,
        audienceSize: null,
        createdByUserId: null,
        lastEditedByUserId: null,
      });

      await campaigns.campaignRuns.update("run-header-subject", {
        name: "  Saved name  ",
      });
      await campaigns.campaignRuns.update("run-header-name", {
        name: "  Name fallback  ",
      });
      await campaigns.campaignRuns.update("run-header-untitled", {
        name: "   ",
      });

      const [subjectHeader, nameHeader, untitledHeader] = await Promise.all([
        getRunDetailHeaderModel({ runId: "run-header-subject", isAdmin: true }),
        getRunDetailHeaderModel({ runId: "run-header-name", isAdmin: true }),
        getRunDetailHeaderModel({ runId: "run-header-untitled", isAdmin: true }),
      ]);

      expect(subjectHeader?.subject).toBe("Subject wins");
      expect(nameHeader?.subject).toBe("Name fallback");
      expect(untitledHeader?.subject).toBe("Untitled broadcast");
    } finally {
      await runtime.dispose();
    }
  });

  it("returns per-variant subject metrics for A/B runs", async () => {
    const runtime = await createStage1WebTestRuntime();

    try {
      const { campaigns } = runtime.runtime;

      await runtime.context.repositories.projectDimensions.upsert({
        projectId: "project-1",
        projectName: "Project One",
        projectAlias: "project-one",
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

      const run = await campaigns.campaignRuns.create({
        id: "run-detail-ab-metrics",
        kind: "project",
        launchType: "normal_email",
        projectId: "project-1",
        name: null,
        fromEmail: "project-one@adventurescientists.org",
        fromName: "Adventure Scientists",
        replyToEmail: "project-one@adventurescientists.org",
        subjectTemplate: "Subject A",
        subjectTemplateB: "Subject B",
        abTestEnabled: true,
        bodyHtmlTemplate: "<p>Hello</p>",
        bodyTextTemplate: "Hello",
        bodyDesignJson: null,
        preheader: null,
        audienceCriteria: {
          projectId: "project-1",
          projectIds: ["project-1"],
          statuses: [],
          contactIds: [],
          newsletterSubscriberIds: [],
          expeditionIds: [],
          lastActivityWindow: "all_time",
          hasReplied: "either",
          hasClicked: "either",
        },
        audienceSize: 4,
        createdByUserId: null,
        lastEditedByUserId: null,
      });

      await campaigns.audienceSnapshots.bulkInsert(run.id, [
        {
          id: "snapshot-a-1",
          contactId: null,
          newsletterSubscriberId: null,
          frozenEmail: "variant-a-1@example.org",
          frozenFirstName: "Variant",
          frozenProjectName: "Project One",
          frozenProjectId: "project-1",
          frozenAliasEmail: "project-one@adventurescientists.org",
          unsubscribeToken: "token-a-1",
          deliveryStatus: "delivered",
          providerMessageId: "pm-a-1",
          subjectVariant: "a",
        },
        {
          id: "snapshot-a-2",
          contactId: null,
          newsletterSubscriberId: null,
          frozenEmail: "variant-a-2@example.org",
          frozenFirstName: "Variant",
          frozenProjectName: "Project One",
          frozenProjectId: "project-1",
          frozenAliasEmail: "project-one@adventurescientists.org",
          unsubscribeToken: "token-a-2",
          deliveryStatus: "delivered",
          providerMessageId: "pm-a-2",
          openedAt: "2026-07-02T13:00:00.000Z",
          clickedAt: "2026-07-02T13:01:00.000Z",
          subjectVariant: "a",
        },
        {
          id: "snapshot-b-1",
          contactId: null,
          newsletterSubscriberId: null,
          frozenEmail: "variant-b-1@example.org",
          frozenFirstName: "Variant",
          frozenProjectName: "Project One",
          frozenProjectId: "project-1",
          frozenAliasEmail: "project-one@adventurescientists.org",
          unsubscribeToken: "token-b-1",
          deliveryStatus: "sent",
          providerMessageId: "pm-b-1",
          subjectVariant: "b",
        },
        {
          id: "snapshot-b-2",
          contactId: null,
          newsletterSubscriberId: null,
          frozenEmail: "variant-b-2@example.org",
          frozenFirstName: "Variant",
          frozenProjectName: "Project One",
          frozenProjectId: "project-1",
          frozenAliasEmail: "project-one@adventurescientists.org",
          unsubscribeToken: "token-b-2",
          deliveryStatus: "delivered",
          providerMessageId: "pm-b-2",
          openedAt: "2026-07-02T13:02:00.000Z",
          subjectVariant: "b",
        },
      ]);

      const model = await getRunDetailModel({
        runId: run.id,
        provider: "postmark",
        isAdmin: true,
      });

      expect(model?.subjectVariantBreakdown).toEqual([
        {
          variant: "a",
          label: "A",
          subject: "Subject A",
          assigned: 2,
          delivered: 2,
          deliveredRate: 100,
          opened: 1,
          openedRate: 50,
          clicked: 1,
          clickedRate: 50,
        },
        {
          variant: "b",
          label: "B",
          subject: "Subject B",
          assigned: 2,
          delivered: 1,
          deliveredRate: 50,
          opened: 1,
          openedRate: 50,
          clicked: 0,
          clickedRate: 0,
        },
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("renders populated and empty link-click states", () => {
    const populatedHtml = renderToStaticMarkup(
      <LinkClicksPanel model={buildPostmarkModel("complete")} />,
    );
    const emptyHtml = renderToStaticMarkup(
      <LinkClicksPanel
        model={buildPostmarkModel("complete", { linkClicks: [] })}
      />,
    );

    expect(populatedHtml).toContain("https://example.org/a");
    expect(populatedHtml).toContain("4 clicks");
    expect(populatedHtml).toContain("2 unique");
    expect(emptyHtml).toContain("No link clicks recorded yet.");
  });

  it("renders per-link bot-share only when bot clicks exist", () => {
    const html = renderToStaticMarkup(
      <LinkClicksPanel
        model={buildPostmarkModel("complete", {
          linkClicks: [
            {
              url: "https://example.org/a",
              totalClicks: 10,
              botClicks: 3,
              uniqueClickers: 4,
            },
            {
              url: "https://example.org/b",
              totalClicks: 2,
              botClicks: 0,
              uniqueClickers: 1,
            },
          ],
        })}
      />,
    );

    expect(html).toContain("3 bot");
    expect(html).not.toContain("0 bot");
  });

  it("renders SMS detail panels and hides email-only panels", () => {
    const html = renderShell(buildSmsModel());

    expect(html).toContain(">Queued<");
    expect(html).toContain(">Sent<");
    expect(html).toContain(">Delivered<");
    expect(html).toContain(">Failed<");
    expect(html).toContain(">Suppressed<");
    expect(html).toContain(">Replied<");
    expect(html).toContain(">Message<");
    expect(html).toContain("Meet at the trailhead at 7:30 AM.");
    expect(html).not.toContain(">Opened<");
    expect(html).not.toContain(">Clicked<");
    expect(html).not.toContain(">Bounced<");
    expect(html).not.toContain(">Unsubscribed<");
    expect(html).not.toContain(">Complained<");
    expect(html).not.toContain(">Link clicks<");
    expect(html).not.toContain(">Subject variants<");
    expect(html).not.toContain(">Bot &amp; scanner activity<");
    expect(html).not.toContain(">From<");
    expect(html).not.toContain(">Reply-to<");
  });

  it("renders the A/B subject breakdown only when enabled", () => {
    const abModel = buildPostmarkModel("complete", {
      run: {
        subjectTemplate: "Subject A",
        subjectTemplateB: "Subject B",
        abTestEnabled: true,
      },
      subjectVariantBreakdown: [
        {
          variant: "a",
          label: "A",
          subject: "Subject A",
          assigned: 51,
          delivered: 42,
          deliveredRate: 82.4,
          opened: 20,
          openedRate: 39.2,
          clicked: 6,
          clickedRate: 11.8,
        },
        {
          variant: "b",
          label: "B",
          subject: "Subject B",
          assigned: 49,
          delivered: 40,
          deliveredRate: 81.6,
          opened: 18,
          openedRate: 36.7,
          clicked: 5,
          clickedRate: 10.2,
        },
      ],
    });
    const abHtml = renderToStaticMarkup(
      <SubjectVariantBreakdownPanel model={abModel} />,
    );
    const controlHtml = renderToStaticMarkup(
      <SubjectVariantBreakdownPanel model={buildPostmarkModel("complete")} />,
    );

    expect(abHtml).toContain("Variant A");
    expect(abHtml).toContain("Subject A");
    expect(abHtml).toContain("51 recipients");
    expect(abHtml).toContain("39.2%");
    expect(abHtml).toContain("Subject B");
    expect(controlHtml).toBe("");
  });

  it("renders bot activity when event data exists", () => {
    const html = renderToStaticMarkup(
      <BotActivityPanel
        model={buildPostmarkModel("complete", {
          botActivity: {
            opens: {
              human: 11,
              bot: 1,
              hasEventData: true,
            },
            clicks: {
              human: 8,
              bot: 5,
              hasEventData: true,
            },
          },
        })}
      />,
    );

    expect(html).toContain("Bot &amp; scanner activity");
    expect(html).toContain(">Opens<");
    expect(html).toContain(">Clicks<");
    expect(html).toContain(">Real<");
    expect(html).toContain(">Bot / scanner<");
    expect(html).toContain(">11<");
    expect(html).toContain(">1<");
    expect(html).toContain(">12<");
    expect(html).toContain(">8<");
    expect(html).toContain(">5<");
    expect(html).toContain(">13<");
  });

  it("hides bot activity when event data is unavailable or unsupported", () => {
    const legacyHtml = renderToStaticMarkup(
      <BotActivityPanel
        model={buildPostmarkModel("complete", {
          botActivity: {
            opens: {
              human: 0,
              bot: 0,
              hasEventData: false,
            },
            clicks: {
              human: 0,
              bot: 0,
              hasEventData: false,
            },
          },
        })}
      />,
    );

    expect(legacyHtml).toBe("");
    expect(
      renderToStaticMarkup(<BotActivityPanel model={buildMailchimpModel()} />),
    ).toBe("");
    expect(
      renderToStaticMarkup(<BotActivityPanel model={buildSmsModel()} />),
    ).toBe("");
  });

  it("renders email HTML visually and falls back to plain text", () => {
    const htmlModel = buildPostmarkModel("complete");
    const htmlOut = renderToStaticMarkup(<EmailContentPanel model={htmlModel} />);
    expect(htmlOut).toContain("<iframe");
    expect(htmlOut).toContain('title="Email body"');
    expect(htmlOut).toContain("appear unrendered");

    const textModel: RunDetailModel = {
      ...htmlModel,
      run: {
        ...htmlModel.run,
        bodyHtmlTemplate: null,
        bodyTextTemplate: "Plain text body only",
      },
    };
    const textOut = renderToStaticMarkup(<EmailContentPanel model={textModel} />);
    expect(textOut).not.toContain("<iframe");
    expect(textOut).toContain("Plain text body only");
  });

  it("renders the Mailchimp placeholder panels", () => {
    const html = renderShell(buildMailchimpModel());

    expect(html).toMatchSnapshot();
    expect(html).toContain("Email content not retained from Mailchimp import.");
    expect(html).toContain("Link clicks are not available for Mailchimp imports.");
    expect(html).toContain("Mailchimp historical audience.");
    expect(html).toContain("0 replies tracked.");
    expect(html).toContain("Inbox unavailable");
    expect(html).not.toContain("Run audit log");
  });
});
