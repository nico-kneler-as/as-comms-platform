import { StatusBadge } from "@/components/ui/status-badge";

import type { ClaudeInboxBucket, ClaudeVolunteerStage } from "../_lib/view-models";
import { BUCKET_BADGE, STAGE_BADGE } from "@/app/_lib/design-tokens";

const BUCKET_LABEL: Record<ClaudeInboxBucket, string> = {
  new: "New",
  opened: "Opened"
};

export function ClaudeBucketBadge({ bucket }: { readonly bucket: ClaudeInboxBucket }) {
  return (
    <StatusBadge
      variant="filled"
      colorClasses={BUCKET_BADGE[bucket]}
      label={BUCKET_LABEL[bucket]}
    />
  );
}

const STAGE_LABEL: Record<ClaudeVolunteerStage, string> = {
  active: "Active",
  alumni: "Alumni",
  applicant: "Applicant",
  prospect: "Prospect",
  lead: "Lead",
  "non-volunteer": "Non-volunteer"
};

export function ClaudeStageBadge({ stage }: { readonly stage: ClaudeVolunteerStage }) {
  return (
    <StatusBadge
      variant="soft"
      colorClasses={STAGE_BADGE[stage]}
      label={STAGE_LABEL[stage]}
    />
  );
}
