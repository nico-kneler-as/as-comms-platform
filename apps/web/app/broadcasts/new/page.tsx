import { notFound, redirect } from "next/navigation";

import { requireVolunteerSession } from "@/src/server/auth/workspace-access";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

import {
  createCampaignWizardDraft,
  getAudienceBuilderBootstrap,
  getCampaignWizardDraft,
} from "../_lib/audience-data-source";

import { NewCampaignWizard } from "./_components/new-campaign-wizard";

export default async function NewCampaignPage({
  searchParams,
}: {
  readonly searchParams?: Promise<{
    readonly runId?: string;
  }>;
}) {
  const params = (await searchParams) ?? {};
  const currentUser = await requireVolunteerSession();

  if (!params.runId) {
    const created = await createCampaignWizardDraft();
    redirect(`/broadcasts/new?runId=${encodeURIComponent(created.runId)}`);
  }

  // An administrator can access both workspaces. Do this before the
  // volunteer wizard reads or saves the draft: that wizard intentionally
  // displays Salesforce-list criteria as the full newsletter audience.
  const runtime = await getStage1WebRuntime();
  const requestedRun = await runtime.campaigns.campaignRuns.findById(params.runId);
  if (requestedRun?.workspace === "donors") {
    redirect(`/donors/new?runId=${encodeURIComponent(params.runId)}`);
  }

  const [draft, bootstrap] = await Promise.all([
    getCampaignWizardDraft(params.runId),
    getAudienceBuilderBootstrap(),
  ]);

  if (draft === null) {
    notFound();
  }

  return (
    <NewCampaignWizard
      bootstrap={bootstrap}
      draft={draft}
      isAdmin={currentUser.role === "admin"}
    />
  );
}
