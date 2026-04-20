"use client";

import { useMemo, useState, useTransition } from "react";

import {
  FOCUS_RING,
  RADIUS,
  SHADOW,
  TEXT,
  TRANSITION
} from "@/app/_lib/design-tokens";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/ui/status-badge";
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
  reactivateUserAction
} from "../actions";
import { SettingsSection } from "./settings-section";

interface AccessSectionProps {
  readonly viewModel: AccessSettingsViewModel;
}

interface FeedbackState {
  readonly kind: "success" | "error";
  readonly message: string;
}

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
  for (let i = 0; i < user.userId.length; i += 1) {
    hash = (hash * 31 + user.userId.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % AVATAR_TONES.length;
  const tone = AVATAR_TONES[index];
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

export function AccessSection({ viewModel }: AccessSectionProps) {
  const [rows, setRows] = useState([
    ...viewModel.admins,
    ...viewModel.internalUsers
  ]);
  const [pending, startTransition] = useTransition();
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const sorted = useMemo(() => {
    const statusRank = {
      active: 0,
      pending: 1,
      deactivated: 2
    } as const;

    return [...rows].sort((left, right) => {
      if (left.userId === viewModel.currentUserId) return -1;
      if (right.userId === viewModel.currentUserId) return 1;

      const statusDelta = statusRank[left.status] - statusRank[right.status];
      if (statusDelta !== 0) {
        return statusDelta;
      }

      return left.displayName.localeCompare(right.displayName);
    });
  }, [rows, viewModel.currentUserId]);

  function announce(message: string, kind: FeedbackState["kind"] = "success") {
    setFeedback({ kind, message });
    window.setTimeout(() => {
      setFeedback(null);
    }, 3500);
  }

  function updateRow(id: string, patch: Partial<UserRowViewModel>) {
    setRows((current) =>
      current.map((row) => (row.userId === id ? { ...row, ...patch } : row))
    );
  }

  function handlePromote(user: UserRowViewModel) {
    setPendingRowId(user.userId);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", user.userId);
      const result = await promoteUserAction(formData);
      setPendingRowId(null);
      if (result.ok) {
        updateRow(user.userId, { role: "admin" });
        announce(`${user.displayName} is now an admin. (stub)`);
      }
    });
  }

  function handleDemote(user: UserRowViewModel) {
    setPendingRowId(user.userId);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", user.userId);
      const result = await demoteUserAction(formData);
      setPendingRowId(null);
      if (result.ok) {
        updateRow(user.userId, { role: "internal_user" });
        announce(`${user.displayName} is now an internal user. (stub)`);
      }
    });
  }

  function handleDeactivate(user: UserRowViewModel) {
    setPendingRowId(user.userId);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", user.userId);
      const result = await deactivateUserAction(formData);
      setPendingRowId(null);
      if (result.ok) {
        updateRow(user.userId, { status: "deactivated" });
        announce(`${user.displayName} deactivated. (stub)`);
      }
    });
  }

  function handleReactivate(user: UserRowViewModel) {
    setPendingRowId(user.userId);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", user.userId);
      const result = await reactivateUserAction(formData);
      setPendingRowId(null);
      if (result.ok) {
        updateRow(user.userId, {
          status: user.lastActiveAt === null ? "pending" : "active"
        });
        announce(`${user.displayName} reactivated. (stub)`);
      }
    });
  }

  function handleInvite() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("email", "");
      formData.set("role", "internal_user");
      const result = await inviteUserAction(formData);
      if (result.ok) {
        announce("Invite flow is not wired yet. (stub)");
      }
    });
  }

  return (
    <SettingsSection
      id="settings-access"
      title="Access"
      action={
        viewModel.isAdmin ? (
          <Button
            type="button"
            size="sm"
            onClick={handleInvite}
            disabled={pending}
          >
            Invite teammate
          </Button>
        ) : null
      }
      feedback={feedback}
    >
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
                className={cn(
                  "px-5 py-3 text-left",
                  TEXT.label,
                  "tracking-wider"
                )}
              >
                Teammate
              </th>
              <th
                scope="col"
                className={cn(
                  "px-5 py-3 text-left",
                  TEXT.label,
                  "tracking-wider"
                )}
              >
                Role
              </th>
              <th
                scope="col"
                className={cn(
                  "px-5 py-3 text-left",
                  TEXT.label,
                  "tracking-wider"
                )}
              >
                Last active
              </th>
              <th
                scope="col"
                className={cn(
                  "px-5 py-3 text-right",
                  TEXT.label,
                  "tracking-wider"
                )}
              >
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((user) => {
              const isSelf = user.userId === viewModel.currentUserId;
              const isRowPending = pending && pendingRowId === user.userId;
              return (
                <tr
                  key={user.userId}
                  className={cn(
                    TRANSITION.fast,
                    isRowPending ? "opacity-60" : "hover:bg-slate-50/80",
                    user.status === "deactivated" && "bg-slate-50/60"
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
                          {isSelf && (
                            <span className={cn(TEXT.micro, "text-slate-400")}>
                              (you)
                            </span>
                          )}
                        </div>
                        <p
                          className={cn(
                            "truncate",
                            TEXT.caption,
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
                      className={cn(
                        "tabular-nums",
                        TEXT.bodySm,
                        "text-slate-600"
                      )}
                    >
                      {formatRelative(user.lastActiveAt)}
                    </span>
                  </td>
                  <td className="px-5 py-3 align-middle">
                    <div className="flex justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            disabled={
                              !viewModel.isAdmin || isSelf || isRowPending
                            }
                            aria-label={`Actions for ${user.displayName}`}
                            className={cn(
                              "flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700",
                              TRANSITION.fast,
                              FOCUS_RING,
                              "disabled:cursor-not-allowed disabled:opacity-40"
                            )}
                          >
                            <MoreIcon className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          {user.status === "deactivated" ? (
                            <DropdownMenuItem
                              onSelect={(event) => {
                                event.preventDefault();
                                handleReactivate(user);
                              }}
                            >
                              Reactivate
                            </DropdownMenuItem>
                          ) : (
                            <>
                              {user.role === "internal_user" ? (
                                <DropdownMenuItem
                                  onSelect={(event) => {
                                    event.preventDefault();
                                    handlePromote(user);
                                  }}
                                >
                                  Promote to admin
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onSelect={(event) => {
                                    event.preventDefault();
                                    handleDemote(user);
                                  }}
                                >
                                  Demote to internal user
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={(event) => {
                                  event.preventDefault();
                                  handleDeactivate(user);
                                }}
                                className="text-rose-700 focus:bg-rose-50 focus:text-rose-800"
                              >
                                Deactivate
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
      label="Internal user"
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

function MoreIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="4" cy="10" r="1.5" />
      <circle cx="10" cy="10" r="1.5" />
      <circle cx="16" cy="10" r="1.5" />
    </svg>
  );
}
