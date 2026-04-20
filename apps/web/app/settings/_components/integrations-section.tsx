"use client";

import { useState, useTransition } from "react";

import {
  RADIUS,
  SHADOW,
  TEXT,
  TRANSITION
} from "@/app/_lib/design-tokens";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ToneAvatar } from "@/components/ui/tone-avatar";
import { cn } from "@/lib/utils";

import {
  connectIntegrationAction,
  disconnectIntegrationAction,
  reconfigureIntegrationAction
} from "../actions";
import type {
  MockIntegration,
  MockIntegrationCategory,
  MockIntegrationStatus
} from "../_lib/mock-data";
import { SettingsSection } from "./settings-section";

interface IntegrationsSectionProps {
  readonly integrations: readonly MockIntegration[];
  readonly isAdmin: boolean;
}

interface FeedbackState {
  readonly kind: "success" | "error";
  readonly message: string;
}

const CATEGORY_TONE: Record<
  MockIntegrationCategory,
  "indigo" | "emerald" | "amber" | "sky" | "violet" | "teal"
> = {
  crm: "sky",
  messaging: "indigo",
  knowledge: "violet",
  ai: "emerald"
};

const CATEGORY_LABEL: Record<MockIntegrationCategory, string> = {
  crm: "CRM",
  messaging: "Messaging",
  knowledge: "Knowledge",
  ai: "AI"
};

const STATUS_META: Record<
  MockIntegrationStatus,
  { readonly label: string; readonly colorClasses: string }
> = {
  connected: {
    label: "Connected",
    colorClasses: "bg-emerald-50 text-emerald-700 ring-emerald-200"
  },
  degraded: {
    label: "Degraded",
    colorClasses: "bg-amber-50 text-amber-800 ring-amber-200"
  },
  disconnected: {
    label: "Disconnected",
    colorClasses: "bg-rose-50 text-rose-700 ring-rose-200"
  },
  not_configured: {
    label: "Not configured",
    colorClasses: "bg-slate-100 text-slate-600 ring-slate-200"
  }
};

function formatRelative(iso: string | null): string {
  if (iso === null) return "Never synced";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const now = Date.now();
  const diffMs = now - then;
  if (diffMs < 0) return "Just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `Synced ${String(days)}d ago`;
}

export function IntegrationsSection({
  integrations,
  isAdmin
}: IntegrationsSectionProps) {
  const [items, setItems] = useState(integrations);
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  function announce(message: string, kind: FeedbackState["kind"] = "success") {
    setFeedback({ kind, message });
    window.setTimeout(() => {
      setFeedback(null);
    }, 3500);
  }

  function handleConnect(integration: MockIntegration) {
    setPendingId(integration.id);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", integration.id);
      const result = await connectIntegrationAction(formData);
      setPendingId(null);
      if (result.ok) {
        setItems((current) =>
          current.map((item) =>
            item.id === integration.id
              ? {
                  ...item,
                  status: "connected",
                  lastSyncAt: new Date().toISOString()
                }
              : item
          )
        );
        announce(`Connected ${integration.name}. (stub)`);
      }
    });
  }

  function handleReconfigure(integration: MockIntegration) {
    setPendingId(integration.id);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", integration.id);
      const result = await reconfigureIntegrationAction(formData);
      setPendingId(null);
      if (result.ok) {
        announce(`Reconfigure ${integration.name} — not wired yet. (stub)`);
      }
    });
  }

  function handleDisconnect(integration: MockIntegration) {
    setPendingId(integration.id);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", integration.id);
      const result = await disconnectIntegrationAction(formData);
      setPendingId(null);
      if (result.ok) {
        setItems((current) =>
          current.map((item) =>
            item.id === integration.id
              ? { ...item, status: "disconnected", lastSyncAt: null }
              : item
          )
        );
        announce(`Disconnected ${integration.name}. (stub)`);
      }
    });
  }

  return (
    <SettingsSection
      id="settings-integrations"
      title="Integrations"
      description="Providers connected to your workspace. Authentication and configuration live here."
      feedback={feedback}
    >
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((integration) => {
          const statusMeta = STATUS_META[integration.status];
          const isRowPending = pending && pendingId === integration.id;

          return (
            <li
              key={integration.id}
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
                      {integration.name}
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
                    {integration.description}
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
                    {formatRelative(integration.lastSyncAt)}
                  </span>
                </div>

                {isAdmin && (
                  <IntegrationActionButton
                    integration={integration}
                    pending={isRowPending}
                    onConnect={() => {
                      handleConnect(integration);
                    }}
                    onReconfigure={() => {
                      handleReconfigure(integration);
                    }}
                    onDisconnect={() => {
                      handleDisconnect(integration);
                    }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </SettingsSection>
  );
}

interface IntegrationActionButtonProps {
  readonly integration: MockIntegration;
  readonly pending: boolean;
  readonly onConnect: () => void;
  readonly onReconfigure: () => void;
  readonly onDisconnect: () => void;
}

function IntegrationActionButton({
  integration,
  pending,
  onConnect,
  onReconfigure,
  onDisconnect
}: IntegrationActionButtonProps) {
  switch (integration.status) {
    case "connected":
      return (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onReconfigure}
            disabled={pending}
          >
            Reconfigure
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onDisconnect}
            disabled={pending}
            className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
          >
            Disconnect
          </Button>
        </div>
      );
    case "degraded":
      return (
        <Button
          type="button"
          size="sm"
          onClick={onReconfigure}
          disabled={pending}
        >
          Reconfigure
        </Button>
      );
    case "disconnected":
    case "not_configured":
      return (
        <Button
          type="button"
          size="sm"
          onClick={onConnect}
          disabled={pending}
        >
          Connect
        </Button>
      );
    default: {
      const _exhaustive: never = integration.status;
      return _exhaustive;
    }
  }
}
