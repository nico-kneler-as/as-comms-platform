import { ResendPanel } from "@/app/_components/audience-exclusions/resend-panel";

export function DonorResendPanel({ parentRunId, child }: { readonly parentRunId: string; readonly child: { readonly id: string; readonly state: string; readonly scheduledAt: string | null; readonly audienceSize: number | null } | null }) {
  return <ResendPanel parentRunId={parentRunId} child={child} workspace="donors" />;
}
