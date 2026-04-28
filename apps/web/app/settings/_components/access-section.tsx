"use client";

import { Fragment, useState, useTransition } from "react";
import { Pencil, UserPlus } from "lucide-react";

import { RADIUS, SHADOW, TRANSITION, TYPE } from "@/app/_lib/design-tokens-v2";
import { Button } from "@/components/ui/button";
import { ToneAvatar } from "@/components/ui/tone-avatar";
import { cn } from "@/lib/utils";
import type {
  AccessSettingsViewModel,
  UserRowViewModel,
} from "@/src/server/settings/selectors";

import {
  deactivateUserAction,
  demoteUserAction,
  promoteUserAction,
  reactivateUserAction,
  type UserMutationData,
} from "../actions";
import { SettingsSection } from "./settings-section";
import { TeammateInviteModal } from "./teammate-invite-modal";

const AVATAR_TONES = [
  "indigo",
  "emerald",
  "amber",
  "rose",
  "sky",
  "violet",
  "teal",
] as const;

type AvatarTone = (typeof AVATAR_TONES)[number];
type ManagedRole = "admin" | "internal_user";
type EditStatus = "active" | "pending" | "inactive";

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

function sortUsers(
  rows: readonly UserRowViewModel[],
  currentUserId: string | null,
): readonly UserRowViewModel[] {
  const statusRank = { active: 0, pending: 1, deactivated: 2 } as const;
  return [...rows].sort((left, right) => {
    if (left.userId === currentUserId) return -1;
    if (right.userId === currentUserId) return 1;
    const statusDelta = statusRank[left.status] - statusRank[right.status];
    if (statusDelta !== 0) return statusDelta;
    return left.displayName.localeCompare(right.displayName);
  });
}

function mergeUserRow(
  rows: readonly UserRowViewModel[],
  nextUser: UserMutationData,
  currentUserId: string | null,
): readonly UserRowViewModel[] {
  const nextRow: UserRowViewModel = {
    userId: nextUser.userId,
    displayName: nextUser.displayName,
    email: nextUser.email,
    role: nextUser.role,
    status: nextUser.status,
    lastActiveAt: nextUser.lastActiveAt,
  };
  const nextRows = rows.some((row) => row.userId === nextRow.userId)
    ? rows.map((row) => (row.userId === nextRow.userId ? nextRow : row))
    : [nextRow, ...rows];
  return sortUsers(nextRows, currentUserId);
}

function buildIdFormData(id: string): FormData {
  const fd = new FormData();
  fd.set("id", id);
  return fd;
}

function userStatusToEditStatus(status: UserRowViewModel["status"]): EditStatus {
  if (status === "deactivated") return "inactive";
  if (status === "pending") return "pending";
  return "active";
}

export function AccessSection({
  viewModel,
}: {
  readonly viewModel: AccessSettingsViewModel;
}) {
  const [rows, setRows] = useState<readonly UserRowViewModel[]>(() =>
    sortUsers(
      [...viewModel.admins, ...viewModel.internalUsers],
      viewModel.currentUserId,
    ),
  );
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const activeAdminCount = rows.filter(
    (u) => u.role === "admin" && u.status !== "deactivated",
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

  function handleSaveEdit(
    user: UserRowViewModel,
    nextRole: ManagedRole,
    nextStatus: EditStatus,
  ) {
    const roleChanged = nextRole !== user.role;
    const currentStatus = userStatusToEditStatus(user.status);
    const statusChanged = nextStatus !== currentStatus && user.status !== "pending";

    if (!roleChanged && !statusChanged) {
      setEditingUserId(null);
      return;
    }

    startTransition(async () => {
      setSavingUserId(user.userId);

      if (roleChanged) {
        const result =
          nextRole === "admin"
            ? await promoteUserAction(buildIdFormData(user.userId))
            : await demoteUserAction(buildIdFormData(user.userId));
        if (!result.ok) {
          announce(result.message, "error");
          setSavingUserId(null);
          return;
        }
        commitUser(result.data.user);
      }

      if (statusChanged) {
        const result =
          nextStatus === "inactive"
            ? await deactivateUserAction(buildIdFormData(user.userId))
            : await reactivateUserAction(buildIdFormData(user.userId));
        if (!result.ok) {
          announce(result.message, "error");
          setSavingUserId(null);
          return;
        }
        commitUser(result.data.user);
      }

      announce(
        roleChanged && statusChanged
          ? `${user.email} updated.`
          : roleChanged
            ? nextRole === "admin"
              ? `${user.email} is now an admin.`
              : `${user.email} is now an operator.`
            : nextStatus === "inactive"
              ? `${user.email} has been deactivated.`
              : `${user.email} has been reactivated.`,
      );
      setSavingUserId(null);
      setEditingUserId(null);
    });
  }

  const colCount = viewModel.isAdmin ? 4 : 3;

  return (
    <SettingsSection
      id="settings-access"
      title="Access"
      description="Teammates, roles, and deactivated accounts"
      feedback={feedback}
      action={
        viewModel.isAdmin ? (
          <>
            <Button
              type="button"
              onClick={() => {
                setInviteModalOpen(true);
              }}
            >
              <UserPlus data-icon="inline-start" aria-hidden="true" />
              Invite teammate
            </Button>
            <TeammateInviteModal
              open={inviteModalOpen}
              onClose={() => {
                setInviteModalOpen(false);
              }}
            />
          </>
        ) : null
      }
    >
      <div
        className={cn(
          "overflow-hidden",
          RADIUS.lg,
          "border border-slate-200 bg-white",
          SHADOW.sm,
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
                Status
              </th>
              {viewModel.isAdmin ? (
                <th
                  scope="col"
                  className={cn("w-14 px-5 py-3 text-left", TYPE.label, "tracking-wider")}
                >
                  Edit
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((user) => {
              const isSelf = user.userId === viewModel.currentUserId;
              const isEditing = editingUserId === user.userId;
              const isSaving = savingUserId === user.userId;
              const isOnlyActiveAdmin =
                user.role === "admin" &&
                user.status !== "deactivated" &&
                activeAdminCount <= 1;

              return (
                <Fragment key={user.userId}>
                  <tr
                    className={cn(
                      TRANSITION.fast,
                      !isEditing && "hover:bg-slate-50/80",
                      user.status === "deactivated" && "bg-slate-50/40",
                      isSaving && "opacity-60",
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
                                "truncate text-[13px] font-medium",
                                user.status === "deactivated"
                                  ? "text-slate-500"
                                  : "text-slate-900",
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
                              user.status === "deactivated" && "text-slate-400",
                            )}
                          >
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 align-middle">
                      <RoleBadge role={user.role} />
                    </td>
                    <td className="px-5 py-3 align-middle">
                      <StatusDot status={user.status} />
                    </td>
                    {viewModel.isAdmin ? (
                      <td className="px-5 py-3 align-middle">
                        {!isSelf ? (
                          <button
                            type="button"
                            aria-label={`Edit ${user.displayName}`}
                            aria-expanded={isEditing}
                            disabled={isSaving}
                            onClick={() => {
                              setEditingUserId(isEditing ? null : user.userId);
                            }}
                            className={cn(
                              "rounded p-1.5 transition-colors duration-100",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1",
                              "disabled:cursor-not-allowed disabled:opacity-40",
                              isEditing
                                ? "bg-slate-900 text-white"
                                : "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
                            )}
                          >
                            <Pencil className="size-3.5" aria-hidden="true" />
                          </button>
                        ) : (
                          <span className={cn(TYPE.micro, "text-slate-300")}>—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                  {isEditing ? (
                    <tr>
                      <td
                        colSpan={colCount}
                        className="border-t border-slate-100 bg-slate-50/60 px-5 py-5"
                      >
                        <RowEditPanel
                          user={user}
                          isOnlyActiveAdmin={isOnlyActiveAdmin}
                          isSaving={isSaving}
                          onCancel={() => {
                            setEditingUserId(null);
                          }}
                          onSave={(nextRole, nextStatus) => {
                            handleSaveEdit(user, nextRole, nextStatus);
                          }}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </SettingsSection>
  );
}

// ---- Role badge ----

function RoleBadge({ role }: { readonly role: "admin" | "internal_user" }) {
  const isAdmin = role === "admin";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        isAdmin
          ? "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200"
          : "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200",
      )}
    >
      {isAdmin ? "Admin" : "Operator"}
    </span>
  );
}

// ---- Status dot ----

function StatusDot({ status }: { readonly status: UserRowViewModel["status"] }) {
  const config =
    status === "active"
      ? { dot: "bg-emerald-500", text: "text-emerald-700", label: "Active" }
      : status === "pending"
        ? { dot: "bg-amber-400", text: "text-amber-700", label: "Pending" }
        : { dot: "bg-slate-300", text: "text-slate-500", label: "Inactive" };

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", config.dot)}
      />
      <span
        className={cn(
          "text-[12px] font-medium uppercase tracking-wide",
          config.text,
        )}
      >
        {config.label}
      </span>
    </span>
  );
}

// ---- Inline row edit panel ----

interface RoleOption {
  readonly value: ManagedRole;
  readonly label: string;
  readonly description: string;
}

interface StatusOption {
  readonly value: EditStatus;
  readonly label: string;
  readonly description: string;
  readonly dotClass: string;
}

const ROLE_OPTIONS: readonly RoleOption[] = [
  {
    value: "admin",
    label: "Admin",
    description: "Full access — manage projects, teammates, and integrations.",
  },
  {
    value: "internal_user",
    label: "Operator",
    description: "Read, reply, and manage conversations. Cannot change settings.",
  },
];

const STATUS_OPTIONS: readonly StatusOption[] = [
  {
    value: "active",
    label: "Active",
    description: "Can sign in and use the workspace.",
    dotClass: "bg-emerald-500",
  },
  {
    value: "pending",
    label: "Pending",
    description: "Invite sent; linking on first Google sign-in.",
    dotClass: "bg-amber-400",
  },
  {
    value: "inactive",
    label: "Inactive",
    description: "Signed out; history preserved, no new access.",
    dotClass: "bg-slate-300",
  },
];

interface RowEditPanelProps {
  readonly user: UserRowViewModel;
  readonly isOnlyActiveAdmin: boolean;
  readonly isSaving: boolean;
  readonly onCancel: () => void;
  readonly onSave: (role: ManagedRole, status: EditStatus) => void;
}

function RowEditPanel({
  user,
  isOnlyActiveAdmin,
  isSaving,
  onCancel,
  onSave,
}: RowEditPanelProps) {
  const [selectedRole, setSelectedRole] = useState<ManagedRole>(user.role);
  const [selectedStatus, setSelectedStatus] = useState<EditStatus>(
    userStatusToEditStatus(user.status),
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-5">
        {/* Role picker */}
        <div className="flex flex-col gap-2.5">
          <p className={cn(TYPE.label, "uppercase tracking-wider text-slate-500")}>
            Role
          </p>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Role">
            {ROLE_OPTIONS.map((option) => {
              const isSelected = selectedRole === option.value;
              const disabled =
                isSaving ||
                (option.value === "internal_user" && isOnlyActiveAdmin);
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  disabled={disabled}
                  onClick={() => {
                    setSelectedRole(option.value);
                  }}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border bg-white p-3 text-left text-sm",
                    "transition-colors duration-100",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    isSelected
                      ? "border-slate-900 ring-1 ring-slate-900"
                      : "border-slate-200 hover:border-slate-300",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                      isSelected ? "border-slate-900" : "border-slate-300",
                    )}
                  >
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        isSelected ? "bg-slate-900" : "bg-transparent",
                      )}
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-slate-900">
                      {option.label}
                    </span>
                    <span className={cn("mt-0.5 block", TYPE.caption)}>
                      {option.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Status picker */}
        <div className="flex flex-col gap-2.5">
          <p className={cn(TYPE.label, "uppercase tracking-wider text-slate-500")}>
            Status
          </p>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Status">
            {STATUS_OPTIONS.map((option) => {
              const isSelected = selectedStatus === option.value;
              const isPendingOption = option.value === "pending";
              const disabled =
                isSaving ||
                isPendingOption; // Pending can't be set manually — it clears on first sign-in
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  disabled={disabled}
                  onClick={() => {
                    if (!isPendingOption) {
                      setSelectedStatus(option.value);
                    }
                  }}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border bg-white p-3 text-left text-sm",
                    "transition-colors duration-100",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    isSelected
                      ? "border-slate-900 ring-1 ring-slate-900"
                      : "border-slate-200 hover:border-slate-300",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1 size-2 shrink-0 rounded-full",
                      option.dotClass,
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold text-slate-900">
                      {option.label}
                    </span>
                    <span className={cn("mt-0.5 block", TYPE.caption)}>
                      {option.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isSaving}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={isSaving}
          onClick={() => {
            onSave(selectedRole, selectedStatus);
          }}
        >
          {isSaving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
