import type { CampaignRunRecord } from "@as-comms/contracts";

export interface ConfiguredResend {
  readonly delayDays: number;
  readonly subject: string;
  readonly preheader: string;
}

/**
 * The reminder still pending on a draft, so a reopened draft shows it instead
 * of starting "off" and cancelling it on launch. Cancelled or sent reminders
 * don't count.
 */
export async function readConfiguredResend(
  campaignRuns: {
    findResendByParentRunId(parentRunId: string): Promise<CampaignRunRecord | null>;
  },
  parentRunId: string,
): Promise<ConfiguredResend | null> {
  const child = await campaignRuns.findResendByParentRunId(parentRunId);
  if (child?.state !== "draft" || child.resendDelayDays == null) return null;
  return {
    delayDays: child.resendDelayDays,
    subject: child.subjectTemplate ?? "",
    preheader: child.preheader ?? "",
  };
}
