"use client";

import { useMemo, useState, useTransition, type SyntheticEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  createAliasAction,
  deleteAliasAction,
  updateAliasAction,
  type UiError
} from "../actions";

export interface AliasRowViewModel {
  readonly id: string;
  readonly alias: string;
  readonly projectId: string | null;
  readonly projectName?: string;
}

export interface ProjectOption {
  readonly id: string;
  readonly name: string;
}

interface AliasesTableProps {
  readonly rows: readonly AliasRowViewModel[];
  readonly projectOptions: readonly ProjectOption[];
  readonly isAdmin: boolean;
}

type RowMode =
  | { readonly kind: "view" }
  | { readonly kind: "editing"; readonly rowId: string }
  | { readonly kind: "creating" };

interface EditFormState {
  readonly alias: string;
  readonly projectId: string | null;
}

interface FeedbackState {
  readonly kind: "success" | "error";
  readonly message: string;
}

const UNASSIGNED_VALUE = "__unassigned__";

function optionValue(projectId: string | null): string {
  return projectId ?? UNASSIGNED_VALUE;
}

function parseProjectSelection(value: string): string | null {
  return value === UNASSIGNED_VALUE ? null : value;
}

function extractFieldErrors(
  result: UiError
): Readonly<Record<string, string>> {
  return result.fieldErrors ?? {};
}

export function AliasesTable({
  rows,
  projectOptions,
  isAdmin
}: AliasesTableProps) {
  const [mode, setMode] = useState<RowMode>({ kind: "view" });
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const [editDraft, setEditDraft] = useState<EditFormState>({
    alias: "",
    projectId: null
  });

  const projectById = useMemo(
    () => new Map(projectOptions.map((project) => [project.id, project.name])),
    [projectOptions]
  );

  function resetFeedback(): void {
    setFeedback(null);
    setFieldErrors({});
  }

  function handleStartCreate(): void {
    resetFeedback();
    setEditDraft({ alias: "", projectId: null });
    setMode({ kind: "creating" });
  }

  function handleStartEdit(row: AliasRowViewModel): void {
    resetFeedback();
    setEditDraft({ alias: row.alias, projectId: row.projectId });
    setMode({ kind: "editing", rowId: row.id });
  }

  function handleCancel(): void {
    resetFeedback();
    setMode({ kind: "view" });
  }

  function handleCreateSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const snapshot = editDraft;
    startTransition(async () => {
      const result = await createAliasAction({
        alias: snapshot.alias.trim(),
        projectId: snapshot.projectId
      });
      if (result.ok) {
        setMode({ kind: "view" });
        setFieldErrors({});
        setFeedback({
          kind: "success",
          message: `Created alias ${result.data.alias}.`
        });
      } else {
        setFieldErrors(extractFieldErrors(result));
        setFeedback({ kind: "error", message: result.message });
      }
    });
  }

  function handleEditSubmit(
    event: SyntheticEvent<HTMLFormElement>,
    rowId: string
  ): void {
    event.preventDefault();
    const snapshot = editDraft;
    startTransition(async () => {
      const result = await updateAliasAction({
        id: rowId,
        alias: snapshot.alias.trim(),
        projectId: snapshot.projectId
      });
      if (result.ok) {
        setMode({ kind: "view" });
        setFieldErrors({});
        setFeedback({ kind: "success", message: "Alias updated." });
      } else {
        setFieldErrors(extractFieldErrors(result));
        setFeedback({ kind: "error", message: result.message });
      }
    });
  }

  function handleDelete(row: AliasRowViewModel): void {
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(
            `Delete alias ${row.alias}? This cannot be undone.`
          );
    if (!confirmed) return;

    resetFeedback();
    startTransition(async () => {
      const result = await deleteAliasAction({ id: row.id });
      if (result.ok) {
        setFeedback({
          kind: "success",
          message: `Deleted alias ${row.alias}.`
        });
      } else {
        setFeedback({ kind: "error", message: result.message });
      }
    });
  }

  const showActions = isAdmin;
  const columnCount = showActions ? 3 : 2;

  return (
    <div className="flex flex-col gap-4">
      {isAdmin && mode.kind !== "creating" ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={handleStartCreate}
            disabled={pending}
          >
            New alias
          </Button>
        </div>
      ) : null}

      {feedback ? (
        <div
          role="status"
          className={cn(
            "rounded-md border px-3 py-2 text-sm",
            feedback.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          )}
        >
          {feedback.message}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2 font-semibold">
                Alias
              </th>
              <th scope="col" className="px-4 py-2 font-semibold">
                Project
              </th>
              {showActions ? (
                <th
                  scope="col"
                  className="px-4 py-2 text-right font-semibold"
                >
                  Actions
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {mode.kind === "creating" ? (
              <CreateRow
                draft={editDraft}
                onDraftChange={setEditDraft}
                projectOptions={projectOptions}
                onSubmit={handleCreateSubmit}
                onCancel={handleCancel}
                pending={pending}
                fieldErrors={fieldErrors}
                columnCount={columnCount}
              />
            ) : null}

            {rows.length === 0 && mode.kind !== "creating" ? (
              <tr>
                <td
                  colSpan={columnCount}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No project aliases yet.
                </td>
              </tr>
            ) : null}

            {rows.map((row) => {
              const isEditing =
                mode.kind === "editing" && mode.rowId === row.id;
              if (isEditing) {
                return (
                  <EditRow
                    key={row.id}
                    row={row}
                    draft={editDraft}
                    onDraftChange={setEditDraft}
                    projectOptions={projectOptions}
                    onSubmit={(event) => {
                      handleEditSubmit(event, row.id);
                    }}
                    onCancel={handleCancel}
                    pending={pending}
                    fieldErrors={fieldErrors}
                    columnCount={columnCount}
                  />
                );
              }
              return (
                <ViewRow
                  key={row.id}
                  row={row}
                  projectById={projectById}
                  showActions={showActions}
                  pending={pending}
                  onEdit={() => {
                    handleStartEdit(row);
                  }}
                  onDelete={() => {
                    handleDelete(row);
                  }}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface ViewRowProps {
  readonly row: AliasRowViewModel;
  readonly projectById: ReadonlyMap<string, string>;
  readonly showActions: boolean;
  readonly pending: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}

function ViewRow({
  row,
  projectById,
  showActions,
  pending,
  onEdit,
  onDelete
}: ViewRowProps) {
  const projectLabel =
    row.projectId === null
      ? "Unassigned"
      : (row.projectName ?? projectById.get(row.projectId) ?? row.projectId);

  return (
    <tr className="bg-white">
      <td className="px-4 py-3 font-medium text-slate-900">{row.alias}</td>
      <td className="px-4 py-3 text-slate-700">
        {row.projectId === null ? (
          <span className="text-slate-500">Unassigned</span>
        ) : (
          projectLabel
        )}
      </td>
      {showActions ? (
        <td className="px-4 py-3 text-right">
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onEdit}
              disabled={pending}
            >
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={onDelete}
              disabled={pending}
            >
              Delete
            </Button>
          </div>
        </td>
      ) : null}
    </tr>
  );
}

interface EditableRowProps {
  readonly draft: EditFormState;
  readonly onDraftChange: (next: EditFormState) => void;
  readonly projectOptions: readonly ProjectOption[];
  readonly onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
  readonly onCancel: () => void;
  readonly pending: boolean;
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly columnCount: number;
}

function CreateRow({
  draft,
  onDraftChange,
  projectOptions,
  onSubmit,
  onCancel,
  pending,
  fieldErrors,
  columnCount
}: EditableRowProps) {
  return (
    <tr className="bg-slate-50/70">
      <td colSpan={columnCount} className="px-4 py-3">
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4"
          aria-label="New project alias"
        >
          <FormFields
            draft={draft}
            onDraftChange={onDraftChange}
            projectOptions={projectOptions}
            pending={pending}
            fieldErrors={fieldErrors}
            idPrefix="create"
          />
          <FormActions
            submitLabel="Create alias"
            pending={pending}
            onCancel={onCancel}
          />
        </form>
      </td>
    </tr>
  );
}

interface EditRowProps extends EditableRowProps {
  readonly row: AliasRowViewModel;
}

function EditRow({
  row,
  draft,
  onDraftChange,
  projectOptions,
  onSubmit,
  onCancel,
  pending,
  fieldErrors,
  columnCount
}: EditRowProps) {
  return (
    <tr className="bg-slate-50/70">
      <td colSpan={columnCount} className="px-4 py-3">
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4"
          aria-label={`Edit alias ${row.alias}`}
        >
          <FormFields
            draft={draft}
            onDraftChange={onDraftChange}
            projectOptions={projectOptions}
            pending={pending}
            fieldErrors={fieldErrors}
            idPrefix={`edit-${row.id}`}
          />
          <FormActions
            submitLabel="Save"
            pending={pending}
            onCancel={onCancel}
          />
        </form>
      </td>
    </tr>
  );
}

interface FormFieldsProps {
  readonly draft: EditFormState;
  readonly onDraftChange: (next: EditFormState) => void;
  readonly projectOptions: readonly ProjectOption[];
  readonly pending: boolean;
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly idPrefix: string;
}

function FormFields({
  draft,
  onDraftChange,
  projectOptions,
  pending,
  fieldErrors,
  idPrefix
}: FormFieldsProps) {
  const aliasId = `${idPrefix}-alias`;
  const projectId = `${idPrefix}-projectId`;
  const aliasError = fieldErrors.alias;
  const projectError = fieldErrors.projectId;

  return (
    <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:gap-3">
      <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-700">
        <span>
          Alias email
          <span aria-hidden="true" className="ml-0.5 text-rose-600">
            *
          </span>
        </span>
        <input
          id={aliasId}
          name="alias"
          type="email"
          required
          autoComplete="off"
          disabled={pending}
          value={draft.alias}
          onChange={(event) => {
            onDraftChange({ ...draft, alias: event.target.value });
          }}
          className={cn(
            "h-9 rounded-md border bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-slate-500 focus:ring-1 focus:ring-slate-500 disabled:bg-slate-50 disabled:text-slate-500",
            aliasError ? "border-rose-400" : "border-slate-300"
          )}
          aria-invalid={aliasError ? true : undefined}
          aria-describedby={aliasError ? `${aliasId}-error` : undefined}
        />
        {aliasError ? (
          <span
            id={`${aliasId}-error`}
            className="text-[11px] font-normal text-rose-700"
          >
            {aliasError}
          </span>
        ) : null}
      </label>

      <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-700">
        <span>Project</span>
        <select
          id={projectId}
          name="projectId"
          disabled={pending}
          value={optionValue(draft.projectId)}
          onChange={(event) => {
            onDraftChange({
              ...draft,
              projectId: parseProjectSelection(event.target.value)
            });
          }}
          className={cn(
            "h-9 rounded-md border bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-slate-500 focus:ring-1 focus:ring-slate-500 disabled:bg-slate-50 disabled:text-slate-500",
            projectError ? "border-rose-400" : "border-slate-300"
          )}
          aria-invalid={projectError ? true : undefined}
          aria-describedby={projectError ? `${projectId}-error` : undefined}
        >
          <option value={UNASSIGNED_VALUE}>Unassigned</option>
          {projectOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        {projectError ? (
          <span
            id={`${projectId}-error`}
            className="text-[11px] font-normal text-rose-700"
          >
            {projectError}
          </span>
        ) : null}
      </label>
    </div>
  );
}

interface FormActionsProps {
  readonly submitLabel: string;
  readonly pending: boolean;
  readonly onCancel: () => void;
}

function FormActions({ submitLabel, pending, onCancel }: FormActionsProps) {
  return (
    <div className="flex shrink-0 items-end gap-2 sm:self-end">
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onCancel}
        disabled={pending}
      >
        Cancel
      </Button>
    </div>
  );
}
