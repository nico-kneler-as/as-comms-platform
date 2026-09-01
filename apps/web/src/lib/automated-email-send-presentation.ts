import type { AutomatedEmailSendStatus } from "@as-comms/contracts";

export const AUTOMATED_EMAIL_SEND_STATUS_META = {
  sent: { label: "Sent", tone: "emerald" },
  duplicate: { label: "Duplicate", tone: "slate" },
  held: { label: "Held", tone: "amber" },
  failed: { label: "Failed", tone: "rose" },
  received: { label: "Processing", tone: "slate" },
} as const satisfies Record<
  AutomatedEmailSendStatus,
  {
    readonly label: string;
    readonly tone: "emerald" | "slate" | "amber" | "rose";
  }
>;

/**
 * One operator-facing translation for worker reason codes. The full send-log
 * brick and this editor both use it so codes never leak into the UI.
 */
export function formatAutomatedEmailSendReason(reason: string | null): string {
  if (reason === null || reason.length === 0) {
    return "—";
  }

  if (reason.startsWith("missing_required:")) {
    return `missing: ${reason.slice("missing_required:".length)}`;
  }

  const mapped: Record<string, string> = {
    inactive_dry_run: "inactive (dry run)",
    no_published_copy: "no published copy",
    duplicate_recent_send: "already sent recently",
    template_not_found: "template not found",
    project_not_found: "project not found",
    no_project_sender: "no project sender",
    salesforce_not_configured: "Salesforce is not configured",
    salesforce_resolve_failed: "could not resolve volunteer values",
    postmark_not_configured: "Postmark is not configured",
    postmark_send_failed: "Postmark could not send this email",
    postmark_rejected: "Postmark rejected this email",
    ledger_persist_failed: "email sent, but activity could not be recorded",
    not_found: "expedition member not found",
    invalid_id: "invalid expedition member ID",
  };

  return mapped[reason] ?? "unrecognized delivery issue";
}
