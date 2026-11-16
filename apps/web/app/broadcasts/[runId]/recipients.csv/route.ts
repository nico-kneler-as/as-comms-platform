import { requireVolunteerSession } from "@/src/server/auth/workspace-access";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

import {
  buildRecipientResultsCsv,
  listRunRecipientResults,
  type BroadcastProvider,
} from "../../_lib/broadcast-results";
import type { RecipientFilter } from "../../_lib/run-recipients";

export const dynamic = "force-dynamic";

const FILTERS: readonly RecipientFilter[] = [
  "all",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "unsubscribed",
  "failed",
  "suppressed",
];

function readFilter(value: string | null): RecipientFilter {
  return FILTERS.find((filter) => filter === value) ?? "all";
}

function readProvider(value: string | null): BroadcastProvider | null {
  return value === "mailchimp" || value === "sms" || value === "postmark"
    ? value
    : null;
}

function toFileSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60);
  return slug.length > 0 ? slug : "broadcast";
}

/**
 * Downloads one send's recipients and their results as CSV, honouring the
 * table's current filter (?filter=) and search (?q=).
 */
export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly runId: string }> },
) {
  await requireVolunteerSession();
  const { runId } = await context.params;
  const url = new URL(request.url);
  const filter = readFilter(url.searchParams.get("filter"));
  const query = url.searchParams.get("q") ?? "";
  const requestedProvider = readProvider(url.searchParams.get("provider"));

  const runtime = await getStage1WebRuntime();
  const run =
    requestedProvider === "mailchimp"
      ? null
      : await runtime.campaigns.campaignRuns.findById(runId);
  if (requestedProvider !== "mailchimp" && run === null) {
    return new Response("Broadcast not found.", { status: 404 });
  }
  const provider: BroadcastProvider =
    requestedProvider === "mailchimp"
      ? "mailchimp"
      : run?.launchType === "sms"
        ? "sms"
        : "postmark";

  const { rows } = await listRunRecipientResults({
    runId,
    provider,
    filter,
    query,
  });
  const fileName = `${toFileSlug(run?.name ?? runId)}-recipients${
    filter === "all" ? "" : `-${filter}`
  }.csv`;

  return new Response(buildRecipientResultsCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
