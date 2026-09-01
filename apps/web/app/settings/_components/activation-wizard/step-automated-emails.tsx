"use client";

import type { AutomatedEmailKind } from "@as-comms/contracts";
import { useEffect, useMemo, useState } from "react";

import { AutomatedEmailKindsChecklist } from "@/app/settings/_components/automated-email-kinds-checklist";
import { getAutomatedEmailKindSourcesAction } from "@/app/settings/projects/[projectId]/automated-emails/actions";

export function StepAutomatedEmails({
  projectId,
  selectedKinds,
  includeCustom,
  onSelectedKindsChange,
  onIncludeCustomChange,
}: {
  readonly projectId: string | null;
  readonly selectedKinds: readonly Exclude<AutomatedEmailKind, "custom">[];
  readonly includeCustom: boolean;
  readonly onSelectedKindsChange: (
    kinds: readonly Exclude<AutomatedEmailKind, "custom">[],
  ) => void;
  readonly onIncludeCustomChange: (includeCustom: boolean) => void;
}) {
  const [sourceRows, setSourceRows] = useState<
    readonly {
      readonly kind: AutomatedEmailKind;
      readonly sourceProjectName: string | null;
    }[]
  >([]);
  const [loadMessage, setLoadMessage] = useState<string | null>(null);

  useEffect(() => {
    if (projectId === null) {
      setSourceRows([]);
      setLoadMessage(null);
      return;
    }

    let current = true;
    setLoadMessage(null);
    void getAutomatedEmailKindSourcesAction(projectId).then((result) => {
      if (!current) return;
      if (!result.ok) {
        setSourceRows([]);
        setLoadMessage(result.message);
        return;
      }
      setSourceRows(result.data);
    });
    return () => {
      current = false;
    };
  }, [projectId]);

  const sourceProjectByKind = useMemo(
    () =>
      Object.fromEntries(
        sourceRows.map((source) => [source.kind, source.sourceProjectName]),
      ) as Partial<
        Record<Exclude<AutomatedEmailKind, "custom">, string | null>
      >,
    [sourceRows],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-sky-200/70 bg-sky-50/60 px-4 py-3 text-[12px] leading-relaxed text-sky-900">
        These shells are optional and start inactive. Salesforce webhooks can
        still dry-run against them after activation; nothing sends until each
        template is published and switched on.
      </div>
      <AutomatedEmailKindsChecklist
        selectedKinds={selectedKinds}
        onSelectedKindsChange={onSelectedKindsChange}
        includeCustom={includeCustom}
        onIncludeCustomChange={onIncludeCustomChange}
        sourceProjectByKind={sourceProjectByKind}
        idPrefix="activation-automated-email-kind"
      />
      {loadMessage !== null ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 ring-1 ring-inset ring-amber-200">
          {loadMessage}
        </p>
      ) : null}
    </div>
  );
}
