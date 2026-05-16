import { notFound } from "next/navigation";

import { getCurrentUser } from "@/src/server/auth/session";

import { RunDetailShell } from "./_components/run-detail-shell";
import { getRunDetailModel } from "./_lib/run-detail";

export const dynamic = "force-dynamic";

export default async function CampaignRunDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly runId: string }>;
}) {
  const { runId } = await params;
  const currentUser = await getCurrentUser();
  const model = await getRunDetailModel({
    runId: decodeURIComponent(runId),
    isAdmin: currentUser?.role === "admin",
  });

  if (model === null) {
    notFound();
  }

  return <RunDetailShell model={model} />;
}
