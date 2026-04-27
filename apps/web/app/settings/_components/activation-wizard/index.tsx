"use client";

import { useReducer } from "react";
import { ArrowLeft, ChevronRight, RefreshCw, X } from "lucide-react";

import {
  type ActivationWizardInput,
  activateProjectFromWizardAction,
  updateProjectAiKnowledgeAction
} from "@/app/settings/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ProjectRowViewModel } from "@/src/server/settings/selectors";

import { SidebarChecklist } from "./sidebar-checklist";
import {
  ACTIVATION_WIZARD_STEPS,
  getAliasValidationError,
  getPrimaryAlias,
  getSignatureValidationError,
  getStepOneValid,
  getStepThreeValid,
  getStepTwoValid,
  isNotionUrlLike,
  normalizeSignatureDraft
} from "./shared";
import {
  activationWizardReducer,
  createInitialState
} from "./state";
import { StepAliases } from "./step-aliases";
import { StepKnowledge } from "./step-knowledge";
import { StepPickProject } from "./step-pick-project";
import { StepReview } from "./step-review";
import { StepSignature } from "./step-signature";
import { StepSuccess } from "./step-success";

export interface ActivationWizardProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly inactiveProjects: readonly ProjectRowViewModel[];
  readonly initialProjectId?: string;
}


export function ActivationWizard({
  open,
  onClose,
  inactiveProjects,
  initialProjectId
}: ActivationWizardProps) {
  const [state, dispatch] = useReducer(
    activationWizardReducer,
    { inactiveProjects, initialProjectId },
    ({ inactiveProjects: projects, initialProjectId: projectId }) =>
      createInitialState(projects, projectId)
  );
  const selectedProject =
    inactiveProjects.find((project) => project.projectId === state.pickedProjectId) ??
    null;
  const primaryAlias = getPrimaryAlias(state.aliases);
  const stepValid = {
    0: getStepOneValid({
      pickedProjectId: state.pickedProjectId,
      aliasDraft: state.aliasDraft
    }),
    1: getStepTwoValid(state.aliases),
    2: getStepThreeValid(state.signatureDraft),
    3: state.knowledgeStatus === "done"
  } as const;
  const canContinue =
    state.step === 0
      ? stepValid[0]
      : state.step === 1
        ? stepValid[1]
        : state.step === 2
          ? stepValid[2]
          : state.step === 3
            ? stepValid[3]
            : true;
  const isPending =
    state.knowledgeStatus === "syncing" || state.activationStatus === "pending";
  const isActivated = state.activatedProject !== null;
  const dialogTitle = isActivated
    ? "Project activated"
    : ACTIVATION_WIZARD_STEPS[state.step].title;
  const dialogDescription = isActivated
    ? "Your project is live."
    : ACTIVATION_WIZARD_STEPS[state.step].subtitle;

  async function handleSync() {
    if (selectedProject === null || !isNotionUrlLike(state.notionUrl)) {
      dispatch({
        type: "sync-error",
        message: "Enter a Notion page URL."
      });
      return;
    }

    dispatch({ type: "sync-start" });

    const result = await updateProjectAiKnowledgeAction(
      selectedProject.projectId,
      state.notionUrl
    );
    if (!result.ok) {
      dispatch({
        type: "sync-error",
        message: result.message
      });
      return;
    }

    dispatch({ type: "sync-done" });
  }

  async function handleActivate() {
    if (
      selectedProject === null ||
      getAliasValidationError(state.aliases) !== null ||
      getSignatureValidationError(state.signatureDraft) !== null
    ) {
      return;
    }

    dispatch({ type: "activation-start" });

    const input: ActivationWizardInput = {
      projectId: selectedProject.projectId,
      projectAlias: state.aliasDraft.trim(),
      aliases: state.aliases,
      signature: normalizeSignatureDraft(state.signatureDraft)
    };

    const result = await activateProjectFromWizardAction(input);
    if (!result.ok) {
      dispatch({
        type: "activation-error",
        message: result.message
      });
      return;
    }

    dispatch({
      type: "activation-success",
      project: result.data
    });
  }

  function handleContinue() {
    if (!canContinue) {
      return;
    }

    dispatch({ type: "go-next" });
  }

  function handleClose() {
    if (isPending) {
      return;
    }

    onClose();
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
        className="max-w-[960px] gap-0 overflow-hidden rounded-2xl border-0 p-0 shadow-2xl ring-1 ring-slate-200 [&>button]:hidden"
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
        <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
        <DialogDescription className="sr-only">
          {dialogDescription}
        </DialogDescription>
        <div className="relative flex h-[min(760px,92vh)] w-[min(960px,94vw)] overflow-hidden bg-white">
          <SidebarChecklist
            currentStep={state.step}
            stepValid={stepValid}
            activated={isActivated}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-start justify-between border-b border-slate-100 px-8 py-4">
              <div>
                <p className="text-[15px] font-semibold text-slate-900">
                  {dialogTitle}
                </p>
                <p className="mt-1 text-[12px] text-slate-500">
                  {dialogDescription}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close activation wizard"
                disabled={isPending}
                onClick={handleClose}
                className="flex size-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>

            <div className="flex-1 overflow-auto px-8 py-6">
              {state.activatedProject !== null ? (
                <StepSuccess
                  aliasDraft={state.aliasDraft}
                  projectName={state.activatedProject.projectName}
                  aliasesCount={state.aliases.length}
                />
              ) : null}

              {!isActivated && state.step === 0 ? (
                <StepPickProject
                  inactiveProjects={inactiveProjects}
                  selectedProjectId={state.pickedProjectId}
                  aliasDraft={state.aliasDraft}
                  onAliasChange={(nextValue) => {
                    dispatch({ type: "set-alias", aliasDraft: nextValue });
                  }}
                  onPickProject={(project) => {
                    dispatch({ type: "pick-project", project });
                  }}
                />
              ) : null}

              {!isActivated && state.step === 1 ? (
                <StepAliases
                  aliasDraft={state.aliasDraft}
                  aliases={state.aliases}
                  onAddAlias={(address) => {
                    dispatch({ type: "add-alias", address });
                  }}
                  onMakePrimary={(address) => {
                    dispatch({ type: "make-primary", address });
                  }}
                  onRemoveAlias={(address) => {
                    dispatch({ type: "remove-alias", address });
                  }}
                />
              ) : null}

              {!isActivated && state.step === 2 ? (
                <StepSignature
                  aliasDraft={state.aliasDraft}
                  primaryAliasAddress={primaryAlias?.address ?? null}
                  signatureDraft={state.signatureDraft}
                  onSignatureChange={(nextValue) => {
                    dispatch({ type: "set-signature", signatureDraft: nextValue });
                  }}
                />
              ) : null}

              {!isActivated && state.step === 3 ? (
                <StepKnowledge
                  notionUrl={state.notionUrl}
                  knowledgeStatus={state.knowledgeStatus}
                  knowledgeMessage={state.knowledgeMessage}
                  onNotionUrlChange={(nextValue) => {
                    dispatch({ type: "set-notion-url", notionUrl: nextValue });
                  }}
                  onSync={() => {
                    void handleSync();
                  }}
                />
              ) : null}

              {!isActivated && state.step === 4 ? (
                <StepReview
                  selectedProject={selectedProject}
                  aliasDraft={state.aliasDraft}
                  aliases={state.aliases}
                  notionUrl={state.notionUrl}
                  signatureDraft={state.signatureDraft}
                  activationError={state.activationMessage}
                />
              ) : null}
            </div>

            <footer className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-8 py-4">
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: "go-back" });
                }}
                disabled={state.step === 0 || isActivated || isPending}
                className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-600 transition-colors hover:text-slate-900 disabled:invisible"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Back
              </button>

              {isActivated ? (
                <Button type="button" onClick={handleClose}>
                  Done
                </Button>
              ) : state.step === 4 ? (
                <Button
                  type="button"
                  onClick={() => {
                    void handleActivate();
                  }}
                  disabled={state.activationStatus === "pending"}
                >
                  {state.activationStatus === "pending" ? (
                    <>
                      <RefreshCw
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden="true"
                      />
                      Activating...
                    </>
                  ) : (
                    "Activate project"
                  )}
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={handleContinue}
                  disabled={!canContinue || state.knowledgeStatus === "syncing"}
                >
                  Continue
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              )}
            </footer>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
