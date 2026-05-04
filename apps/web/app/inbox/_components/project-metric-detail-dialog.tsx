"use client";

import { useEffect, useRef, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  loadProjectMetricContacts,
  type ProjectMetricContactRow,
  type ProjectMetricKey,
} from "../actions";
import { InboxAvatar } from "./inbox-avatar";
import { XIcon } from "./icons";

interface ProjectMetricDetailDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenContact: (contactId: string) => void;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly metricKey: ProjectMetricKey | null;
  readonly metricLabel: string | null;
  readonly totalForDescription: number;
}

type LoadState =
  | {
      readonly status: "idle" | "loading";
      readonly rows: readonly ProjectMetricContactRow[];
    }
  | {
      readonly status: "loaded";
      readonly rows: readonly ProjectMetricContactRow[];
    }
  | {
      readonly status: "error";
      readonly rows: readonly ProjectMetricContactRow[];
    };

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function readDescription(total: number, metricKey: ProjectMetricKey | null): string {
  const personLabel = total === 1 ? "person" : "people";

  switch (metricKey) {
    case "signups":
      return `${total.toString()} ${personLabel} signed up`;
    case "trainingCompletions":
      return `${total.toString()} ${personLabel} completed training`;
    case "dataSubmissions":
      return `${total.toString()} ${personLabel} started submitting data`;
    default:
      return `${total.toString()} ${personLabel}`;
  }
}

function toInitials(label: string): string {
  const parts = label
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2);

  if (parts.length === 0) {
    return "??";
  }

  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function readRowTitle(row: ProjectMetricContactRow): string {
  const name = row.name?.trim() ?? "";
  if (name.length > 0) {
    return name;
  }

  const email = row.email?.trim() ?? "";
  if (email.length > 0) {
    return email;
  }

  return "Unknown contact";
}

function readRelativeDayLabel(occurredAtIso: string, now: Date): string {
  const occurredAt = new Date(occurredAtIso);
  if (Number.isNaN(occurredAt.getTime())) {
    return "";
  }

  const diffDays = Math.max(
    0,
    Math.floor((startOfUtcDay(now) - startOfUtcDay(occurredAt)) / 86_400_000),
  );
  return `${diffDays.toString()}d ago`;
}

function MetricContactRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-48" />
      </div>
      <Skeleton className="h-3 w-14 shrink-0" />
    </div>
  );
}

export function ProjectMetricDetailDialog({
  open,
  onOpenChange,
  onOpenContact,
  projectId,
  projectName,
  metricKey,
  metricLabel,
  totalForDescription,
}: ProjectMetricDetailDialogProps) {
  const [state, setState] = useState<LoadState>({
    status: "idle",
    rows: [],
  });
  const requestVersionRef = useRef(0);

  useEffect(() => {
    if (!open || projectId === null || metricKey === null) {
      requestVersionRef.current += 1;
      setState({
        status: "idle",
        rows: [],
      });
      return;
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setState({
      status: "loading",
      rows: [],
    });

    void loadProjectMetricContacts({
      projectId,
      metricKey,
    })
      .then((result) => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }

        setState({
          status: "loaded",
          rows: result.rows,
        });
      })
      .catch(() => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }

        setState({
          status: "error",
          rows: [],
        });
      });
  }, [metricKey, open, projectId]);

  const title =
    projectName !== null && metricLabel !== null
      ? `${projectName} · ${metricLabel} · last 7 days`
      : "Last 7 days";
  const description = readDescription(totalForDescription, metricKey);
  const now = new Date();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-2xl gap-0 overflow-hidden p-0"
      >
        <header className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="truncate text-lg leading-tight">
                {title}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {description}
              </DialogDescription>
            </div>
            <DialogClose
              type="button"
              aria-label="Close metric detail dialog"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
            >
              <XIcon className="size-4" />
            </DialogClose>
          </div>
        </header>

        <div className="max-h-[60vh] overflow-y-auto">
          {state.status === "loading"
            ? Array.from({ length: 8 }, (_, index) => (
                <MetricContactRowSkeleton key={`metric-skeleton-${index.toString()}`} />
              ))
            : null}

          {state.status === "error" ? (
            <p className="px-5 py-4 text-sm text-slate-500">
              Couldn&apos;t load this list. Try again.
            </p>
          ) : null}

          {state.status === "loaded" && state.rows.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-500">
              No people matched this metric in the last 7 days.
            </p>
          ) : null}

          {state.status === "loaded"
            ? state.rows.map((row) => {
                const titleText = readRowTitle(row);
                const showEmailSubtitle =
                  row.name !== null &&
                  row.name.trim().length > 0 &&
                  row.email !== null &&
                  row.email.trim().length > 0;

                return (
                  <button
                    key={row.contactId}
                    type="button"
                    onClick={() => {
                      onOpenContact(row.contactId);
                      onOpenChange(false);
                    }}
                    className="flex w-full items-center gap-3 border-b border-slate-100 px-5 py-3 text-left transition-colors hover:bg-slate-50"
                  >
                    <InboxAvatar
                      initials={toInitials(titleText)}
                      tone="slate"
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {titleText}
                      </p>
                      {showEmailSubtitle ? (
                        <p className="truncate text-sm text-slate-500">
                          {row.email}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">
                      {readRelativeDayLabel(row.occurredAt, now)}
                    </span>
                  </button>
                );
              })
            : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
