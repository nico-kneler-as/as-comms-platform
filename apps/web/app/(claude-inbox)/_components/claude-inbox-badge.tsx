import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { ClaudeInboxBucket, ClaudeVolunteerStage } from "../_lib/view-models";

const BUCKET_CLASSES: Record<ClaudeInboxBucket, string> = {
  new: "bg-sky-600 text-white border-transparent hover:bg-sky-600",
  opened: "bg-slate-200 text-slate-700 border-transparent hover:bg-slate-200"
};

const BUCKET_LABEL: Record<ClaudeInboxBucket, string> = {
  new: "New",
  opened: "Opened"
};

export function ClaudeBucketBadge({ bucket }: { readonly bucket: ClaudeInboxBucket }) {
  return (
    <Badge
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        BUCKET_CLASSES[bucket]
      )}
    >
      {BUCKET_LABEL[bucket]}
    </Badge>
  );
}

const STAGE_CLASSES: Record<ClaudeVolunteerStage, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200 border-transparent hover:bg-emerald-50",
  alumni: "bg-violet-50 text-violet-700 ring-violet-200 border-transparent hover:bg-violet-50",
  applicant: "bg-amber-50 text-amber-800 ring-amber-200 border-transparent hover:bg-amber-50",
  prospect: "bg-sky-50 text-sky-700 ring-sky-200 border-transparent hover:bg-sky-50",
  lead: "bg-indigo-50 text-indigo-700 ring-indigo-200 border-transparent hover:bg-indigo-50",
  "non-volunteer": "bg-slate-100 text-slate-700 ring-slate-200 border-transparent hover:bg-slate-100"
};

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
    <Badge
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
        STAGE_CLASSES[stage]
      )}
    >
      {STAGE_LABEL[stage]}
    </Badge>
  );
}
