import { notFound, redirect } from "next/navigation";

import { requireWorkspace } from "@/src/server/auth/workspace-access";

import {
  createDonorAppealDraft,
  getDonorAppealBootstrap,
  getDonorAppealDraft,
} from "../actions";
import { DonorAppealWizard } from "../_components/donor-appeal-wizard";

export const dynamic = "force-dynamic";

export default async function NewDonorAppealPage({
  searchParams,
}: {
  readonly searchParams?: Promise<{ readonly runId?: string }>;
}) {
  await requireWorkspace("donors");
  const params = (await searchParams) ?? {};
  if (!params.runId) {
    const created = await createDonorAppealDraft();
    redirect(`/donors/new?runId=${encodeURIComponent(created.runId)}`);
  }
  const [draft, bootstrap] = await Promise.all([
    getDonorAppealDraft(params.runId),
    getDonorAppealBootstrap(),
  ]);
  if (draft === null) notFound();
  return <DonorAppealWizard draft={draft} bootstrap={bootstrap} />;
}
