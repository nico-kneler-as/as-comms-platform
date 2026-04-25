import { z } from "zod";

import {
  sendGmailMessage,
  type GmailSendParams,
  type GmailSendResult
} from "@as-comms/integrations";

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

export async function sendComposerGmailMessage(
  params: GmailSendParams
): Promise<GmailSendResult> {
  let config;

  try {
    config = readComposerGmailSendConfig(process.env);
  } catch (error) {
    console.error("[composer/gmail-send] Config parse failed — check GMAIL_* env vars on web service.", error);
    return {
      kind: "auth_error",
      detail: "Composer Gmail send is not configured."
    };
  }

  return sendGmailMessage(params, {
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
  });
}
