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
  const decodedToken = decodeURIComponent(token);

  // Newsletter (and broadcast) unsubscribe is applied only via the POST
  // confirm/all route handlers, never on a bare GET load — email clients and
  // security scanners prefetch links, so a GET must stay side-effect free.
  const model = await loadUnsubscribePageModel({
    runtime,
    token: decodedToken,
    requestedAllBanner: query.all === "1",
    confirmed: query.confirmed === "1" || query.all === "1",
  });

  return <UnsubscribePageView model={model} />;
}
