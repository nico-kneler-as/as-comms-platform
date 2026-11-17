"use client";

import { useState, useTransition } from "react";

import { RADIUS, SHADOW, TYPE } from "@/app/_lib/design-tokens-v2";
import {
  createOrgSenderAction,
  setOrgSenderDisplayNameAction,
  setOrgSenderPresentationAction,
  setOrgSenderEnabledAction
} from "@/app/settings/actions";
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
  const [displayName, setDisplayName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [signatureEditingId, setSignatureEditingId] = useState<string | null>(null);
  const [signatureDraft, setSignatureDraft] = useState("");
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
    setDisplayName("");
    setFieldErrors({});
  }

  function handleCreate() {
    setFieldErrors({});
    setSubmitting(true);

    startTransition(async () => {
      try {
        const result = await createOrgSenderAction({ email, label, displayName });

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

  function handleRename(id: string) {
    setPendingToggleId(id);

    startTransition(async () => {
      try {
        const result = await setOrgSenderDisplayNameAction(id, editingName);

        if (!result.ok) {
          announce(result.message, "error");
          return;
        }

        setOrgSenders((current) =>
          current.map((sender) =>
            sender.id === result.data.id
              ? { ...sender, displayName: result.data.displayName }
              : sender
          )
        );
        setEditingId(null);
        announce("Sender name updated.");
      } catch {
        announce("Unable to update that sender right now.", "error");
      } finally {
        setPendingToggleId(null);
      }
    });
  }

  function handlePresentation(
    id: string,
    input: { readonly signature?: string; readonly minimalFooter?: boolean }
  ) {
    setPendingToggleId(id);

    startTransition(async () => {
      try {
        const result = await setOrgSenderPresentationAction(id, input);

        if (!result.ok) {
          announce(result.message, "error");
          return;
        }

        setOrgSenders((current) =>
          current.map((sender) =>
            sender.id === result.data.id
              ? {
                  ...sender,
                  signature: result.data.signature,
                  minimalFooter: result.data.minimalFooter
                }
              : sender
          )
        );
        setSignatureEditingId(null);
        announce(
          input.minimalFooter === undefined
            ? "Signature updated."
            : input.minimalFooter
              ? "Footer set to Unsubscribe only."
              : "Standard footer restored."
        );
      } catch {
        announce("Unable to update that sender right now.", "error");
      } finally {
        setPendingToggleId(null);
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
                    {editingId === sender.id ? (
                      <form
                        className="mt-2 flex flex-wrap items-center gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          handleRename(sender.id);
                        }}
                      >
                        <Input
                          aria-label={`Sender name for ${sender.email}`}
                          value={editingName}
                          onChange={(event) => {
                            setEditingName(event.target.value);
                          }}
                          disabled={rowPending}
                          className="max-w-xs"
                        />
                        <Button type="submit" disabled={rowPending}>
                          Save
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setEditingId(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <p className={cn("mt-0.5 truncate text-slate-700", TYPE.caption)}>
                        Shows as <span className="font-medium">{sender.displayName}</span>
                        {viewModel.isAdmin ? (
                          <button
                            type="button"
                            className="ml-2 text-slate-500 underline underline-offset-2 hover:text-slate-800"
                            onClick={() => {
                              setEditingId(sender.id);
                              setEditingName(sender.displayName);
                            }}
                          >
                            Edit
                          </button>
                        ) : null}
                      </p>
                    )}
                    {signatureEditingId === sender.id ? (
                      <form
                        className="mt-2 grid max-w-md gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          handlePresentation(sender.id, { signature: signatureDraft });
                        }}
                      >
                        <textarea
                          aria-label={`Signature for ${sender.email}`}
                          value={signatureDraft}
                          onChange={(event) => {
                            setSignatureDraft(event.target.value);
                          }}
                          rows={4}
                          maxLength={2000}
                          disabled={rowPending}
                          className="rounded-md border border-slate-300 px-3 py-2 text-[13px] text-slate-900"
                        />
                        <div className="flex gap-2">
                          <Button type="submit" disabled={rowPending}>
                            Save signature
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setSignatureEditingId(null);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <p className={cn("mt-0.5 text-slate-500", TYPE.caption)}>
                        {sender.signature.trim().length > 0
                          ? "Signature set for plain emails"
                          : "No signature"}
                        {viewModel.isAdmin ? (
                          <button
                            type="button"
                            className="ml-2 text-slate-500 underline underline-offset-2 hover:text-slate-800"
                            onClick={() => {
                              setSignatureEditingId(sender.id);
                              setSignatureDraft(sender.signature);
                            }}
                          >
                            {sender.signature.trim().length > 0 ? "Edit" : "Add"}
                          </button>
                        ) : null}
                      </p>
                    )}
                    <label className={cn("mt-1 inline-flex items-center gap-2 text-slate-600", TYPE.caption)}>
                      <input
                        type="checkbox"
                        checked={sender.minimalFooter}
                        disabled={!viewModel.isAdmin || rowPending}
                        onChange={(event) => {
                          handlePresentation(sender.id, {
                            minimalFooter: event.target.checked
                          });
                        }}
                      />
                      Footer: Unsubscribe link only (no address, no &quot;view in browser&quot;)
                    </label>
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

            <div className="grid gap-1.5">
              <label htmlFor="newsletter-sender-display-name" className={TYPE.label}>
                Sender name
              </label>
              <Input
                id="newsletter-sender-display-name"
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setFieldErrors((current) => ({ ...current, displayName: "" }));
                }}
                placeholder="Adventure Scientists"
                disabled={submitting}
                aria-invalid={Boolean(fieldErrors.displayName)}
              />
              <p className={cn(TYPE.caption, "text-slate-500")}>
                How this sender appears in the recipient&apos;s inbox, e.g. &quot;Gregg Treinish&quot;. Replies go to the sender email.
              </p>
              {fieldErrors.displayName ? (
                <p role="alert" className={cn(TYPE.caption, "text-rose-700")}>
                  {fieldErrors.displayName}
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
