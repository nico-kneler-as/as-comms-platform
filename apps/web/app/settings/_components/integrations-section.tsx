"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { RefreshCw } from "lucide-react";

import {
  RADIUS,
  SHADOW
} from "@/app/_lib/design-tokens-v2";
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
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${String(days)}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${String(months)}mo ago`;
  const years = Math.floor(days / 365);
  return `${String(years)}y ago`;
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
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((integration) => {
            const statusMeta = STATUS_META[integration.status];
            const isRowPending =
              pending && pendingId === integration.serviceName;
            const isSyncDisabled =
              !integration.supportsRefresh || isRowPending;
            const descriptionTerminator = /[.!?]$/.test(integration.description)
              ? ""
              : ".";
            const summary = integration.detail
              ? `${integration.description}${descriptionTerminator} ${integration.detail}`
              : integration.description;

            return (
              <li
                key={integration.serviceName}
                className={cn(
                  "flex min-h-full flex-col gap-3 border border-slate-200 bg-white p-4",
                  RADIUS.lg,
                  SHADOW.sm,
                  isRowPending && "opacity-60"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <IntegrationLogoMark integration={integration} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-[13.5px] font-semibold text-slate-900">
                          {integration.displayName}
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          {CATEGORY_LABEL[integration.category]}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12px] text-slate-500">
                        {summary}
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

                <div className="flex items-center justify-between gap-3 text-[11.5px] text-slate-500">
                  <span className="min-w-0 truncate tabular-nums">
                    Last checked · {formatRelative(integration.lastCheckedAt)}
                  </span>

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

const BRAND_LOGO: Partial<
  Record<IntegrationHealthViewModel["serviceName"], string>
> = {
  salesforce: "/integrations/salesforce.png",
  gmail: "/integrations/gmail.png",
  simpletexting: "/integrations/simpletexting.png",
  mailchimp: "/integrations/mailchimp.png",
  notion: "/integrations/notion.png",
  openai: "/integrations/anthropic.png"
};

function IntegrationLogoMark({
  integration
}: {
  readonly integration: IntegrationHealthViewModel;
}) {
  const logoSrc = BRAND_LOGO[integration.serviceName];

  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-slate-700 ring-1 ring-inset ring-slate-200/70">
      <span className="sr-only">{integration.displayName}</span>
      {logoSrc ? (
        <Image
          src={logoSrc}
          alt=""
          width={32}
          height={32}
          className="size-7 object-contain"
          aria-hidden="true"
        />
      ) : (
        <span
          className="inline-flex size-5 items-center justify-center text-[10px] font-semibold uppercase"
          aria-hidden="true"
        >
          {integration.serviceName.slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
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
      variant="outline"
      onClick={onSync}
      disabled={disabled}
      aria-label={`Refresh ${integrationName}`}
    >
      <RefreshCw
        className={cn("size-3", pending && "animate-spin")}
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
