"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";

import {
  RADIUS,
  SHADOW,
  TONE_CLASSES,
  TRANSITION,
  TYPE
} from "@/app/_lib/design-tokens-v2";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
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
            const categoryTone = TONE_CLASSES[CATEGORY_TONE[integration.category]];
            const isRowPending =
              pending && pendingId === integration.serviceName;
            const isSyncDisabled =
              !integration.supportsRefresh || isRowPending;

            return (
              <li
                key={integration.serviceName}
                className={cn(
                  "flex min-h-full flex-col gap-4 border border-slate-200 bg-white p-4",
                  RADIUS.md,
                  SHADOW.sm,
                  TRANSITION.layout,
                  TRANSITION.reduceMotion,
                  "hover:-translate-y-0.5 hover:border-slate-300",
                  isRowPending && "opacity-60"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <IntegrationLogoMark integration={integration} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {integration.displayName}
                        </p>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]",
                            categoryTone.subtle,
                            categoryTone.text
                          )}
                        >
                          {CATEGORY_LABEL[integration.category]}
                        </span>
                      </div>
                      <p className={cn("mt-1", TYPE.caption, "text-slate-600")}>
                        {integration.description}
                      </p>
                    </div>
                  </div>

                  <StatusBadge
                    label={statusMeta.label}
                    colorClasses={statusMeta.colorClasses}
                    variant="soft"
                    className="shrink-0"
                  />
                </div>

                <div
                  className={cn(
                    "flex min-h-16 items-center rounded-xl px-3 py-2.5",
                    categoryTone.subtle
                  )}
                >
                  <p
                    className={cn(
                      "line-clamp-2",
                      TYPE.bodySm,
                      integration.detail ? "text-slate-700" : "text-slate-500"
                    )}
                  >
                    {integration.detail ?? "Waiting for the next health check."}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className={cn(TYPE.label, "text-slate-400")}>
                      Last checked
                    </span>
                    <span className={cn(TYPE.micro, "tabular-nums text-slate-500")}>
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

function IntegrationLogoMark({
  integration
}: {
  readonly integration: IntegrationHealthViewModel;
}) {
  return (
    <Avatar className="size-11 rounded-2xl border border-slate-200 bg-transparent">
      <AvatarFallback
        delayMs={0}
        className="rounded-2xl bg-transparent text-slate-900"
      >
        <span className="sr-only">{integration.displayName}</span>
        <BrandMark serviceName={integration.serviceName} />
      </AvatarFallback>
    </Avatar>
  );
}

function BrandMark({
  serviceName
}: {
  readonly serviceName: IntegrationHealthViewModel["serviceName"];
}) {
  switch (serviceName) {
    case "salesforce":
      return (
        <svg viewBox="0 0 48 48" className="size-8" aria-hidden="true">
          <path
            d="M16.6 31.9c-4.1 0-7.4-3-7.4-6.8 0-3.5 2.8-6.4 6.5-6.8.8-4.1 4.6-7.2 9.2-7.2 5.1 0 9.3 3.9 9.5 8.8 3 .8 5.2 3.4 5.2 6.5 0 3.8-3.2 6.8-7.2 6.8H16.6Z"
            fill="#00A1E0"
          />
          <text
            x="24"
            y="29"
            textAnchor="middle"
            className="fill-white text-[11px] font-bold"
          >
            sf
          </text>
        </svg>
      );
    case "gmail":
      return (
        <svg viewBox="0 0 48 48" className="size-8" aria-hidden="true">
          <path
            d="M9 14.5 24 26l15-11.5"
            fill="none"
            stroke="#EA4335"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M9 14.5v19h8.5V22.3L24 27l6.5-4.7v11.2H39v-19"
            fill="none"
            stroke="#34A853"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M9 14.5 24 26l15-11.5"
            fill="none"
            stroke="#4285F4"
            strokeWidth="2"
            opacity="0.65"
          />
          <path
            d="M9 14.5v19"
            fill="none"
            stroke="#FBBC05"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      );
    case "simpletexting":
      return (
        <svg viewBox="0 0 48 48" className="size-8" aria-hidden="true">
          <rect x="8" y="10" width="25" height="18" rx="8" fill="#1D4ED8" />
          <path d="M18 28h8l6 8v-8" fill="#1D4ED8" />
          <rect x="16" y="16" width="10" height="3" rx="1.5" fill="white" />
          <rect
            x="16"
            y="22"
            width="14"
            height="3"
            rx="1.5"
            fill="white"
            opacity="0.78"
          />
        </svg>
      );
    case "mailchimp":
      return (
        <svg viewBox="0 0 48 48" className="size-8" aria-hidden="true">
          <circle cx="24" cy="24" r="12" fill="#FACC15" />
          <path
            d="M18 28c1.8 2.3 4 3.5 6 3.5s4.2-1.2 6-3.5"
            fill="none"
            stroke="#111827"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx="20" cy="21" r="1.8" fill="#111827" />
          <circle cx="28" cy="21" r="1.8" fill="#111827" />
          <path
            d="M30.8 15.3c2.4-.4 4.7.9 5.8 3"
            fill="none"
            stroke="#111827"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );
    case "notion":
      return (
        <svg viewBox="0 0 48 48" className="size-8" aria-hidden="true">
          <rect
            x="11"
            y="11"
            width="26"
            height="26"
            rx="3"
            fill="white"
            stroke="#111827"
            strokeWidth="2.5"
          />
          <path
            d="M18 31V18l12 13V18"
            fill="none"
            stroke="#111827"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "openai":
      return (
        <svg viewBox="0 0 48 48" className="size-8" aria-hidden="true">
          <g
            fill="none"
            stroke="#111827"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M24 11c3.6 0 6.6 2.9 6.6 6.5v2.1" />
            <path d="M35.1 18.7c1.8 3.2.8 7.3-2.3 9.1L31 28.9" />
            <path d="M33 31.5c-1.8 3.2-5.9 4.3-9.1 2.5L22 32.9" />
            <path d="M18 34c-3.6 0-6.6-2.9-6.6-6.5v-2.1" />
            <path d="M12.9 29.3c-1.8-3.2-.8-7.3 2.3-9.1L17 19.1" />
            <path d="M15 16.5c1.8-3.2 5.9-4.3 9.1-2.5L26 15.1" />
          </g>
          <path
            d="M18.5 18.5 29.5 29.5"
            stroke="#D97706"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      );
    default:
      return (
        <span className="text-xs font-semibold">
          {serviceName.slice(0, 2).toUpperCase()}
        </span>
      );
  }
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
