import { notFound } from "next/navigation";

import { requireSession } from "@/src/server/auth/session";

import { RunDetailShell } from "./_components/run-detail-shell";
import { getRunDetailModel } from "./_lib/run-detail";

export const dynamic = "force-dynamic";

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
  const model = await getRunDetailModel({
    runId: decodeURIComponent(runId),
    provider: query?.provider === "mailchimp" ? "mailchimp" : "postmark",
    isAdmin: currentUser.role === "admin",
  });

  if (model === null) {
    notFound();
  }

  return <RunDetailShell model={model} />;
}
