import { z } from "zod";

import {
  resolveLiveGmailThreadId,
  sendGmailMessage,
  type GmailSendError,
  type GmailSendConfig,
  type GmailSendParams,
  type GmailSendResult
} from "@as-comms/integrations";

export type { GmailSendError, GmailSendParams, GmailSendResult };
export { resolveLiveGmailThreadId };

const composerGmailSendConfigSchema = z.object({
  liveAccount: z.string().email(),
  oauthClientId: z.string().min(1),
  oauthClientSecret: z.string().min(1),
  oauthRefreshToken: z.string().min(1),
  tokenUri: z.string().url().default("https://oauth2.googleapis.com/token"),
  timeoutMs: z.number().int().positive().default(15_000)
});

const accessTokenCache = new Map<
  string,
  { readonly accessToken: string; readonly expiresAtEpochSeconds: number }
>();

function readComposerGmailSendConfig(env: NodeJS.ProcessEnv) {
  return composerGmailSendConfigSchema.parse({
    liveAccount: env.GMAIL_LIVE_ACCOUNT,
    oauthClientId: env.GMAIL_GOOGLE_OAUTH_CLIENT_ID,
    oauthClientSecret: env.GMAIL_GOOGLE_OAUTH_CLIENT_SECRET,
    oauthRefreshToken: env.GMAIL_GOOGLE_OAUTH_REFRESH_TOKEN,
    tokenUri:
      env.GMAIL_GOOGLE_TOKEN_URI?.trim().length
        ? env.GMAIL_GOOGLE_TOKEN_URI.trim()
        : "https://oauth2.googleapis.com/token",
    timeoutMs:
      env.GMAIL_SEND_TIMEOUT_MS === undefined
        ? 15_000
        : Number.parseInt(env.GMAIL_SEND_TIMEOUT_MS, 10)
  });
}

function buildComposerGmailSendConfig(
  config: ReturnType<typeof readComposerGmailSendConfig>
): GmailSendConfig {
  return {
    liveAccount: config.liveAccount,
    oauthClient: {
      clientId: config.oauthClientId,
      clientSecret: config.oauthClientSecret,
      tokenUri: config.tokenUri
    },
    oauthRefreshToken: config.oauthRefreshToken,
    fetchImplementation: fetch,
    timeoutMs: config.timeoutMs,
    accessTokenCache
  };
}

export async function sendComposerGmailMessage(
  params: GmailSendParams,
  options?: { readonly resolveThreadIdViaRfc822?: boolean }
): Promise<GmailSendResult> {
  let config;

  try {
    config = readComposerGmailSendConfig(process.env);
  } catch (error) {
    console.error(
      "[composer/gmail-send] Config parse failed — check GMAIL_* env vars on web service.",
      error
    );
    return {
      kind: "auth_error",
      detail: "Composer Gmail send is not configured."
    };
  }

  const sendConfig = buildComposerGmailSendConfig(config);
  let resolvedThreadId = params.threadId;

  // Keep OAuth config encapsulated in the wrapper so callers only opt into live-thread resolution.
  if (
    options?.resolveThreadIdViaRfc822 === true &&
    params.threadId !== undefined &&
    params.inReplyToRfc822MessageId !== undefined
  ) {
    const resolution = await resolveLiveGmailThreadId({
      rfc822MessageId: params.inReplyToRfc822MessageId,
      config: sendConfig
    });

    if (resolution.kind === "resolved") {
      resolvedThreadId = resolution.threadId;
    } else if (resolution.kind === "not_found") {
      resolvedThreadId = undefined;
    } else {
      console.warn(
        "[composer/thread-resolver] Could not resolve live threadId; falling back to header-based threading.",
        {
          kind: resolution.kind,
          detail: resolution.detail
        }
      );
      resolvedThreadId = undefined;
    }
  }

  return sendGmailMessage(
    {
      ...params,
      ...(resolvedThreadId === undefined ? {} : { threadId: resolvedThreadId })
    },
    sendConfig
  );
}
