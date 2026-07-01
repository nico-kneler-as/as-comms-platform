import { NextResponse } from "next/server";

import { createConsentLedger } from "@as-comms/domain";

import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

import { resolveUnsubscribeTarget } from "../_lib/unsubscribe";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly token: string }> },
) {
  const { token } = await context.params;
  const decodedToken = decodeURIComponent(token);
  const runtime = await getStage1WebRuntime();
  const target = await resolveUnsubscribeTarget(runtime, decodedToken);

  if (target !== null && target.contactId !== null) {
    await createConsentLedger({
      repositories: runtime.campaigns,
    }).recordOptOut({
      contactId: target.contactId,
      scope: { type: "all" },
      source: "recipient_click",
      sourceRunId: target.runId,
    });
  }
  if (
    target !== null &&
    target.contactId === null &&
    target.kind === "newsletter"
  ) {
    await runtime.campaigns.newsletterSuppressions.upsert({
      email: target.email,
      reason: "platform_optout",
      source: "recipient_click",
    });
  }

  return NextResponse.redirect(
    new URL(`/u/${encodeURIComponent(decodedToken)}?all=1`, request.url),
    { status: 303 },
  );
}
