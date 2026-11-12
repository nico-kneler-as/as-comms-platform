import { createConsentLedger } from "@as-comms/domain";

import { redirectToAppPath } from "@/src/server/app-redirect";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

import { resolveUnsubscribeTarget } from "../_lib/unsubscribe";

export const dynamic = "force-dynamic";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function findContactIdsOwningEmail(
  runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>,
  email: string,
): Promise<readonly string[]> {
  const normalizedEmail = normalizeEmail(email);
  const [primaryEmailMatches, identityMatches] = await Promise.all([
    runtime.repositories.contacts.listByNormalizedPrimaryEmails([normalizedEmail]),
    runtime.repositories.contactIdentities.listByNormalizedValue({
      kind: "email",
      normalizedValue: normalizedEmail,
    }),
  ]);
  return [
    ...new Set([
      ...primaryEmailMatches.map((contact) => contact.id),
      ...identityMatches.map((identity) => identity.contactId),
    ]),
  ];
}

export async function POST(
  _request: Request,
  context: { readonly params: Promise<{ readonly token: string }> },
) {
  const { token } = await context.params;
  const decodedToken = decodeURIComponent(token);
  const runtime = await getStage1WebRuntime();
  const target = await resolveUnsubscribeTarget(runtime, decodedToken);
  const now = new Date();

  if (target !== null) {
    const recordContactAllOptOut = (contactId: string) =>
      createConsentLedger({
        repositories: runtime.campaigns,
      }).recordOptOut({
        contactId,
        scope: { type: "all" },
        source: "recipient_click",
        sourceRunId: target.runId,
        email: target.email,
      });
    // Whether a write below already queued the Salesforce all_opt_out event
    // (a contact's consent or a subscriber's recordAllOptOut both do).
    let salesforceNotified = false;

    if (target.contactId !== null) {
      await recordContactAllOptOut(target.contactId);
      salesforceNotified = true;
    } else if (target.newsletterSubscriberId !== null) {
      const contactIds = await findContactIdsOwningEmail(runtime, target.email);
      await Promise.all(contactIds.map(recordContactAllOptOut));
      if (contactIds.length === 0) {
        await runtime.campaigns.newsletterSuppressions.recordAllOptOut(
          target.email,
          now,
        );
      } else {
        await runtime.campaigns.newsletterSuppressions.upsert({
          email: target.email,
          reason: "platform_optout",
          source: "recipient_click",
        });
      }
      salesforceNotified = true;
    } else {
      // No contact, no subscriber (a CSV or list recipient): suppress by email.
      // The suppression list applies to every send.
      const contactIds = await findContactIdsOwningEmail(runtime, target.email);
      if (contactIds.length === 0) {
        await runtime.campaigns.suppressionList.upsertFromBounce(
          target.email,
          "manual",
          `recipient-unsubscribe-all:${target.runId}`,
          now,
        );
      } else {
        await Promise.all(contactIds.map(recordContactAllOptOut));
        salesforceNotified = true;
      }
    }

    // The email-keyed ledger makes "all" stop every send, including Houston
    // list sends, which ignore newsletter-only unsubscribes (PRD #768). Every
    // "all" click reaches Salesforce: queue it here when nothing above did.
    await runtime.campaigns.emailOptOuts.recordAll({
      email: target.email,
      source: "recipient_click",
      sourceRunId: target.runId,
      occurredAt: now,
      notifySalesforce: !salesforceNotified,
    });
  }

  return redirectToAppPath(`/u/${encodeURIComponent(decodedToken)}?all=1`);
}
