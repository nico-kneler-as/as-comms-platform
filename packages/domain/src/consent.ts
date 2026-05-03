import type { ConsentRecord } from "./records.js";

export type CanSendResult =
  | { readonly canSend: true }
  | { readonly canSend: false; readonly reason: "no_consent" | "revoked" };

export function canSendTo(input: {
  readonly latestConsent: ConsentRecord | null;
  readonly hasPriorInbound: boolean;
}): CanSendResult {
  if (input.latestConsent?.status === "opted_in") {
    return { canSend: true };
  }

  if (input.latestConsent?.status === "revoked") {
    return { canSend: false, reason: "revoked" };
  }

  if (input.hasPriorInbound) {
    return { canSend: true };
  }

  return { canSend: false, reason: "no_consent" };
}
