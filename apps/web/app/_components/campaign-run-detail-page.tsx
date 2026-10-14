import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";

import type { Workspace } from "@as-comms/contracts";

import { MetricTiles } from "@/app/broadcasts/[runId]/_components/metric-tiles";
import { RecipientsTable } from "@/app/broadcasts/[runId]/_components/recipients-table";
import { RepliesInInboxPanel } from "@/app/broadcasts/[runId]/_components/replies-in-inbox-panel";
import { RunAuditLog } from "@/app/broadcasts/[runId]/_components/run-audit-log";
import {
  AudienceCriteriaPanel,
  BotActivityPanel,
  EmailContentPanel,
  LinkClicksPanel,
  SendDetailsPanel,
  SubjectVariantBreakdownPanel,
} from "@/app/broadcasts/[runId]/_components/run-detail-panels";
import {
  DetailCardSkeleton,
  MetricTilesSkeleton,
  RecipientsTableSkeleton,
  RightRailSkeleton,
  RunDetailShell,
} from "@/app/broadcasts/[runId]/_components/run-detail-shell";
import { WebVersionPanel } from "@/app/broadcasts/[runId]/_components/web-version-panel";
import {
  getRunDetailHeaderModel,
  getRunDetailModel,
  type RunDetailModel,
} from "@/app/broadcasts/[runId]/_lib/run-detail";
import { requireWorkspace } from "@/src/server/auth/workspace-access";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";
import { ResendPanel } from "@/app/_components/audience-exclusions/resend-panel";

type DetailPromise = Promise<RunDetailModel | null>;

async function readModel(modelPromise: DetailPromise) {
  const model = await modelPromise;
  if (model === null) notFound();
  return model;
}

async function MetricTilesSection({ modelPromise }: { readonly modelPromise: DetailPromise }) {
  return <MetricTiles model={await readModel(modelPromise)} />;
}

async function EmailContentSection({ modelPromise }: { readonly modelPromise: DetailPromise }) {
  const model = await readModel(modelPromise);
  return (
    <>
      <EmailContentPanel model={model} />
      <SubjectVariantBreakdownPanel model={model} />
      <BotActivityPanel model={model} />
      <LinkClicksPanel model={model} />
    </>
  );
}

async function RecipientsSection({ modelPromise }: { readonly modelPromise: DetailPromise }) {
  const model = await readModel(modelPromise);
  return (
    <RecipientsTable
      runId={model.run.id}
      provider={model.provider}
      rows={model.recipients}
      total={model.recipientTotal}
    />
  );
}

async function RightRailSection({ modelPromise, showResendPanel }: { readonly modelPromise: DetailPromise; readonly showResendPanel: boolean }) {
  const model = await readModel(modelPromise);
  const runtime = showResendPanel ? await getStage1WebRuntime() : null;
  const resend = runtime === null ? null : await runtime.campaigns.campaignRuns.findResendByParentRunId(model.run.id);
  return (
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
      <WebVersionPanel runId={model.run.id} webVersion={model.webVersion} />
      <AudienceCriteriaPanel model={model} />
      {showResendPanel ? <ResendPanel parentRunId={model.run.id} child={resend === null ? null : { id: resend.id, state: resend.state, scheduledAt: resend.scheduledAt, audienceSize: resend.audienceSize }} workspace={model.run.workspace} detailHref={(runId) => `${model.run.workspace === "donors" ? "/donors" : "/broadcasts"}/${encodeURIComponent(runId)}`} /> : null}
      {model.provider === "mailchimp" ? null : (
        <RunAuditLog entries={model.auditEntries} />
      )}
    </>
  );
}

export async function CampaignRunDetailPage(input: {
  readonly runId: string;
  readonly provider: "postmark" | "mailchimp";
  readonly workspace: Workspace;
  readonly adminOnly: boolean;
  readonly showResendPanel?: boolean;
}) {
  const access = await requireWorkspace(input.workspace);
  if (input.adminOnly && access.user.role !== "admin") {
    throw new Error("FORBIDDEN");
  }

  const runtime = await getStage1WebRuntime();
  const run =
    input.provider === "postmark"
      ? await runtime.campaigns.campaignRuns.findById(input.runId)
      : null;
  const actualWorkspace = run?.workspace ?? "volunteers";
  if (actualWorkspace !== input.workspace) {
    redirect(
      actualWorkspace === "donors"
        ? `/donors/${encodeURIComponent(input.runId)}`
        : `/broadcasts/${encodeURIComponent(input.runId)}`,
    );
  }

  const modelPromise = getRunDetailModel({
    runId: input.runId,
    provider: input.provider,
    isAdmin: access.user.role === "admin",
  });
  const header = await getRunDetailHeaderModel({
    runId: input.runId,
    provider: input.provider,
    isAdmin: access.user.role === "admin",
  });

  if (header === null) notFound();
  if (header.state === "draft") {
    redirect(
      input.workspace === "volunteers"
        ? `/broadcasts/new?runId=${encodeURIComponent(input.runId)}`
        : `/donors/new?runId=${encodeURIComponent(input.runId)}`,
    );
  }

  return (
    <RunDetailShell
      header={header}
      workspace={input.workspace}
      metricsSection={
        <Suspense fallback={<MetricTilesSkeleton />}>
          <MetricTilesSection modelPromise={modelPromise} />
        </Suspense>
      }
      emailContentSection={
        <Suspense fallback={<DetailCardSkeleton />}>
          <EmailContentSection modelPromise={modelPromise} />
        </Suspense>
      }
      recipientsSection={
        <Suspense fallback={<RecipientsTableSkeleton />}>
          <RecipientsSection modelPromise={modelPromise} />
        </Suspense>
      }
      rightRailSection={
        <Suspense fallback={<RightRailSkeleton />}>
          <RightRailSection modelPromise={modelPromise} showResendPanel={input.showResendPanel ?? false} />
        </Suspense>
      }
    />
  );
}
