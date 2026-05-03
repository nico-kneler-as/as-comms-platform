import { createRequire } from "node:module";

import { z } from "zod";

const require = createRequire(import.meta.url);

export const twilioInboundWebhookPayloadSchema = z
  .object({
    MessageSid: z.string().min(1),
    From: z.string().min(1),
    To: z.string().min(1),
    Body: z.string().default(""),
    NumMedia: z.coerce.number().int().min(0).default(0),
  })
  .passthrough();

export interface TwilioProvider {
  sendSms(input: {
    readonly toE164: string;
    readonly body: string;
    readonly mediaUrls?: readonly string[];
  }): Promise<{ readonly messageSid: string; readonly segments: number }>;
  verifyWebhookSignature(input: {
    readonly url: string;
    readonly params: Record<string, string>;
    readonly signature: string;
  }): boolean;
  parseInbound(payload: Record<string, string>): {
    readonly messageSid: string;
    readonly fromE164: string;
    readonly toE164: string;
    readonly body: string;
    readonly numMediaUrls: number;
    readonly mediaUrls: readonly string[];
  };
}

interface TwilioMessageCreateInput {
  to: string;
  body: string;
  mediaUrl?: string[];
  from?: string;
  messagingServiceSid?: string;
}

interface TwilioClient {
  readonly messages: {
    create(input: TwilioMessageCreateInput): Promise<{
      readonly sid: string;
      readonly numSegments: string;
    }>;
  };
}

interface TwilioSdkModule {
  (
    accountSid: string,
    authToken: string,
  ): TwilioClient;
  validateRequest(
    authToken: string,
    signature: string,
    url: string,
    params: Record<string, string>,
  ): boolean;
}

function loadTwilioSdk(): TwilioSdkModule {
  return require("twilio") as TwilioSdkModule;
}

function isMessagingServiceSid(value: string): boolean {
  return /^MG[a-fA-F0-9]{32}$/.test(value);
}

function parseSegments(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function createTwilioProvider(config: {
  readonly accountSid: string;
  readonly authToken: string;
  readonly messagingServiceSidOrFromNumber: string;
}): TwilioProvider {
  const twilio = loadTwilioSdk();
  const client = twilio(config.accountSid, config.authToken);

  return {
    async sendSms(input) {
      const sender = config.messagingServiceSidOrFromNumber;
      const createInput: TwilioMessageCreateInput = {
        to: input.toE164,
        body: input.body,
        ...(isMessagingServiceSid(sender)
          ? { messagingServiceSid: sender }
          : { from: sender }),
      };

      if (input.mediaUrls !== undefined && input.mediaUrls.length > 0) {
        createInput.mediaUrl = [...input.mediaUrls];
      }

      const response = await client.messages.create(createInput);

      return {
        messageSid: response.sid,
        segments: parseSegments(response.numSegments),
      };
    },

    verifyWebhookSignature(input) {
      return twilio.validateRequest(
        config.authToken,
        input.signature,
        input.url,
        input.params,
      );
    },

    parseInbound(payload) {
      const parsed = twilioInboundWebhookPayloadSchema.parse(payload);
      const mediaUrls = Array.from({ length: parsed.NumMedia }, (_, index) => {
        const value = payload[`MediaUrl${index.toString()}`];
        return value === undefined || value.length === 0 ? null : value;
      }).filter((value): value is string => value !== null);

      return {
        messageSid: parsed.MessageSid,
        fromE164: parsed.From,
        toE164: parsed.To,
        body: parsed.Body,
        numMediaUrls: parsed.NumMedia,
        mediaUrls,
      };
    },
  };
}
