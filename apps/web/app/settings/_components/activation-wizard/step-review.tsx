import type { ReactNode } from "react";
import { Check, Mail } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import type { ProjectRowViewModel } from "@/src/server/settings/selectors";

import {
  type AliasDraft,
  getPrimaryAlias,
  truncateSignatureSummary
} from "./shared";

export function StepReview({
  selectedProject,
  aliasDraft,
  aliases,
  notionUrl,
  signatureDraft,
  activationError
}: {
  readonly selectedProject: ProjectRowViewModel | null;
  readonly aliasDraft: string;
  readonly aliases: readonly AliasDraft[];
  readonly notionUrl: string;
  readonly signatureDraft: string;
  readonly activationError: string | null;
}) {
  const primaryAlias = getPrimaryAlias(aliases);

  if (selectedProject === null) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <ReviewRow
          label="Project"
          value={`${selectedProject.projectName} - ${selectedProject.projectId}`}
        />
        <ReviewRow label="Alias" value={aliasDraft.trim()} />
        <ReviewRow
          label="Inbox aliases"
          value={`${String(aliases.length)} (primary: ${primaryAlias?.address ?? "none"})`}
        />
        <ReviewRow
          label="AI knowledge"
          value={
            <span className="flex items-center gap-2">
              <span className="truncate">{notionUrl}</span>
              <StatusBadge
                label="Synced"
                colorClasses="bg-emerald-50 text-emerald-700 ring-emerald-200"
                variant="soft"
              />
            </span>
          }
        />
        <ReviewRow
          label="Signature"
          value={truncateSignatureSummary(signatureDraft)}
          isLast
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-[12px] text-slate-600">
        <p className="font-medium text-slate-900">What happens on activate</p>
        <ul className="mt-2 space-y-1.5">
          <li className="flex gap-2">
            <Check className="mt-0.5 h-3 w-3 text-emerald-600" aria-hidden="true" />
            Project becomes active and starts routing inbound mail.
          </li>
          <li className="flex gap-2">
            <Mail className="mt-0.5 h-3 w-3 text-emerald-600" aria-hidden="true" />
            All inbox aliases route to this project.
          </li>
          <li className="flex gap-2">
            <Check className="mt-0.5 h-3 w-3 text-emerald-600" aria-hidden="true" />
            Future AI drafts use the synced Notion knowledge.
          </li>
        </ul>
      </div>

      {activationError !== null ? (
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-inset ring-rose-200">
          {activationError}
        </div>
      ) : null}
    </div>
  );
}

function ReviewRow({
  label,
  value,
  isLast = false
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly isLast?: boolean;
}) {
  return (
    <div
      className={
        isLast
          ? "grid gap-2 px-4 py-3 md:grid-cols-[160px_minmax(0,1fr)]"
          : "grid gap-2 border-b border-slate-100 px-4 py-3 md:grid-cols-[160px_minmax(0,1fr)]"
      }
    >
      <p className="text-[11px] font-semibold uppercase text-slate-500">{label}</p>
      <div className="min-w-0 text-[12.5px] text-slate-800">{value}</div>
    </div>
  );
}
