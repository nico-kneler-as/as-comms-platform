"use client";

import { useState, useTransition } from "react";

import { RADIUS, SHADOW, TYPE } from "@/app/_lib/design-tokens-v2";
import { createOrgSenderAction, setOrgSenderEnabledAction } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { OrgSendersSettingsViewModel } from "@/src/server/settings/selectors";

import { SettingsSection } from "./settings-section";

interface FeedbackState {
  readonly kind: "success" | "error";
  readonly message: string;
}

const ENABLED_STATUS_META = {
  label: "Enabled",
  colorClasses: "bg-emerald-50 text-emerald-700 ring-emerald-200"
} as const;

const DISABLED_STATUS_META = {
  label: "Disabled",
  colorClasses: "bg-slate-100 text-slate-700 ring-slate-200"
} as const;

export function NewsletterSection({
  viewModel
}: {
  readonly viewModel: OrgSendersSettingsViewModel;
}) {
  const [orgSenders, setOrgSenders] = useState(viewModel.orgSenders);
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pending, startTransition] = useTransition();

  function announce(message: string, kind: FeedbackState["kind"] = "success") {
    setFeedback({ kind, message });
    window.setTimeout(() => {
      setFeedback(null);
    }, 3500);
  }

  function resetForm() {
    setEmail("");
    setLabel("");
    setFieldErrors({});
  }

  function handleCreate() {
    setFieldErrors({});
    setSubmitting(true);

    startTransition(async () => {
      try {
        const result = await createOrgSenderAction({ email, label });

        if (!result.ok) {
          setFieldErrors(result.fieldErrors ?? {});
          announce(result.message, "error");
          return;
        }

        setOrgSenders((current) => [...current, result.data]);
        resetForm();
        announce(`${result.data.email} added.`);
      } catch {
        announce("Unable to add that sender right now.", "error");
      } finally {
        setSubmitting(false);
      }
    });
  }

  function handleToggle(id: string, enabled: boolean) {
    setPendingToggleId(id);

    startTransition(async () => {
      try {
        const result = await setOrgSenderEnabledAction(id, enabled);

        if (!result.ok) {
          announce(result.message, "error");
          return;
        }

        setOrgSenders((current) =>
          current.map((sender) =>
            sender.id === result.data.id
              ? {
                  ...sender,
                  enabled: result.data.enabled
                }
              : sender
          )
        );
        announce(enabled ? "Sender enabled." : "Sender disabled.");
      } catch {
        announce("Unable to update that sender right now.", "error");
      } finally {
        setPendingToggleId(null);
      }
    });
  }

  return (
    <SettingsSection
      id="settings-newsletter"
      title="Newsletter"
      description="Organization-wide sender identities for broadcast email"
      feedback={feedback}
    >
      <div className="flex flex-col gap-6">
        <div
          className={cn(
            "rounded-xl border border-sky-200 bg-sky-50/70 px-4 py-3 text-sm text-sky-900",
            SHADOW.sm
          )}
        >
          Org senders send from the Postmark-verified domain adventurescientists.org.
        </div>

        <div
          className={cn(
            "overflow-hidden",
            RADIUS.lg,
            "border border-slate-200 bg-white",
            SHADOW.sm
          )}
        >
          <ul className="divide-y divide-slate-100" data-testid="newsletter-senders-list">
            {orgSenders.map((sender) => {
              const statusMeta = sender.enabled ? ENABLED_STATUS_META : DISABLED_STATUS_META;
              const rowPending = pending && pendingToggleId === sender.id;

              return (
                <li
                  key={sender.id}
                  className={cn(
                    "flex flex-wrap items-center gap-3 px-5 py-3",
                    rowPending && "opacity-60"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold text-slate-900">
                      {sender.email}
                    </p>
                    <p className={cn("mt-0.5 truncate text-slate-500", TYPE.caption)}>
                      {sender.label}
                    </p>
                  </div>
                  <StatusBadge
                    label={statusMeta.label}
                    colorClasses={statusMeta.colorClasses}
                    variant="soft"
                  />
                  {viewModel.isAdmin ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={rowPending}
                      onClick={() => {
                        handleToggle(sender.id, !sender.enabled);
                      }}
                    >
                      {sender.enabled ? "Disable" : "Enable"}
                    </Button>
                  ) : null}
                </li>
              );
            })}

            {orgSenders.length === 0 ? (
              <li className="px-5 py-10 text-center">
                <p className={TYPE.caption}>No org senders have been added yet.</p>
              </li>
            ) : null}
          </ul>
        </div>

        {viewModel.isAdmin ? (
          <form
            className={cn(
              "grid gap-4",
              RADIUS.lg,
              "border border-slate-200 bg-white p-5",
              SHADOW.sm
            )}
            onSubmit={(event) => {
              event.preventDefault();
              handleCreate();
            }}
          >
            <div className="grid gap-1.5">
              <label htmlFor="newsletter-sender-email" className={TYPE.label}>
                Sender email
              </label>
              <Input
                id="newsletter-sender-email"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setFieldErrors((current) => ({ ...current, email: "" }));
                }}
                placeholder="info@adventurescientists.org"
                disabled={submitting}
                aria-invalid={Boolean(fieldErrors.email)}
              />
              {fieldErrors.email ? (
                <p role="alert" className={cn(TYPE.caption, "text-rose-700")}>
                  {fieldErrors.email}
                </p>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="newsletter-sender-label" className={TYPE.label}>
                Label
              </label>
              <Input
                id="newsletter-sender-label"
                value={label}
                onChange={(event) => {
                  setLabel(event.target.value);
                  setFieldErrors((current) => ({ ...current, label: "" }));
                }}
                placeholder="Adventure Scientists"
                disabled={submitting}
                aria-invalid={Boolean(fieldErrors.label)}
              />
              {fieldErrors.label ? (
                <p role="alert" className={cn(TYPE.caption, "text-rose-700")}>
                  {fieldErrors.label}
                </p>
              ) : null}
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={submitting || pending}>
                {submitting ? "Adding..." : "Add sender"}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </SettingsSection>
  );
}
