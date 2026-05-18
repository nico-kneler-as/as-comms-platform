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

vi.mock("../../app/campaigns/actions", () => ({
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

import type { RunDetailModel } from "../../app/campaigns/[runId]/_lib/run-detail";
import { RunDetailShell } from "../../app/campaigns/[runId]/_components/run-detail-shell";

function buildModel(state: RunDetailModel["run"]["state"]): RunDetailModel {
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
      subjectTemplate: `Campaign ${state}`,
      bodyHtmlTemplate: "<p>Hello</p>",
      bodyTextTemplate: "Hello",
      preheader: null,
      audienceCriteria: {
        projectId: "project-1",
        projectIds: ["project-1"],
        statuses: ["Active"],
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
      statuses: ["Active"],
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

describe("campaign run detail snapshots", () => {
  for (const state of [
    "draft",
    "scheduled",
    "sending",
    "complete",
    "cancelled",
    "finalized",
  ] as const) {
    it(`matches the ${state} snapshot`, () => {
      expect(
        renderToStaticMarkup(<RunDetailShell model={buildModel(state)} />),
      ).toMatchSnapshot();
    });
  }
});
