"use client";

import { useState, useTransition } from "react";

import { cn } from "@/lib/utils";

import {
  deactivateUserAction,
  demoteUserAction,
  promoteUserAction,
  reactivateUserAction,
  type UiError
} from "../actions";

export interface UserRowViewModel {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: "admin" | "operator";
  readonly isDeactivated: boolean;
  readonly deactivatedAt: string | null;
}

interface UsersTableProps {
  readonly rows: readonly UserRowViewModel[];
  readonly currentUserId: string;
}

interface RowError {
  readonly rowId: string;
  readonly message: string;
}

function RoleBadge({ role }: { readonly role: "admin" | "operator" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        role === "admin"
          ? "bg-indigo-100 text-indigo-700"
          : "bg-slate-100 text-slate-600"
      )}
    >
      {role === "admin" ? "Admin" : "Operator"}
    </span>
  );
}

function StatusBadge({ isDeactivated }: { readonly isDeactivated: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        isDeactivated
          ? "bg-red-50 text-red-600"
          : "bg-emerald-50 text-emerald-700"
      )}
    >
      {isDeactivated ? "Deactivated" : "Active"}
    </span>
  );
}

export function UsersTable({ rows, currentUserId }: UsersTableProps) {
  const [pending, startTransition] = useTransition();
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<RowError | null>(null);

  function handleError(rowId: string, result: UiError) {
    setRowError({ rowId, message: result.message });
  }

  function clearError() {
    setRowError(null);
  }

  function handlePromote(rowId: string) {
    clearError();
    setPendingRowId(rowId);
    startTransition(async () => {
      const result = await promoteUserAction({ id: rowId });
      setPendingRowId(null);
      if (!result.ok) {
        handleError(rowId, result);
      }
    });
  }

  function handleDemote(rowId: string) {
    clearError();
    setPendingRowId(rowId);
    startTransition(async () => {
      const result = await demoteUserAction({ id: rowId });
      setPendingRowId(null);
      if (!result.ok) {
        handleError(rowId, result);
      }
    });
  }

  function handleDeactivate(rowId: string) {
    clearError();
    setPendingRowId(rowId);
    startTransition(async () => {
      const result = await deactivateUserAction({ id: rowId });
      setPendingRowId(null);
      if (!result.ok) {
        handleError(rowId, result);
      }
    });
  }

  function handleReactivate(rowId: string) {
    clearError();
    setPendingRowId(rowId);
    startTransition(async () => {
      const result = await reactivateUserAction({ id: rowId });
      setPendingRowId(null);
      if (!result.ok) {
        handleError(rowId, result);
      }
    });
  }

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        No users found.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead>
          <tr className="bg-slate-50">
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Email
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Name
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Role
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Status
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const isCurrentUser = row.id === currentUserId;
            const isRowPending = pending && pendingRowId === row.id;
            const rowErr =
              rowError?.rowId === row.id ? rowError.message : null;

            return (
              <tr
                key={row.id}
                className={cn(
                  "transition-colors",
                  isRowPending ? "opacity-60" : "hover:bg-slate-50"
                )}
              >
                <td className="px-4 py-3 text-slate-900">
                  <span>{row.email}</span>
                  {isCurrentUser && (
                    <span className="ml-2 text-xs text-slate-500">(you)</span>
                  )}
                  {rowErr !== null && (
                    <p className="mt-0.5 text-xs text-red-600" role="alert">
                      {rowErr}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {row.name ?? <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-3">
                  <RoleBadge role={row.role} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge isDeactivated={row.isDeactivated} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {row.isDeactivated ? (
                      <ActionButton
                        label="Reactivate"
                        disabled={isRowPending}
                        variant="secondary"
                        onClick={() => {
                          handleReactivate(row.id);
                        }}
                      />
                    ) : (
                      <>
                        {row.role === "operator" && (
                          <ActionButton
                            label="Promote to Admin"
                            disabled={isRowPending}
                            variant="secondary"
                            onClick={() => {
                              handlePromote(row.id);
                            }}
                          />
                        )}
                        {row.role === "admin" && !isCurrentUser && (
                          <ActionButton
                            label="Demote to Operator"
                            disabled={isRowPending}
                            variant="secondary"
                            onClick={() => {
                              handleDemote(row.id);
                            }}
                          />
                        )}
                        {!isCurrentUser && (
                          <ActionButton
                            label="Deactivate"
                            disabled={isRowPending}
                            variant="danger"
                            onClick={() => {
                              handleDeactivate(row.id);
                            }}
                          />
                        )}
                        {isCurrentUser && (
                          <span className="text-xs text-slate-400">
                            Cannot modify own account
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface ActionButtonProps {
  readonly label: string;
  readonly disabled: boolean;
  readonly variant: "secondary" | "danger";
  readonly onClick: () => void;
}

function ActionButton({
  label,
  disabled,
  variant,
  onClick
}: ActionButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "danger"
          ? "bg-red-50 text-red-700 hover:bg-red-100 disabled:hover:bg-red-50"
          : "bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:hover:bg-slate-100"
      )}
    >
      {label}
    </button>
  );
}
