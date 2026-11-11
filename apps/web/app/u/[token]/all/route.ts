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

  if (target !== null && target.contactId !== null) {
    await createConsentLedger({
      repositories: runtime.campaigns,
    }).recordOptOut({
      contactId: target.contactId,
      scope: { type: "all" },
      source: "recipient_click",
      sourceRunId: target.runId,
      email: target.email,
    });
  }
  if (
    target !== null &&
    target.contactId === null &&
    target.newsletterSubscriberId !== null
  ) {
    const contactIds = await findContactIdsOwningEmail(runtime, target.email);
    await Promise.all(
      contactIds.map((contactId) =>
        createConsentLedger({
          repositories: runtime.campaigns,
        }).recordOptOut({
          contactId,
          scope: { type: "all" },
          source: "recipient_click",
          sourceRunId: target.runId,
          email: target.email,
        }),
      ),
    );
    if (contactIds.length === 0) {
      await runtime.campaigns.newsletterSuppressions.recordAllOptOut(
        target.email,
        new Date(),
      );
    } else {
      await runtime.campaigns.newsletterSuppressions.upsert({
        email: target.email,
        reason: "platform_optout",
        source: "recipient_click",
      });
    }
  }
  // No-contact, no-subscriber recipient (CSV import, any kind): suppress by
  // email. The suppression list applies to every send, so this is effectively
  // "unsubscribe from all" for a recipient with no contact record.
  if (
    target !== null &&
    target.contactId === null &&
    target.newsletterSubscriberId === null
  ) {
    const contactIds = await findContactIdsOwningEmail(runtime, target.email);
    if (contactIds.length === 0) {
      await runtime.campaigns.suppressionList.upsertFromBounce(
        target.email,
        "manual",
        `recipient-unsubscribe-all:${target.runId}`,
        new Date(),
      );
    } else {
      await Promise.all(
        contactIds.map((contactId) =>
          createConsentLedger({
            repositories: runtime.campaigns,
          }).recordOptOut({
            contactId,
            scope: { type: "all" },
            source: "recipient_click",
            sourceRunId: target.runId,
            email: target.email,
          }),
        ),
      );
    }
  }

  return redirectToAppPath(`/u/${encodeURIComponent(decodedToken)}?all=1`);
}
