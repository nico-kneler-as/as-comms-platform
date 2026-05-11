import type { ProjectMutationData } from "@/app/settings/actions";
import type { ProjectRowViewModel } from "@/src/server/settings/selectors";

import {
  type AliasDraft,
  buildDefaultSignature,
  buildInitialAliasDraft,
  buildInitialAliases
} from "./shared";

export type StepIndex = 0 | 1 | 2 | 3 | 4 | 5;
export type KnowledgeStatus = "idle" | "syncing" | "done" | "error";

export interface KnowledgeSourceDraft {
  readonly url: string;
  readonly label: string;
}

export interface WizardState {
  readonly step: StepIndex;
  readonly pickedProjectId: string | null;
  readonly aliasDraft: string;
  readonly aliases: readonly AliasDraft[];
  readonly signatureDraft: string;
  readonly knowledgeSourceDrafts: readonly KnowledgeSourceDraft[];
  readonly skipKnowledgeSetup: boolean;
  readonly knowledgeStatus: KnowledgeStatus;
  readonly knowledgeMessage: string | null;
  readonly connectedProjectIds: readonly string[];
  readonly activationStatus: "idle" | "pending" | "error";
  readonly activationMessage: string | null;
  readonly activatedProject: ProjectMutationData | null;
}

export type WizardAction =
  | { readonly type: "go-back" }
  | { readonly type: "go-next" }
  | { readonly type: "go-to-step"; readonly step: StepIndex }
  | { readonly type: "pick-project"; readonly project: ProjectRowViewModel }
  | { readonly type: "set-alias"; readonly aliasDraft: string }
  | { readonly type: "add-alias"; readonly address: string }
  | { readonly type: "remove-alias"; readonly address: string }
  | { readonly type: "make-primary"; readonly address: string }
  | { readonly type: "set-signature"; readonly signatureDraft: string }
  | { readonly type: "add-knowledge-source-row" }
  | { readonly type: "remove-knowledge-source-row"; readonly index: number }
  | {
      readonly type: "set-knowledge-source-field";
      readonly index: number;
      readonly field: "url" | "label";
      readonly value: string;
    }
  | { readonly type: "set-skip-knowledge-setup"; readonly checked: boolean }
  | { readonly type: "sync-start" }
  | { readonly type: "sync-done" }
  | { readonly type: "sync-error"; readonly message: string }
  | { readonly type: "toggle-connected-project"; readonly projectId: string }
  | { readonly type: "activation-start" }
  | { readonly type: "activation-error"; readonly message: string }
  | { readonly type: "activation-success"; readonly project: ProjectMutationData };

// Wizard always starts the AI Knowledge step with one empty row so the
// operator sees the input shape immediately. If the project already has a
// legacy single `ai_knowledge_url`, seed it into the first row so
// re-activating a pre-migration project shows the existing source as
// editable rather than dropping it.
function buildInitialKnowledgeSourceDrafts(
  project: ProjectRowViewModel | null
): readonly KnowledgeSourceDraft[] {
  const initialUrl = project?.aiKnowledgeUrl?.trim() ?? "";
  return [{ url: initialUrl, label: "" }];
}

export function createInitialState(
  projects: readonly ProjectRowViewModel[],
  initialProjectId?: string
): WizardState {
  const initialProject =
    projects.find((project) => project.projectId === initialProjectId) ?? null;

  return {
    step: 0,
    pickedProjectId: initialProject?.projectId ?? null,
    aliasDraft: buildInitialAliasDraft(initialProject),
    aliases: buildInitialAliases(initialProject),
    signatureDraft: "",
    knowledgeSourceDrafts: buildInitialKnowledgeSourceDrafts(initialProject),
    skipKnowledgeSetup: false,
    knowledgeStatus: "idle",
    knowledgeMessage: null,
    connectedProjectIds: [],
    activationStatus: "idle",
    activationMessage: null,
    activatedProject: null
  };
}

function resetKnowledgeState(state: WizardState): WizardState {
  return {
    ...state,
    knowledgeStatus: "idle",
    knowledgeMessage: null,
  };
}

function prepareStateForStep(state: WizardState, step: StepIndex): WizardState {
  if (step === 2 && state.signatureDraft.trim().length === 0) {
    return {
      ...state,
      step,
      signatureDraft: buildDefaultSignature(state.aliasDraft)
    };
  }

  return {
    ...state,
    step
  };
}

export function activationWizardReducer(
  state: WizardState,
  action: WizardAction
): WizardState {
  switch (action.type) {
    case "go-back":
      return prepareStateForStep(
        {
          ...state,
          activationMessage: null,
          activationStatus: "idle"
        },
        Math.max(state.step - 1, 0) as StepIndex
      );
    case "go-next":
      return prepareStateForStep(
        {
          ...state,
          activationMessage: null,
          activationStatus: "idle"
        },
        Math.min(state.step + 1, 5) as StepIndex
      );
    case "go-to-step":
      return prepareStateForStep(
        {
          ...state,
          activationMessage: null,
          activationStatus: "idle"
        },
        action.step
      );
    case "pick-project":
      return {
        step: 0,
        pickedProjectId: action.project.projectId,
        aliasDraft: buildInitialAliasDraft(action.project),
        aliases: buildInitialAliases(action.project),
        signatureDraft: "",
        knowledgeSourceDrafts: buildInitialKnowledgeSourceDrafts(action.project),
        skipKnowledgeSetup: false,
        knowledgeStatus: "idle",
        knowledgeMessage: null,
        connectedProjectIds: [],
        activationStatus: "idle",
        activationMessage: null,
        activatedProject: null
      };
    case "set-alias": {
      const nextAlias = action.aliasDraft;
      const nextSignature =
        state.signatureDraft === buildDefaultSignature(state.aliasDraft)
          ? buildDefaultSignature(nextAlias)
          : state.signatureDraft;

      return {
        ...state,
        aliasDraft: nextAlias,
        signatureDraft: nextSignature,
        activationMessage: null,
        activationStatus: "idle"
      };
    }
    case "add-alias":
      return {
        ...state,
        aliases: [
          ...state.aliases,
          {
            address: action.address,
            isPrimary: state.aliases.length === 0
          }
        ],
        activationMessage: null,
        activationStatus: "idle"
      };
    case "remove-alias": {
      const remaining = state.aliases.filter(
        (alias) => alias.address !== action.address
      );
      const primaryExists = remaining.some((alias) => alias.isPrimary);
      return {
        ...state,
        aliases:
          remaining.length > 0 && !primaryExists
            ? remaining.map((alias, index) => ({
                ...alias,
                isPrimary: index === 0
              }))
            : remaining,
        activationMessage: null,
        activationStatus: "idle"
      };
    }
    case "make-primary":
      return {
        ...state,
        aliases: state.aliases.map((alias) => ({
          ...alias,
          isPrimary: alias.address === action.address
        })),
        activationMessage: null,
        activationStatus: "idle"
      };
    case "set-signature":
      return {
        ...state,
        signatureDraft: action.signatureDraft,
        activationMessage: null,
        activationStatus: "idle"
      };
    case "add-knowledge-source-row":
      return {
        ...resetKnowledgeState(state),
        knowledgeSourceDrafts: [
          ...state.knowledgeSourceDrafts,
          { url: "", label: "" }
        ],
        skipKnowledgeSetup: false,
        activationMessage: null,
        activationStatus: "idle"
      };
    case "remove-knowledge-source-row": {
      const filtered = state.knowledgeSourceDrafts.filter(
        (_draft, index) => index !== action.index
      );
      // Never let the operator delete down to zero rows — keep at least one
      // empty placeholder so they can keep typing without re-clicking "Add
      // source." Matches the project-detail UX which always shows the Add
      // dialog as the entry point.
      const nextDrafts =
        filtered.length === 0 ? [{ url: "", label: "" }] : filtered;
      return {
        ...resetKnowledgeState(state),
        knowledgeSourceDrafts: nextDrafts,
        skipKnowledgeSetup: false,
        activationMessage: null,
        activationStatus: "idle"
      };
    }
    case "set-knowledge-source-field": {
      const nextDrafts = state.knowledgeSourceDrafts.map((draft, index) =>
        index === action.index
          ? { ...draft, [action.field]: action.value }
          : draft
      );
      return {
        ...resetKnowledgeState(state),
        knowledgeSourceDrafts: nextDrafts,
        skipKnowledgeSetup: false,
        activationMessage: null,
        activationStatus: "idle"
      };
    }
    case "set-skip-knowledge-setup":
      return {
        ...resetKnowledgeState(state),
        skipKnowledgeSetup: action.checked,
        activationMessage: null,
        activationStatus: "idle"
      };
    case "sync-start":
      return {
        ...state,
        knowledgeStatus: "syncing",
        knowledgeMessage: null,
        activationMessage: null,
        activationStatus: "idle"
      };
    case "sync-done":
      return {
        ...state,
        knowledgeStatus: "done",
        knowledgeMessage: null
      };
    case "sync-error":
      return {
        ...state,
        knowledgeStatus: "error",
        knowledgeMessage: action.message
      };
    case "toggle-connected-project": {
      const isSelected = state.connectedProjectIds.includes(action.projectId);
      return {
        ...state,
        connectedProjectIds: isSelected
          ? state.connectedProjectIds.filter(
              (projectId) => projectId !== action.projectId
            )
          : [...state.connectedProjectIds, action.projectId],
        activationMessage: null,
        activationStatus: "idle"
      };
    }
    case "activation-start":
      return {
        ...state,
        activationStatus: "pending",
        activationMessage: null
      };
    case "activation-error":
      return {
        ...state,
        step: 5,
        activationStatus: "error",
        activationMessage: action.message
      };
    case "activation-success":
      return {
        ...state,
        activationStatus: "idle",
        activationMessage: null,
        activatedProject: action.project
      };
    default:
      return state;
  }
}
