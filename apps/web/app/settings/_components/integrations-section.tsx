"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";

import {
  RADIUS,
  SHADOW,
  TEXT,
  TRANSITION
} from "@/app/_lib/design-tokens";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ToneAvatar } from "@/components/ui/tone-avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  IntegrationHealthViewModel,
  IntegrationsSettingsViewModel
} from "@/src/server/settings/selectors";

import { refreshIntegrationHealthAction } from "../actions";
import { SettingsSection } from "./settings-section";

interface IntegrationsSectionProps {
  readonly viewModel: IntegrationsSettingsViewModel;
}

interface FeedbackState {
  readonly kind: "success" | "error";
  readonly message: string;
}

const CATEGORY_TONE: Record<
  IntegrationHealthViewModel["category"],
  "indigo" | "emerald" | "amber" | "sky" | "violet" | "teal"
> = {
  crm: "sky",
  messaging: "indigo",
  knowledge: "violet",
  ai: "emerald"
};

const CATEGORY_LABEL: Record<IntegrationHealthViewModel["category"], string> = {
  crm: "CRM",
  messaging: "Messaging",
  knowledge: "Knowledge",
  ai: "AI"
};

const STATUS_META: Record<
  IntegrationHealthViewModel["status"],
  { readonly label: string; readonly colorClasses: string }
> = {
  healthy: {
    label: "Healthy",
    colorClasses: "bg-emerald-50 text-emerald-700 ring-emerald-200"
  },
  needs_attention: {
    label: "Needs attention",
    colorClasses: "bg-amber-50 text-amber-800 ring-amber-200"
  },
  disconnected: {
    label: "Disconnected",
    colorClasses: "bg-rose-50 text-rose-700 ring-rose-200"
  },
  not_configured: {
    label: "Not configured",
    colorClasses: "bg-slate-100 text-slate-600 ring-slate-200"
  },
  not_checked: {
    label: "Not checked",
    colorClasses: "bg-slate-100 text-slate-700 ring-slate-200"
  }
};

function formatRelative(iso: string | null): string {
  if (iso === null) return "Never checked";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const now = Date.now();
  const diffMs = now - then;
  if (diffMs < 0) return "Just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Checked just now";
  if (minutes < 60) return `Checked ${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Checked ${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `Checked ${String(days)}d ago`;
}

export function IntegrationsSection({ viewModel }: IntegrationsSectionProps) {
  const [items, setItems] = useState(viewModel.integrations);
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  function announce(message: string, kind: FeedbackState["kind"] = "success") {
    setFeedback({ kind, message });
    window.setTimeout(() => {
      setFeedback(null);
    }, 3500);
  }

  function handleRefresh(integration: IntegrationHealthViewModel) {
    setPendingId(integration.serviceName);
    startTransition(async () => {
      const result = await refreshIntegrationHealthAction(integration.serviceName);
      setPendingId(null);

      if (result.ok) {
        setItems((current) =>
          current.map((item) =>
            item.serviceName === integration.serviceName
              ? {
                  ...item,
                  status: result.data.status,
                  detail: result.data.detail,
                  lastCheckedAt: result.data.lastCheckedAt
                }
              : item
          )
        );
        announce(`Refreshed ${integration.displayName}.`);
        return;
      }

      announce(result.message, "error");
    });
  }

  return (
    <TooltipProvider delayDuration={200}>
      <SettingsSection
        id="settings-integrations"
        title="Integrations"
        feedback={feedback}
      >
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((integration) => {
            const statusMeta = STATUS_META[integration.status];
            const isRowPending =
              pending && pendingId === integration.serviceName;
            const isSyncDisabled =
              !integration.supportsRefresh || isRowPending;

            return (
              <li
                key={integration.serviceName}
                className={cn(
                  "flex min-h-full flex-col gap-4 p-5",
                  RADIUS.md,
                  "border border-slate-200 bg-white",
                  SHADOW.sm,
                  TRANSITION.fast,
                  isRowPending && "opacity-60"
                )}
              >
                <div className="flex items-start gap-3">
                  <ToneAvatar
                    initials={integration.logo}
                    tone={CATEGORY_TONE[integration.category]}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {integration.displayName}
                      </p>
                      <span className={cn(TEXT.caption, "text-slate-500")}>
                        {CATEGORY_LABEL[integration.category]}
                      </span>
                    </div>
                    <p
                      className={cn(
                        "mt-1 line-clamp-2",
                        TEXT.bodySm,
                        "text-slate-600"
                      )}
                    >
                      {integration.detail ?? integration.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <StatusBadge
                      label={statusMeta.label}
                      colorClasses={statusMeta.colorClasses}
                      variant="soft"
                      className="self-start"
                    />
                    <span className={cn(TEXT.micro, "tabular-nums")}>
                      {formatRelative(integration.lastCheckedAt)}
                    </span>
                  </div>

                  {viewModel.isAdmin && (
                    <SyncButton
                      disabled={isSyncDisabled}
                      supportsRefresh={integration.supportsRefresh}
                      pending={isRowPending}
                      integrationName={integration.displayName}
                      onSync={() => {
                        handleRefresh(integration);
                      }}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </SettingsSection>
    </TooltipProvider>
  );
}

interface SyncButtonProps {
  readonly disabled: boolean;
  readonly supportsRefresh: boolean;
  readonly pending: boolean;
  readonly integrationName: string;
  readonly onSync: () => void;
}

function SyncButton({
  disabled,
  supportsRefresh,
  pending,
  integrationName,
  onSync
}: SyncButtonProps) {
  const button = (
    <Button
      type="button"
      size="sm"
      onClick={onSync}
      disabled={disabled}
      aria-label={`Refresh ${integrationName}`}
    >
      <RefreshCw
        className={cn("mr-1.5 h-3.5 w-3.5", pending && "animate-spin")}
        aria-hidden="true"
      />
      Refresh
    </Button>
  );

  if (supportsRefresh) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} aria-disabled="true" className="inline-flex">
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white"
      >
        Health checks are not wired for this provider yet.
      </TooltipContent>
    </Tooltip>
  );
}
