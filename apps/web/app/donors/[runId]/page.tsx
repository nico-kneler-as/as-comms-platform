import { CampaignRunDetailPage } from "@/app/_components/campaign-run-detail-page";

export const dynamic = "force-dynamic";

export default async function DonorRunDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly runId: string }>;
}) {
  const { runId } = await params;
  return CampaignRunDetailPage({
    runId: decodeURIComponent(runId),
    provider: "postmark",
    workspace: "donors",
    adminOnly: false,
    showResendPanel: true,
  });
}
