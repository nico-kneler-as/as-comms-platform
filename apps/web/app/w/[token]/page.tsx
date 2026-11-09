import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

import { WithdrawPageView } from "./_components/withdraw-page-view";
import { loadWithdrawPageModel } from "./_lib/withdraw";

export const dynamic = "force-dynamic";

export default async function WithdrawPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly token: string }>;
  readonly searchParams: Promise<{ readonly done?: string }>;
}) {
  const [{ token }, query, runtime] = await Promise.all([
    params,
    searchParams,
    getStage1WebRuntime(),
  ]);
  const decodedToken = decodeURIComponent(token);
  const model = await loadWithdrawPageModel({
    runtime,
    token: decodedToken,
    done: query.done === "1",
  });
  return <WithdrawPageView model={model} />;
}
