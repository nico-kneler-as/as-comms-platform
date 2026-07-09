import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
import { getRunDetailModel } from "../../app/broadcasts/[runId]/_lib/run-detail";
import { MetricTiles } from "../../app/broadcasts/[runId]/_components/metric-tiles";
import { RecipientsTable } from "../../app/broadcasts/[runId]/_components/recipients-table";
import { RepliesInInboxPanel } from "../../app/broadcasts/[runId]/_components/replies-in-inbox-panel";
import { RunAuditLog } from "../../app/broadcasts/[runId]/_components/run-audit-log";
import {
  AudienceCriteriaPanel,
  EmailContentPanel,
  LinkClicksPanel,
  SendDetailsPanel,
} from "../../app/broadcasts/[runId]/_components/run-detail-panels";
import { RunDetailShell } from "../../app/broadcasts/[runId]/_components/run-detail-shell";
import {
  createStage1WebTestRuntime,
  insertBroadcastLinkClickForTests,
  upsertNewsletterSubscriberForTests,
} from "../../src/server/stage1-runtime.test-support";

function buildPostmarkModel(
  state: RunDetailModel["run"]["state"],
  overrides: Partial<Pick<RunDetailModel, "linkClicks">> = {},
): RunDetailModel {
  return {
    provider: "postmark",
    run: {
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
      bodyHtmlTemplate: "<p>Hello</p>",
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
    },
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
    linkClicks:
      overrides.linkClicks ??
      [
        {
          url: "https://example.org/a",
          totalClicks: 4,
          uniqueClickers: 2,
        },
        {
          url: "https://example.org/b",
          totalClicks: 2,
          uniqueClickers: 1,
        },
      ],
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
  };
}

function buildMailchimpModel(): RunDetailModel {
  return {
    provider: "mailchimp",
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
      bodyHtmlTemplate: null,
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
    linkClicks: [],
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

function buildHeader(model: RunDetailModel): RunDetailHeaderModel {
  return {
    runId: model.run.id,
    state: model.run.state,
    subject: model.run.subjectTemplate ?? "Untitled broadcast",
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
            showInboxLink={model.provider === "postmark"}
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

describe("broadcast run detail", () => {
  it("loads link click aggregates sorted by total clicks with unique clickers", async () => {
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
        },
      ]);

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
          uniqueClickers: 2,
        },
        {
          url: "https://example.org/b",
          totalClicks: 1,
          uniqueClickers: 1,
        },
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("matches the sending Postmark snapshot", () => {
    expect(renderShell(buildPostmarkModel("sending"))).toMatchSnapshot();
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
