import { createConsentLedger } from "@as-comms/domain";

import { redirectToAppPath } from "@/src/server/app-redirect";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

import { resolveUnsubscribeScope, resolveUnsubscribeTarget } from "../_lib/unsubscribe";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { readonly params: Promise<{ readonly token: string }> },
) {
  const { token } = await context.params;
  const decodedToken = decodeURIComponent(token);
  const runtime = await getStage1WebRuntime();
  const target = await resolveUnsubscribeTarget(runtime, decodedToken);
  const scope = target === null ? null : resolveUnsubscribeScope(target);

  if (target !== null && scope?.type === "list" && scope.id !== undefined) {
    await runtime.campaigns.emailOptOuts.record({
      email: target.email,
      scope: { type: "list", listId: scope.id },
      source: "recipient_click",
      sourceRunId: target.runId,
      occurredAt: new Date(),
    });
  } else if (target !== null && target.contactId !== null) {
    if (scope !== null && scope.type !== "list") {
      const consentScope =
        scope.type === "newsletter"
          ? { type: "newsletter" as const }
          : {
              type: "project" as const,
              ...(scope.id === undefined ? {} : { id: scope.id }),
            };
      await createConsentLedger({
        repositories: runtime.campaigns,
      }).recordOptOut({
        contactId: target.contactId,
        scope: consentScope,
        source: "recipient_click",
        sourceRunId: target.runId,
        email: target.email,
      });
    }
  }
  // No-contact recipients are keyed off whether they're a real newsletter
  // subscriber, NOT the run kind — an org-sender CSV send is "newsletter"-kind
  // but its recipients are one-off emails, not subscribers.
  if (
    target !== null &&
    scope?.type !== "list" &&
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
    scope?.type !== "list" &&
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

  return redirectToAppPath(`/u/${encodeURIComponent(decodedToken)}?confirmed=1`);
}
