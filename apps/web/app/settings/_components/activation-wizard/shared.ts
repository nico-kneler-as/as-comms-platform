import type { ProjectRowViewModel } from "@/src/server/settings/selectors";
import { parseSourceUrl } from "@as-comms/db/parse-source-url";

import {
  getProjectAliasSignatureValidationError,
  normalizeProjectAliasSignature,
  PROJECT_ALIAS_SIGNATURE_MAX_LENGTH
} from "../../_lib/project-alias-signature";

export interface AliasDraft {
  readonly address: string;
  readonly isPrimary: boolean;
}

export interface ActivationWizardStep {
  readonly title: string;
  readonly subtitle: string;
}

export const PROJECT_EMAIL_DOMAIN = "adventurescientists.org";

export const ACTIVATION_WIZARD_STEPS = [
  {
    title: "Pick project",
    subtitle: "Choose from Salesforce and set its internal alias."
  },
  {
    title: "Inbox aliases",
    subtitle: "Where volunteers write to reach this project."
  },
  {
    title: "Email signature",
    subtitle: "Appended to every outbound email from this project."
  },
  {
    title: "AI knowledge",
    subtitle: "Add the sources the AI should learn from, or skip for now."
  },
  {
    title: "Connected projects",
    subtitle:
      "Optionally roll inactive Salesforce projects into this one's inbox."
  },
  {
    title: "Review & activate",
    subtitle: "Confirm the project is ready to route mail."
  }
] as const satisfies readonly ActivationWizardStep[];

export function buildDefaultSignature(aliasDraft: string): string {
  const normalizedAlias = aliasDraft.trim().length > 0 ? aliasDraft.trim() : "Project";
  return `Warmly,\nThe ${normalizedAlias} Team\nAdventure Scientists`;
}

export function buildInitialAliasDraft(project: ProjectRowViewModel | null): string {
  if (project === null) {
    return "";
  }

  return project.projectAlias ?? project.suggestedAlias;
}

export function buildInitialAliases(project: ProjectRowViewModel | null): readonly AliasDraft[] {
  if (project === null) {
    return [];
  }

  return project.emailAliases.map((address) => ({
    address,
    isPrimary:
      project.primaryEmail !== null &&
      project.primaryEmail.toLowerCase() === address.toLowerCase()
  }));
}

export function buildProjectEmailPreview(aliasDraft: string): string {
  const slug = slugifyProjectAlias(aliasDraft);
  return `${slug.length > 0 ? slug : "project"}@${PROJECT_EMAIL_DOMAIN}`;
}

export function buildSuggestedAliasAddresses(
  aliasDraft: string,
  aliases: readonly AliasDraft[]
): readonly string[] {
  const slug = slugifyProjectAlias(aliasDraft);
  if (slug.length === 0) {
    return [];
  }

  const existing = new Set(
    aliases.map((alias) => alias.address.trim().toLowerCase())
  );

  return [
    `${slug}@${PROJECT_EMAIL_DOMAIN}`,
    `${slug.replace(/-/g, "")}@${PROJECT_EMAIL_DOMAIN}`
  ].filter((address, index, values) => {
    return (
      values.indexOf(address) === index &&
      !existing.has(address.toLowerCase())
    );
  });
}

export function getPrimaryAlias(
  aliases: readonly AliasDraft[]
): AliasDraft | null {
  return aliases.find((alias) => alias.isPrimary) ?? null;
}

export function getStepOneValid(input: {
  readonly pickedProjectId: string | null;
  readonly aliasDraft: string;
}): boolean {
  return input.pickedProjectId !== null && input.aliasDraft.trim().length >= 2;
}

export function getStepTwoValid(aliases: readonly AliasDraft[]): boolean {
  return getAliasValidationError(aliases) === null;
}

export function getStepThreeValid(signatureDraft: string): boolean {
  return getSignatureValidationError(signatureDraft) === null;
}

export function getAliasValidationError(
  aliases: readonly AliasDraft[]
): string | null {
  if (aliases.length === 0) {
    return "Add at least one inbox alias.";
  }

  const primaryCount = aliases.filter((alias) => alias.isPrimary).length;
  if (primaryCount === 0) {
    return "Choose one primary inbox alias.";
  }
  if (primaryCount > 1) {
    return "Choose exactly one primary inbox alias.";
  }

  return null;
}

export function getSignatureValidationError(signatureDraft: string): string | null {
  const normalizedSignature = normalizeProjectAliasSignature(signatureDraft);
  if (normalizedSignature.trim().length < 4) {
    return "Signature must be at least 4 characters.";
  }

  return getProjectAliasSignatureValidationError(normalizedSignature);
}

export function isBasicEmailAddress(value: string): boolean {
  return /^\S+@\S+\.\S+$/.test(value.trim());
}

export function splitAiKnowledgeSourceLines(value: string): readonly string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function getAiKnowledgeSourceLineErrors(
  value: string
): Readonly<Record<number, string>> {
  const lines = value.split(/\r?\n/u);
  const errors: Record<number, string> = {};

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    try {
      parseSourceUrl(trimmed);
    } catch (error) {
      if (error instanceof Error) {
        errors[index] = error.message;
      }
    }
  }

  return errors;
}

export function normalizeAliasAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeSignatureDraft(value: string): string {
  return normalizeProjectAliasSignature(value);
}

export function slugifyProjectAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function truncateSignatureSummary(value: string): string {
  if (value.length <= 80) {
    return value;
  }

  return `${value.slice(0, 77)}...`;
}

export { PROJECT_ALIAS_SIGNATURE_MAX_LENGTH };
