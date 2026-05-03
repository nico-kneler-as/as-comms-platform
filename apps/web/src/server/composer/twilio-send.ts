import { createTwilioProvider } from "@as-comms/integrations";
import { z } from "zod";

const twilioSendConfigSchema = z.object({
  accountSid: z.string().min(1),
  authToken: z.string().min(1),
  messagingServiceSidOrFromNumber: z.string().min(1),
});

function readTwilioSendConfig(env: NodeJS.ProcessEnv = process.env) {
  return twilioSendConfigSchema.parse({
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    messagingServiceSidOrFromNumber:
      env.TWILIO_MESSAGING_SERVICE_SID_OR_FROM_NUMBER,
  });
}

export async function sendSmsViaTwilio(input: {
  readonly toE164: string;
  readonly body: string;
}): Promise<{ readonly messageSid: string; readonly segments: number }> {
  const config = readTwilioSendConfig();
  const provider = createTwilioProvider(config);

  return provider.sendSms({
    toE164: input.toE164,
    body: input.body,
  });
}
