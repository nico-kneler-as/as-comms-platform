import type { Task } from "graphile-worker";

import type { CampaignRunRecord, RunState } from "@as-comms/contracts";
import { smsBroadcastSendPayloadSchema } from "@as-comms/contracts";
import type {
  ConsentRecord,
  SmsMessageRecord,
} from "@as-comms/domain";
import type { TwilioProvider } from "@as-comms/integrations";

interface SmsBroadcastRunRepository {
  findById(id: string): Promise<CampaignRunRecord | null>;
  transitionState(
    id: string,
    from: RunState,
    to: RunState,
    fields?: Partial<CampaignRunRecord>,
  ): Promise<CampaignRunRecord>;
}

interface SmsBroadcastSendRepositories {
  readonly smsMessages: {
    listByBroadcastRun(
      runId: string,
      status: SmsMessageRecord["sendStatus"],
    ): Promise<readonly SmsMessageRecord[]>;
    updateDelivery(input: {
      readonly messageId: string;
      readonly twilioMessageSid?: string | null;
      readonly status: SmsMessageRecord["sendStatus"];
      readonly failedReason?: string | null;
      readonly failedDetail?: string | null;
      readonly sentAt?: Date | null;
    }): Promise<SmsMessageRecord | null>;
    updateSendStatus(
      messageId: string,
      status: SmsMessageRecord["sendStatus"],
      failedReason?: string | null,
      failedDetail?: string | null,
      sentAt?: Date | null,
    ): Promise<SmsMessageRecord | null>;
  };
  readonly consentRecords: {
    findLatestByContact(contactId: string): Promise<ConsentRecord | null>;
    findLatestByPhone(phoneE164: string): Promise<ConsentRecord | null>;
  };
}

export interface SmsBroadcastSendTaskDependencies {
  readonly campaignRuns: SmsBroadcastRunRepository;
  readonly repositories: SmsBroadcastSendRepositories;
  readonly provider: Pick<TwilioProvider, "sendSms"> | null;
  readonly smsEnabled: boolean;
  readonly now?: () => Date;
}

export {
  smsBroadcastSendJobMaxAttempts,
  smsBroadcastSendJobName,
  smsBroadcastSendPayloadSchema,
} from "@as-comms/contracts";
export type { SmsBroadcastSendPayload } from "@as-comms/contracts";

function readTwilioErrorReason(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (typeof error.code === "string" || typeof error.code === "number")
  ) {
    return String(error.code);
  }

  if (error instanceof Error && error.name.trim().length > 0) {
    return error.name;
  }

  return "twilio_send_failed";
}

function readTwilioErrorDetail(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Twilio send failed.";
}

export async function processSmsBroadcastRun(
  runId: string,
  dependencies: SmsBroadcastSendTaskDependencies,
): Promise<void> {
  if (!dependencies.smsEnabled) {
    throw new Error("SMS disabled.");
  }

  if (dependencies.provider === null) {
    throw new Error("Twilio SMS provider is not configured.");
  }

  let run = await dependencies.campaignRuns.findById(runId);
  if (run === null) {
    throw new Error(`SMS broadcast run ${runId} was not found.`);
  }

  if (run.launchType !== "sms") {
    throw new Error(
      `SMS broadcast task received non-SMS run ${runId} (${run.launchType}).`,
    );
  }

  switch (run.state) {
    case "scheduled":
      run = await dependencies.campaignRuns.transitionState(
        runId,
        "scheduled",
        "sending",
      );
      break;
    case "sending":
      break;
    case "complete":
    case "cancelled":
      return;
    default:
      throw new Error(
        `SMS broadcast run ${runId} is not sendable from state ${run.state}.`,
      );
  }

  const queuedRows = await dependencies.repositories.smsMessages.listByBroadcastRun(
    runId,
    "queued",
  );
  const sentAt = dependencies.now ?? (() => new Date());

  for (const row of queuedRows) {
    const latestConsent =
      (await dependencies.repositories.consentRecords.findLatestByContact(
        row.contactId,
      )) ??
      (await dependencies.repositories.consentRecords.findLatestByPhone(
        row.phoneE164,
      ));

    if (latestConsent?.status !== "opted_in") {
      await dependencies.repositories.smsMessages.updateSendStatus(
        row.id,
        "suppressed",
        "consent_revoked_at_send",
      );
      continue;
    }

    try {
      const result = await dependencies.provider.sendSms({
        toE164: row.phoneE164,
        body: row.body,
      });

      await dependencies.repositories.smsMessages.updateDelivery({
        messageId: row.id,
        twilioMessageSid: result.messageSid,
        status: "sent",
        sentAt: sentAt(),
      });
    } catch (error) {
      await dependencies.repositories.smsMessages.updateSendStatus(
        row.id,
        "failed",
        readTwilioErrorReason(error),
        readTwilioErrorDetail(error),
      );
    }
  }

  await dependencies.campaignRuns.transitionState(
    runId,
    "sending",
    "complete",
  );
}

export function createSmsBroadcastSendTask(
  dependencies: SmsBroadcastSendTaskDependencies,
): Task {
  return async (payload) => {
    const parsed = smsBroadcastSendPayloadSchema.parse(payload);
    await processSmsBroadcastRun(parsed.runId, dependencies);
  };
}
