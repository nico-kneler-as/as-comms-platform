"use client";

import { useState, useTransition } from "react";

import {
  RADIUS,
  SHADOW,
  TYPE,
  TRANSITION
} from "@/app/_lib/design-tokens-v2";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ToneAvatar } from "@/components/ui/tone-avatar";
import { cn } from "@/lib/utils";
import type {
  AccessSettingsViewModel,
  UserRowViewModel
} from "@/src/server/settings/selectors";

import {
  deactivateUserAction,
  demoteUserAction,
  inviteUserAction,
  promoteUserAction,
  reactivateUserAction,
  type UserMutationData
} from "../actions";
import { SettingsSection } from "./settings-section";

const AVATAR_TONES = [
  "indigo",
  "emerald",
  "amber",
  "rose",
  "sky",
  "violet",
  "teal"
] as const;

type AvatarTone = (typeof AVATAR_TONES)[number];
type ManagedRole = "admin" | "internal_user";
type PendingAction = "invite" | "promote" | "demote" | "deactivate" | "reactivate";

interface FeedbackState {
  readonly kind: "success" | "error";
  readonly message: string;
}

function initialsFor(user: UserRowViewModel): string {
  const source = user.displayName || user.email;
  const parts = source
    .split(/[\s._-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() ?? "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return `${first}${second}`.toUpperCase();
}

function toneFor(user: UserRowViewModel): AvatarTone {
  let hash = 0;
  for (let index = 0; index < user.userId.length; index += 1) {
    hash = (hash * 31 + user.userId.charCodeAt(index)) | 0;
  }
  const tone = AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
  return tone ?? ("slate" as AvatarTone);
}

function formatRelative(iso: string | null): string {
  if (iso === null) return "Never";
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

function sortUsers(
  rows: readonly UserRowViewModel[],
  currentUserId: string | null
): readonly UserRowViewModel[] {
  const statusRank = {
    active: 0,
    pending: 1,
    deactivated: 2
  } as const;

  return [...rows].sort((left, right) => {
    if (left.userId === currentUserId) return -1;
    if (right.userId === currentUserId) return 1;

    const statusDelta = statusRank[left.status] - statusRank[right.status];
    if (statusDelta !== 0) {
      return statusDelta;
    }

    return left.displayName.localeCompare(right.displayName);
  });
}

function mergeUserRow(
  rows: readonly UserRowViewModel[],
  nextUser: UserMutationData,
  currentUserId: string | null
): readonly UserRowViewModel[] {
  const nextRow: UserRowViewModel = {
    userId: nextUser.userId,
    displayName: nextUser.displayName,
    email: nextUser.email,
    role: nextUser.role,
    status: nextUser.status,
    lastActiveAt: nextUser.lastActiveAt
  };

  const nextRows = rows.some((row) => row.userId === nextRow.userId)
    ? rows.map((row) => (row.userId === nextRow.userId ? nextRow : row))
    : [nextRow, ...rows];

  return sortUsers(nextRows, currentUserId);
}

function buildIdFormData(id: string): FormData {
  const formData = new FormData();
  formData.set("id", id);
  return formData;
}

export function AccessSection({ viewModel }: { readonly viewModel: AccessSettingsViewModel }) {
  const [rows, setRows] = useState<readonly UserRowViewModel[]>(() =>
    sortUsers([...viewModel.admins, ...viewModel.internalUsers], viewModel.currentUserId)
  );
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ManagedRole>("internal_user");
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeAdminCount = rows.filter(
    (user) => user.role === "admin" && user.status !== "deactivated"
  ).length;

  function announce(message: string, kind: FeedbackState["kind"] = "success") {
    setFeedback({ kind, message });
    window.setTimeout(() => {
      setFeedback(null);
    }, 3500);
  }

  function commitUser(user: UserMutationData) {
    setRows((current) => mergeUserRow(current, user, viewModel.currentUserId));
  }

  function handleInvite() {
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (normalizedEmail.length === 0) {
      announce("Enter a teammate email to send an invite.", "error");
      return;
    }

    startTransition(async () => {
      setPendingKey("invite");
      const formData = new FormData();
      formData.set("email", normalizedEmail);
      formData.set("role", inviteRole);
      const result = await inviteUserAction(formData);
      setPendingKey(null);

      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      commitUser(result.data.user);
      setInviteEmail("");
      setInviteRole("internal_user");
      announce(`Invited ${result.data.user.email}.`);
    });
  }

  function handleUserAction(
    action: PendingAction,
    user: UserRowViewModel
  ) {
    startTransition(async () => {
      setPendingKey(`${action}:${user.userId}`);

      const result =
        action === "promote"
          ? await promoteUserAction(buildIdFormData(user.userId))
          : action === "demote"
            ? await demoteUserAction(buildIdFormData(user.userId))
            : action === "deactivate"
              ? await deactivateUserAction(buildIdFormData(user.userId))
              : await reactivateUserAction(buildIdFormData(user.userId));

      setPendingKey(null);

      if (!result.ok) {
        announce(result.message, "error");
        return;
      }

      commitUser(result.data.user);
      announce(
        action === "promote"
          ? `${result.data.user.email} is now an admin.`
          : action === "demote"
            ? `${result.data.user.email} is now an operator.`
            : action === "deactivate"
              ? `${result.data.user.email} has been deactivated.`
              : `${result.data.user.email} has been reactivated.`
      );
    });
  }

  return (
    <SettingsSection id="settings-access" title="Access">
      <div className="flex flex-col gap-4">
        {viewModel.isAdmin ? (
          <section
            aria-labelledby="invite-teammates-heading"
            className={cn(
              "flex flex-col gap-4 p-5",
              RADIUS.md,
              "border border-slate-200 bg-white",
              SHADOW.sm
            )}
          >
            <div className="flex flex-col gap-1">
              <h3 id="invite-teammates-heading" className="text-sm font-semibold text-slate-900">
                Invite teammates
              </h3>
              <p className={TYPE.caption}>
                Invites create a pending teammate row that links automatically
                when they sign in with Google.
              </p>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="flex-1">
                <label htmlFor="teammate-email" className="sr-only">
                  Teammate email
                </label>
                <Input
                  id="teammate-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => {
                    setInviteEmail(event.target.value);
                  }}
                  disabled={isPending && pendingKey === "invite"}
                  placeholder="teammate@adventurescientists.org"
                />
              </div>

              <div className="flex flex-col gap-2">
                <span className={cn(TYPE.label, "text-slate-600")}>Role</span>
                <ToggleGroup
                  type="single"
                  value={inviteRole}
                  onValueChange={(value) => {
                    if (value === "admin" || value === "internal_user") {
                      setInviteRole(value);
                    }
                  }}
                  variant="outline"
                  size="sm"
                  aria-label="Invite role"
                  className="justify-start"
                >
                  <ToggleGroupItem value="internal_user" aria-label="Operator role">
                    Operator
                  </ToggleGroupItem>
                  <ToggleGroupItem value="admin" aria-label="Admin role">
                    Admin
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>

              <Button
                type="button"
                onClick={handleInvite}
                disabled={isPending && pendingKey === "invite"}
              >
                Invite teammate
              </Button>
            </div>
          </section>
        ) : null}

        {feedback ? (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "rounded-md px-3 py-2 text-sm",
              feedback.kind === "success"
                ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200"
                : "bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200"
            )}
          >
            {feedback.message}
          </div>
        ) : null}

        <div
          className={cn(
            "overflow-hidden",
            RADIUS.md,
            "border border-slate-200 bg-white",
            SHADOW.sm
          )}
        >
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50/80">
              <tr>
                <th
                  scope="col"
                  className={cn("px-5 py-3 text-left", TYPE.label, "tracking-wider")}
                >
                  Teammate
                </th>
                <th
                  scope="col"
                  className={cn("px-5 py-3 text-left", TYPE.label, "tracking-wider")}
                >
                  Role
                </th>
                <th
                  scope="col"
                  className={cn("px-5 py-3 text-left", TYPE.label, "tracking-wider")}
                >
                  Last active
                </th>
                {viewModel.isAdmin ? (
                  <th
                    scope="col"
                    className={cn("px-5 py-3 text-left", TYPE.label, "tracking-wider")}
                  >
                    Actions
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((user) => {
                const isSelf = user.userId === viewModel.currentUserId;
                const pendingActionKey = pendingKey?.endsWith(user.userId)
                  ? pendingKey
                  : null;
                const isOnlyActiveAdmin =
                  user.role === "admin" &&
                  user.status !== "deactivated" &&
                  activeAdminCount <= 1;

                return (
                  <tr
                    key={user.userId}
                    className={cn(
                      TRANSITION.fast,
                      "hover:bg-slate-50/80",
                      user.status === "deactivated" && "bg-slate-50/60",
                      pendingActionKey && "opacity-60"
                    )}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <ToneAvatar
                          initials={initialsFor(user)}
                          tone={toneFor(user)}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p
                              className={cn(
                                "truncate text-sm font-medium",
                                user.status === "deactivated"
                                  ? "text-slate-500"
                                  : "text-slate-900"
                              )}
                            >
                              {user.displayName}
                            </p>
                            {isSelf ? (
                              <span className={cn(TYPE.micro, "text-slate-400")}>
                                (you)
                              </span>
                            ) : null}
                          </div>
                          <p
                            className={cn(
                              "truncate",
                              TYPE.caption,
                              user.status === "deactivated" && "text-slate-400"
                            )}
                          >
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 align-middle">
                      <div className="flex items-center gap-2">
                        <RoleBadge role={user.role} />
                        <UserStatusBadge status={user.status} />
                      </div>
                    </td>
                    <td className="px-5 py-3 align-middle">
                      <span
                        className={cn("tabular-nums", TYPE.bodySm, "text-slate-600")}
                      >
                        {formatRelative(user.lastActiveAt)}
                      </span>
                    </td>
                    {viewModel.isAdmin ? (
                      <td className="px-5 py-3 align-middle">
                        <div className="flex flex-wrap items-center gap-2">
                          {isSelf ? (
                            <span className={TYPE.caption}>Current session</span>
                          ) : user.status === "deactivated" ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={pendingActionKey !== null}
                              onClick={() => {
                                handleUserAction("reactivate", user);
                              }}
                            >
                              Reactivate
                            </Button>
                          ) : (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={pendingActionKey !== null || isOnlyActiveAdmin}
                                onClick={() => {
                                  handleUserAction(
                                    user.role === "admin" ? "demote" : "promote",
                                    user
                                  );
                                }}
                              >
                                {user.role === "admin" ? "Make operator" : "Make admin"}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={pendingActionKey !== null || isOnlyActiveAdmin}
                                onClick={() => {
                                  handleUserAction("deactivate", user);
                                }}
                              >
                                Deactivate
                              </Button>
                            </>
                          )}
                          {isOnlyActiveAdmin ? (
                            <span className={TYPE.caption}>Keep one active admin</span>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </SettingsSection>
  );
}

function RoleBadge({
  role
}: {
  readonly role: "admin" | "internal_user";
}) {
  if (role === "admin") {
    return (
      <StatusBadge
        label="Admin"
        colorClasses="bg-indigo-50 text-indigo-700 ring-indigo-200"
        variant="soft"
      />
    );
  }
  return (
    <StatusBadge
      label="Operator"
      colorClasses="bg-slate-100 text-slate-700 ring-slate-200"
      variant="soft"
    />
  );
}

function UserStatusBadge({
  status
}: {
  readonly status: UserRowViewModel["status"];
}) {
  if (status === "pending") {
    return (
      <StatusBadge
        label="Pending"
        colorClasses="bg-amber-50 text-amber-800 ring-amber-200"
        variant="soft"
      />
    );
  }

  if (status === "deactivated") {
    return (
      <StatusBadge
        label="Deactivated"
        colorClasses="bg-slate-100 text-slate-600 ring-slate-200"
        variant="soft"
      />
    );
  }

  return null;
}
