"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, ChevronRight, Clock3, Copy, Mail, Plus } from "lucide-react";
import type { AutomatedEmailKind } from "@as-comms/contracts";

import { AutomatedEmailKindsChecklist } from "@/app/settings/_components/automated-email-kinds-checklist";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type {
  AutomatedEmailListViewModel,
  AutomatedEmailTemplateListItemViewModel,
} from "@/src/server/automated-email/selectors";

import { createFromKindsAction } from "../actions";

function relativeTime(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const date = new Date(value);
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (!Number.isFinite(seconds)) {
    return "Unknown";
  }
  if (seconds < 60) return "just now";
  if (seconds < 60 * 60) return `${String(Math.floor(seconds / 60))}m ago`;
  if (seconds < 24 * 60 * 60)
    return `${String(Math.floor(seconds / 3600))}h ago`;
  return `${String(Math.floor(seconds / 86400))}d ago`;
}

function CopyIdChip({ id }: { readonly id: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => { setCopied(false); }, 1400);
    return () => { window.clearTimeout(timer); };
  }, [copied]);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      title="Copy template ID"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void copyId();
      }}
      className="group inline-flex h-6 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50/80 pl-2 pr-1.5 font-mono text-[11px] tracking-tight text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
    >
      <span>{id}</span>
      {copied ? (
        <Check className="size-3 text-emerald-600" aria-hidden="true" />
      ) : (
        <Copy
          className="size-3 opacity-60 group-hover:opacity-100"
          aria-hidden="true"
        />
      )}
      <span
        className={cn(
          "overflow-hidden text-[10px] font-semibold uppercase tracking-wide text-emerald-600 transition-all",
          copied ? "w-[42px] opacity-100" : "w-0 opacity-0",
        )}
      >
        copied
      </span>
    </button>
  );
}

function SendingChip({ active }: { readonly active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full py-0.5 pl-1.5 pr-2 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset",
        active
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : "bg-slate-100 text-slate-500 ring-slate-200",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          active ? "bg-emerald-500" : "bg-slate-300",
        )}
      />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function WebhookIndicator({ value }: { readonly value: string | null }) {
  const relative = relativeTime(value);
  return (
    <span
      title={
        value === null
          ? "No webhook has ever reached this template. Normal until the Salesforce flow is wired."
          : `Last webhook received ${new Date(value).toLocaleString()}`
      }
      className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-500"
    >
      <Clock3 className={cn("size-3", value === null && "opacity-50")} />
      <span
        className={cn(
          value === null &&
            "decoration-dotted underline underline-offset-2 decoration-slate-400/50 text-slate-400",
          value !== null && "text-slate-700",
        )}
      >
        {relative ?? "No webhook yet"}
      </span>
    </span>
  );
}

function TemplateListRow({
  projectId,
  template,
  showDivider,
}: {
  readonly projectId: string;
  readonly template: AutomatedEmailTemplateListItemViewModel;
  readonly showDivider: boolean;
}) {
  const router = useRouter();
  const href = `/settings/projects/${encodeURIComponent(projectId)}/automated-emails/${encodeURIComponent(template.id)}`;

  function openTemplate() {
    router.push(href);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openTemplate}
      onKeyDown={(event) => {
        if (event.currentTarget !== event.target) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openTemplate();
        }
      }}
      className={cn(
        "grid cursor-pointer grid-cols-[minmax(0,1fr)_190px_150px_20px] items-center gap-4 px-4 py-3 transition-colors hover:bg-slate-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400",
        showDivider && "border-b border-slate-200/70",
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200">
          <Mail className="size-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-medium text-slate-900">
              {template.name}
            </span>
            {template.hasUnpublishedChanges ? (
              <StatusBadge
                label="Unpublished changes"
                variant="soft"
                colorClasses="shrink-0 rounded bg-amber-50 text-amber-700 ring-amber-200"
              />
            ) : null}
          </span>
          <span className="mt-1 block">
            <CopyIdChip id={template.id} />
          </span>
        </span>
      </span>
      <span>
        <SendingChip active={template.isActive} />
      </span>
      <WebhookIndicator value={template.lastReceivedAt} />
      <ChevronRight className="size-4 text-slate-300" aria-hidden="true" />
    </div>
  );
}

function NewTemplatesDialog({
  data,
  initialCustom,
  onClose,
}: {
  readonly data: AutomatedEmailListViewModel;
  readonly initialCustom: boolean;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const initialKinds: readonly Exclude<AutomatedEmailKind, "custom">[] =
    initialCustom ? [] : ["application_received", "accepted"];
  const [selectedKinds, setSelectedKinds] =
    useState(initialKinds);
  const [includeCustom, setIncludeCustom] = useState(initialCustom);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sourceProjectByKind = useMemo(
    () =>
      Object.fromEntries(
        data.kindSources.map((source) => [
          source.kind,
          source.sourceProjectName,
        ]),
      ) as Partial<
        Record<Exclude<AutomatedEmailKind, "custom">, string | null>
      >,
    [data.kindSources],
  );
  const count = selectedKinds.length + (includeCustom ? 1 : 0);

  function handleCreate() {
    if (count === 0) return;
    setMessage(null);
    startTransition(async () => {
      const result = await createFromKindsAction({
        projectId: data.projectId,
        kinds: selectedKinds,
        includeCustom,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={!pending}
        className="flex max-h-[88vh] w-[min(760px,94vw)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0"
      >
        <DialogHeader className="border-b border-slate-200 px-6 py-4">
          <DialogTitle className="text-[14.5px]">
            New automated emails
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            {data.projectName}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-auto px-6 py-5">
          <AutomatedEmailKindsChecklist
            selectedKinds={selectedKinds}
            onSelectedKindsChange={setSelectedKinds}
            includeCustom={includeCustom}
            onIncludeCustomChange={setIncludeCustom}
            sourceProjectByKind={sourceProjectByKind}
          />
          {message !== null ? (
            <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-800 ring-1 ring-inset ring-rose-200">
              {message}
            </p>
          ) : null}
        </div>
        <DialogFooter className="items-center justify-between border-t border-slate-200 bg-slate-50/80 px-6 py-3.5 sm:justify-between sm:space-x-0">
          <span className="max-w-[440px] text-[11.5px] text-slate-500">
            Shells are created inactive — nothing sends until you publish and
            activate each one.
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleCreate}
              disabled={pending || count === 0}
            >
              Create {String(count)} template{count === 1 ? "" : "s"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyTemplates({
  onCreate,
}: {
  readonly onCreate: (custom: boolean) => void;
}) {
  const steps = [
    [
      "Create the shells here",
      "Pick the lifecycle moments this project sends. They start inactive.",
    ],
    [
      "Ricky wires the flow",
      "He copies each template ID into the matching Salesforce flow.",
    ],
    [
      "Dry-run it",
      "Webhooks land in the send log while inactive — you see exactly what would have gone out.",
    ],
    ["Activate", "Flip the switch and real email starts sending."],
  ] as const;

  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-8">
      <div className="mx-auto max-w-[560px] text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-white text-slate-400 ring-1 ring-inset ring-slate-200">
          <Mail className="size-4" aria-hidden="true" />
        </span>
        <h2 className="mt-3 text-[14px] font-semibold text-slate-900">
          No automated emails yet
        </h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">
          Create the templates here, Ricky wires the Salesforce flow to them,
          you dry-run the result, then you turn sending on.
        </p>
      </div>
      <div className="mx-auto mt-6 grid max-w-[720px] grid-cols-4 gap-3">
        {steps.map(([title, description], index) => (
          <div
            key={title}
            className="rounded-lg border border-slate-200 bg-white px-3 py-3"
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
              {String(index + 1)}
            </span>
            <p className="mt-2 text-[12px] font-medium text-slate-900">
              {title}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
              {description}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-6 flex justify-center gap-2">
        <Button type="button" size="sm" onClick={() => { onCreate(false); }}>
          <Plus className="size-3.5" aria-hidden="true" /> New automated email
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => { onCreate(true); }}
        >
          Start from blank
        </Button>
      </div>
    </div>
  );
}

export function AutomatedEmailTemplateList({
  data,
}: {
  readonly data: AutomatedEmailListViewModel;
}) {
  const [createRequest, setCreateRequest] = useState<{
    readonly custom: boolean;
  } | null>(null);

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-[15px] font-semibold text-slate-900">
              Automated emails
            </h1>
            <p className="mt-0.5 max-w-[54ch] text-[12.5px] leading-relaxed text-slate-500">
              Transactional email Salesforce fires at lifecycle moments. You own
              the copy here; the flow that triggers it lives in Salesforce.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => { setCreateRequest({ custom: true }); }}
            >
              Blank template
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => { setCreateRequest({ custom: false }); }}
            >
              <Plus className="size-3.5" aria-hidden="true" /> New automated
              email
            </Button>
          </div>
        </div>

        {data.templates.length === 0 ? (
          <EmptyTemplates onCreate={(custom) => { setCreateRequest({ custom }); }} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-[minmax(0,1fr)_190px_150px_20px] items-center gap-4 border-b border-slate-200 bg-slate-50/70 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <span>Template</span>
              <span>Status</span>
              <span>Last sent</span>
              <span />
            </div>
            {data.templates.map((template, index) => (
              <TemplateListRow
                key={template.id}
                projectId={data.projectId}
                template={template}
                showDivider={index < data.templates.length - 1}
              />
            ))}
          </div>
        )}
      </div>

      {createRequest !== null ? (
        <NewTemplatesDialog
          data={data}
          initialCustom={createRequest.custom}
          onClose={() => { setCreateRequest(null); }}
        />
      ) : null}
    </>
  );
}
