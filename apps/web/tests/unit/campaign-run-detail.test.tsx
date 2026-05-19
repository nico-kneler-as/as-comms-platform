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
  Copy: () => null,
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
import { MetricTiles } from "../../app/broadcasts/[runId]/_components/metric-tiles";
import { RecipientsTable } from "../../app/broadcasts/[runId]/_components/recipients-table";
import { RepliesInInboxPanel } from "../../app/broadcasts/[runId]/_components/replies-in-inbox-panel";
import { RunAuditLog } from "../../app/broadcasts/[runId]/_components/run-audit-log";
import {
  AudienceCriteriaPanel,
  EmailContentPanel,
  SendDetailsPanel,
} from "../../app/broadcasts/[runId]/_components/run-detail-panels";
import { RunDetailShell } from "../../app/broadcasts/[runId]/_components/run-detail-shell";

function buildPostmarkModel(
  state: RunDetailModel["run"]["state"],
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
      emailContentSection={<EmailContentPanel model={model} />}
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
  it("matches the sending Postmark snapshot", () => {
    expect(renderShell(buildPostmarkModel("sending"))).toMatchSnapshot();
  });

  it("renders the Mailchimp placeholder panels", () => {
    const html = renderShell(buildMailchimpModel());

    expect(html).toMatchSnapshot();
    expect(html).toContain("Email content not retained from Mailchimp import.");
    expect(html).toContain("Mailchimp historical audience.");
    expect(html).toContain("0 replies tracked.");
    expect(html).toContain("Inbox unavailable");
    expect(html).not.toContain("Run audit log");
  });
});
