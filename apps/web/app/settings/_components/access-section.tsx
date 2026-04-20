import {
  RADIUS,
  SHADOW,
  TEXT,
  TRANSITION
} from "@/app/_lib/design-tokens";
import { StatusBadge } from "@/components/ui/status-badge";
import { ToneAvatar } from "@/components/ui/tone-avatar";
import { cn } from "@/lib/utils";
import type {
  AccessSettingsViewModel,
  UserRowViewModel
} from "@/src/server/settings/selectors";

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

export function AccessSection({ viewModel }: { readonly viewModel: AccessSettingsViewModel }) {
  const rows = sortUsers(
    [...viewModel.admins, ...viewModel.internalUsers],
    viewModel.currentUserId
  );

  return (
    <SettingsSection id="settings-access" title="Access">
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
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((user) => {
              const isSelf = user.userId === viewModel.currentUserId;

              return (
                <tr
                  key={user.userId}
                  className={cn(
                    TRANSITION.fast,
                    "hover:bg-slate-50/80",
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
                          {isSelf ? (
                            <span className={cn(TEXT.micro, "text-slate-400")}>
                              (you)
                            </span>
                          ) : null}
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
