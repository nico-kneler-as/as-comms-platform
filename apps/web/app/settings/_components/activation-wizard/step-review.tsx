import type { ReactNode } from "react";
import { Check, Mail } from "lucide-react";
import type { AutomatedEmailKind } from "@as-comms/contracts";

import { StatusBadge } from "@/components/ui/status-badge";
import { AUTOMATED_EMAIL_KIND_DEFINITIONS } from "@/src/lib/automated-email-kinds";
import type { ProjectRowViewModel } from "@/src/server/settings/selectors";

import {
  type AliasDraft,
  getPrimaryAlias,
  listEnteredDrafts,
  truncateSignatureSummary,
} from "./shared";
import type { KnowledgeSourceDraft } from "./state";

export function StepReview({
  selectedProject,
  aliasDraft,
  aliases,
  knowledgeSourceDrafts,
  skipKnowledgeSetup,
  signatureDraft,
  connectedProjectIds,
  connectedProjectCandidates,
  automatedEmailKinds,
  includeCustomAutomatedEmail,
  activationError,
}: {
  readonly selectedProject: ProjectRowViewModel | null;
  readonly aliasDraft: string;
  readonly aliases: readonly AliasDraft[];
  readonly knowledgeSourceDrafts: readonly KnowledgeSourceDraft[];
  readonly skipKnowledgeSetup: boolean;
  readonly signatureDraft: string;
  readonly connectedProjectIds: readonly string[];
  readonly connectedProjectCandidates: readonly ProjectRowViewModel[];
  readonly automatedEmailKinds: readonly Exclude<
    AutomatedEmailKind,
    "custom"
  >[];
  readonly includeCustomAutomatedEmail: boolean;
  readonly activationError: string | null;
}) {
  const primaryAlias = getPrimaryAlias(aliases);
  const enteredKnowledgeDrafts = listEnteredDrafts(knowledgeSourceDrafts);

  if (selectedProject === null) {
    return null;
  }

  const selectedConnectedProjects = connectedProjectCandidates.filter(
    (candidate) => connectedProjectIds.includes(candidate.projectId),
  );
  const automatedEmailLabels: string[] =
    AUTOMATED_EMAIL_KIND_DEFINITIONS.filter((definition) =>
      automatedEmailKinds.includes(definition.kind),
    ).map((definition) => definition.label);
  if (includeCustomAutomatedEmail) {
    automatedEmailLabels.push("Custom");
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
          label="Automated emails"
          value={
            automatedEmailLabels.length === 0 ? (
              <span className="text-slate-500">None for now</span>
            ) : (
              <span>{automatedEmailLabels.join(", ")}</span>
            )
          }
        />
        <ReviewRow
          label="AI knowledge"
          value={
            skipKnowledgeSetup ? (
              <span className="text-slate-500">Skipped for now</span>
            ) : (
              <span className="flex items-center gap-2">
                <span className="truncate">
                  {`${String(enteredKnowledgeDrafts.length)} source(s) saved`}
                </span>
                <StatusBadge
                  label="Queued"
                  colorClasses="bg-emerald-50 text-emerald-700 ring-emerald-200"
                  variant="soft"
                />
              </span>
            )
          }
        />
        <ReviewRow
          label="Connected projects"
          value={
            selectedConnectedProjects.length === 0 ? (
              <span className="text-slate-500">None</span>
            ) : (
              <span className="flex flex-col gap-1">
                {selectedConnectedProjects.map((connected) => (
                  <span
                    key={connected.projectId}
                    className="inline-flex w-fit items-center gap-2 rounded-md bg-sky-50 px-2 py-0.5 text-[11.5px] text-sky-800 ring-1 ring-inset ring-sky-200"
                  >
                    {connected.projectName}
                  </span>
                ))}
              </span>
            )
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
            <Check
              className="mt-0.5 size-3 text-emerald-600"
              aria-hidden="true"
            />
            Project becomes active and starts routing inbound mail.
          </li>
          <li className="flex gap-2">
            <Mail
              className="mt-0.5 size-3 text-emerald-600"
              aria-hidden="true"
            />
            All inbox aliases route to this project.
          </li>
          <li className="flex gap-2">
            <Check
              className="mt-0.5 size-3 text-emerald-600"
              aria-hidden="true"
            />
            AI Knowledge can be managed later from the project detail page.
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
  isLast = false,
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
      <p className="text-[11px] font-semibold uppercase text-slate-500">
        {label}
      </p>
      <div className="min-w-0 text-[12.5px] text-slate-800">{value}</div>
    </div>
  );
}
