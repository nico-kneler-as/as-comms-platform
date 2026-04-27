"use client";

import { useState, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";

import { RADIUS, SHADOW, TYPE } from "@/app/_lib/design-tokens-v2";
import { inviteUserAction } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type InviteRole = "operator" | "admin";

interface TeammateInviteModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

const EMAIL_DOMAIN = "@adventurescientists.org";

const ROLE_OPTIONS = [
  {
    value: "operator",
    label: "Operator",
    description: "Read, reply, and manage conversations.",
  },
  {
    value: "admin",
    label: "Admin",
    description: "Full access - manage projects, teammates, integrations.",
  },
] as const satisfies readonly {
  readonly value: InviteRole;
  readonly label: string;
  readonly description: string;
}[];

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function roleToActionValue(role: InviteRole): "admin" | "internal_user" {
  return role === "admin" ? "admin" : "internal_user";
}

export function TeammateInviteModal({
  open,
  onClose,
}: TeammateInviteModalProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("operator");
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const normalizedEmail = normalizeEmail(email);
  const emailHasValue = email.trim().length > 0;
  const emailIsValid =
    normalizedEmail.length > 0 && normalizedEmail.endsWith(EMAIL_DOMAIN);
  const showEmailDomainError = emailHasValue && !emailIsValid;
  const sendDisabled = isPending || !emailIsValid;

  function resetForm() {
    setEmail("");
    setRole("operator");
    setErrorMessage(null);
  }

  function handleClose() {
    if (isPending) {
      return;
    }

    resetForm();
    onClose();
  }

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (!emailIsValid) {
      return;
    }

    setIsPending(true);
    try {
      const formData = new FormData();
      formData.set("email", normalizedEmail);
      formData.set("role", roleToActionValue(role));

      const result = await inviteUserAction(formData);
      if (!result.ok) {
        setErrorMessage(result.fieldErrors?.email ?? result.message);
        return;
      }

      resetForm();
      onClose();
      router.refresh();
    } catch {
      setErrorMessage("Invite failed. Try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleClose();
        }
      }}
    >
      <DialogContent
        className={cn(
          "w-[min(92vw,440px)] gap-0 border-0 p-0 ring-1 ring-slate-200 [&>button]:hidden",
          RADIUS.lg,
          SHADOW.lg,
        )}
        onEscapeKeyDown={(event) => {
          if (isPending) {
            event.preventDefault();
          }
        }}
        onPointerDownOutside={(event) => {
          if (isPending) {
            event.preventDefault();
          }
        }}
      >
        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-5 p-6">
            <div className="flex flex-col gap-1.5">
              <DialogTitle className={cn(TYPE.headingMd, "text-balance")}>
                Invite teammate
              </DialogTitle>
              <DialogDescription className={cn(TYPE.bodySm, "text-pretty")}>
                They'll link automatically on their first Google sign-in.
              </DialogDescription>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="teammate-invite-email" className={TYPE.label}>
                Email
              </label>
              <Input
                id="teammate-invite-email"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setErrorMessage(null);
                }}
                placeholder="teammate@adventurescientists.org"
                disabled={isPending}
                aria-invalid={showEmailDomainError}
                aria-describedby="teammate-invite-email-helper"
              />
              <p
                id="teammate-invite-email-helper"
                className={cn(
                  TYPE.caption,
                  showEmailDomainError ? "text-rose-700" : "text-slate-500",
                )}
              >
                Must be an @adventurescientists.org address.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <p className={TYPE.label}>Role</p>
              <div
                role="radiogroup"
                aria-label="Invite teammate role"
                className="flex flex-col gap-2"
              >
                {ROLE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={role === option.value}
                    disabled={isPending}
                    onClick={() => {
                      setRole(option.value);
                      setErrorMessage(null);
                    }}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3.5 text-left hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60",
                      role === option.value &&
                        "border-slate-900 ring-1 ring-slate-900",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 flex size-4 items-center justify-center rounded-full border",
                        role === option.value
                          ? "border-slate-900"
                          : "border-slate-300",
                      )}
                    >
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          role === option.value
                            ? "bg-slate-900"
                            : "bg-transparent",
                        )}
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-slate-900">
                        {option.label}
                      </span>
                      <span className={cn("mt-0.5 block", TYPE.caption)}>
                        {option.description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {errorMessage ? (
              <p role="alert" className={cn(TYPE.bodySm, "text-rose-700")}>
                {errorMessage}
              </p>
            ) : null}
          </div>

          <DialogFooter className="flex-row justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={sendDisabled}>
              <UserPlus data-icon="inline-start" aria-hidden="true" />
              {isPending ? "Sending..." : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
