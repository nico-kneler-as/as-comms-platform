import { NextResponse } from "next/server";

import { createConsentLedger } from "@as-comms/domain";

import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

import { resolveUnsubscribeScope, resolveUnsubscribeTarget } from "../_lib/unsubscribe";

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
    const scope = resolveUnsubscribeScope(target);
    if (scope !== null) {
      await createConsentLedger({
        repositories: runtime.campaigns,
      }).recordOptOut({
        contactId: target.contactId,
        scope,
        source: "recipient_click",
        sourceRunId: target.runId,
      });
    }
  }
  // No-contact recipients are keyed off whether they're a real newsletter
  // subscriber, NOT the run kind — an org-sender CSV send is "newsletter"-kind
  // but its recipients are one-off emails, not subscribers.
  if (
    target !== null &&
    target.contactId === null &&
    target.newsletterSubscriberId !== null
  ) {
    await runtime.campaigns.newsletterSuppressions.upsert({
      email: target.email,
      reason: "platform_optout",
      source: "recipient_click",
    });
  }
  // No-contact, no-subscriber recipient (CSV-imported list, any kind): opt out
  // by email via the suppression list, which the exclusion filter honors for
  // every future send (CSV sends respect the suppression list, not the
  // newsletter suppressions).
  if (
    target !== null &&
    target.contactId === null &&
    target.newsletterSubscriberId === null
  ) {
    await runtime.campaigns.suppressionList.upsertFromBounce(
      target.email,
      "manual",
      `recipient-unsubscribe:${target.runId}`,
      new Date(),
    );
  }

  return NextResponse.redirect(
    new URL(
      `/u/${encodeURIComponent(decodedToken)}?confirmed=1`,
      request.url,
    ),
    { status: 303 },
  );
}
