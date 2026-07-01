import type { ConsentRecord, ConsentStatus } from "./records.js";

export type SmsConsentReconcileAction =
  | { readonly kind: "none" }
  | {
      readonly kind: "append";
      readonly status: ConsentStatus;
      readonly source: "salesforce_field";
      readonly reason: string;
    };

export function reconcileSmsConsent(input: {
  readonly sfTextOptIn: boolean | null;
  readonly latestConsent: ConsentRecord | null;
}): SmsConsentReconcileAction {
  if (input.sfTextOptIn === true) {
    if (input.latestConsent === null) {
      return {
        kind: "append",
        status: "opted_in",
        source: "salesforce_field",
        reason: "salesforce text opt-in enabled with no prior consent record",
      };
    }

    return { kind: "none" };
  }

  if (input.latestConsent?.status === "opted_in") {
    return {
      kind: "append",
      status: "revoked",
      source: "salesforce_field",
      reason: "salesforce text opt-in absent so latest opted-in consent must be revoked",
    };
  }

  return { kind: "none" };
}
