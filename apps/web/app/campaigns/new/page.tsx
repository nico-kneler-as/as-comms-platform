import { notFound, redirect } from "next/navigation";

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

  if (!params.runId) {
    const created = await createCampaignWizardDraft();
    redirect(`/campaigns/new?runId=${encodeURIComponent(created.runId)}`);
  }

  const [draft, bootstrap] = await Promise.all([
    getCampaignWizardDraft(params.runId),
    getAudienceBuilderBootstrap(),
  ]);

  if (draft === null) {
    notFound();
  }

  return <NewCampaignWizard bootstrap={bootstrap} draft={draft} />;
}
