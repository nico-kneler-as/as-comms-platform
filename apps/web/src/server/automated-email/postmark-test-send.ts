import { createPostmarkClient } from "@as-comms/integrations";

import { readWebEnv } from "../env";

/**
 * The one server-side composition point for automated-email test sends.
 * Keeping provider setup here lets route actions depend on this narrow
 * capability instead of a provider client directly.
 */
export function getAutomatedEmailTestSendRuntime() {
  const env = readWebEnv();
  if (!env.POSTMARK_SERVER_TOKEN || !env.POSTMARK_ACCOUNT_TOKEN) {
    return null;
  }

  return {
    client: createPostmarkClient({
      serverToken: env.POSTMARK_SERVER_TOKEN,
      accountToken: env.POSTMARK_ACCOUNT_TOKEN,
      webhookSigningSecret: env.POSTMARK_WEBHOOK_SIGNING_SECRET ?? "unused",
      baseUrl: env.POSTMARK_BASE_URL,
    }),
    transactionalStreamId: env.POSTMARK_TRANSACTIONAL_STREAM_ID,
  };
}
