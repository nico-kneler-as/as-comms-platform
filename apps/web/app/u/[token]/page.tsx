import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

import { UnsubscribePageView } from "./_components/unsubscribe-page-view";
import { loadUnsubscribePageModel } from "./_lib/unsubscribe";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly token: string }>;
  readonly searchParams: Promise<{
    readonly all?: string;
    readonly confirmed?: string;
  }>;
}

export default async function UnsubscribeTokenPage({
  params,
  searchParams,
}: PageProps) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const runtime = await getStage1WebRuntime();
  const model = await loadUnsubscribePageModel({
    runtime,
    token: decodeURIComponent(token),
    requestedAllBanner: query.all === "1",
    confirmed: query.confirmed === "1" || query.all === "1",
  });

  return <UnsubscribePageView model={model} />;
}
