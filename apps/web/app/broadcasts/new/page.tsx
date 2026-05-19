import { notFound, redirect } from "next/navigation";

import { requireSession } from "@/src/server/auth/session";

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
  const currentUser = await requireSession();

  if (!params.runId) {
    const created = await createCampaignWizardDraft();
    redirect(`/broadcasts/new?runId=${encodeURIComponent(created.runId)}`);
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
