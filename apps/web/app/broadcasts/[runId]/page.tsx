import { CampaignRunDetailPage } from "@/app/_components/campaign-run-detail-page";

export const dynamic = "force-dynamic";

export default async function BroadcastRunDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly runId: string }>;
  readonly searchParams?: Promise<{ readonly provider?: string }>;
}) {
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  return CampaignRunDetailPage({
    runId: decodeURIComponent(runId),
    provider: query?.provider === "mailchimp" ? "mailchimp" : "postmark",
    workspace: "volunteers",
    adminOnly: false,
  });
}
