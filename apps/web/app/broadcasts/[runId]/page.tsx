import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";

import { requireSession } from "@/src/server/auth/session";

import { RecipientsTable } from "./_components/recipients-table";
import { RepliesInInboxPanel } from "./_components/replies-in-inbox-panel";
import { RunAuditLog } from "./_components/run-audit-log";
import {
  AudienceCriteriaPanel,
  EmailContentPanel,
  LinkClicksPanel,
  SendDetailsPanel,
} from "./_components/run-detail-panels";
import {
  DetailCardSkeleton,
  MetricTilesSkeleton,
  RecipientsTableSkeleton,
  RightRailSkeleton,
  RunDetailShell,
} from "./_components/run-detail-shell";
import { MetricTiles } from "./_components/metric-tiles";
import {
  getRunDetailHeaderModel,
  getRunDetailModel,
  type RunDetailModel,
} from "./_lib/run-detail";

export const dynamic = "force-dynamic";

type DetailPromise = Promise<RunDetailModel | null>;

async function readModel(modelPromise: DetailPromise) {
  const model = await modelPromise;
  if (model === null) {
    notFound();
  }

  return model;
}

async function MetricTilesSection({
  modelPromise,
}: {
  readonly modelPromise: DetailPromise;
}) {
  const model = await readModel(modelPromise);
  return <MetricTiles model={model} />;
}

async function EmailContentSection({
  modelPromise,
}: {
  readonly modelPromise: DetailPromise;
}) {
  const model = await readModel(modelPromise);
  return (
    <>
      <EmailContentPanel model={model} />
      <LinkClicksPanel model={model} />
    </>
  );
}

async function RecipientsSection({
  modelPromise,
}: {
  readonly modelPromise: DetailPromise;
}) {
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

async function RightRailSection({
  modelPromise,
}: {
  readonly modelPromise: DetailPromise;
}) {
  const model = await readModel(modelPromise);

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
        showInboxLink={model.provider === "postmark"}
      />
      <SendDetailsPanel model={model} />
      <AudienceCriteriaPanel model={model} />
      {model.provider === "mailchimp" ? null : (
        <RunAuditLog entries={model.auditEntries} />
      )}
    </>
  );
}

export default async function CampaignRunDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly runId: string }>;
  readonly searchParams?: Promise<{ readonly provider?: string }>;
}) {
  const [{ runId }, query, currentUser] = await Promise.all([
    params,
    searchParams,
    requireSession(),
  ]);
  const provider = query?.provider === "mailchimp" ? "mailchimp" : "postmark";
  const decodedRunId = decodeURIComponent(runId);
  const modelPromise = getRunDetailModel({
    runId: decodedRunId,
    provider,
    isAdmin: currentUser.role === "admin",
  });
  const header = await getRunDetailHeaderModel({
    runId: decodedRunId,
    provider,
    isAdmin: currentUser.role === "admin",
  });

  if (header === null) {
    notFound();
  }

  // A draft has no send report (no frozen audience, metrics, or replies yet).
  // Send it to the compose wizard to continue editing. Safety net for the list
  // link, bookmarks, and any other entry point into this run-detail route.
  if (header.state === "draft") {
    redirect(`/broadcasts/new?runId=${encodeURIComponent(decodedRunId)}`);
  }

  return (
    <RunDetailShell
      header={header}
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
          <RightRailSection modelPromise={modelPromise} />
        </Suspense>
      }
    />
  );
}
