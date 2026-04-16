import { StatusBadge } from "@/components/ui/status-badge";

import type { InboxBucket, InboxVolunteerStage } from "../_lib/view-models";
import { BUCKET_BADGE, STAGE_BADGE } from "@/app/_lib/design-tokens";

const BUCKET_LABEL: Record<InboxBucket, string> = {
  new: "New",
  opened: "Opened"
};

export function BucketBadge({ bucket }: { readonly bucket: InboxBucket }) {
  return (
    <StatusBadge
      variant="filled"
      colorClasses={BUCKET_BADGE[bucket]}
      label={BUCKET_LABEL[bucket]}
    />
  );
}

const STAGE_LABEL: Record<InboxVolunteerStage, string> = {
  active: "Active",
  alumni: "Alumni",
  applicant: "Applicant",
  prospect: "Prospect",
  lead: "Lead",
  "non-volunteer": "Non-volunteer"
};

export function StageBadge({ stage }: { readonly stage: InboxVolunteerStage }) {
  return (
    <StatusBadge
      variant="soft"
      colorClasses={STAGE_BADGE[stage]}
      label={STAGE_LABEL[stage]}
    />
  );
}
