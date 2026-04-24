import type { ContactRecord } from "@as-comms/contracts";

import type { AiDraftWarningCode } from "./types";

function extractFirstName(contact: ContactRecord | null): string {
  const firstName = contact?.displayName.trim().split(/\s+/u)[0];
  return firstName && firstName.length > 0 ? firstName : "{firstName}";
}

function extractTopicPlaceholder(inbound: string): string {
  const normalized = inbound
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.?!]+$/u, "");

  if (normalized.length === 0) {
    return "[the specific topic from the message]";
  }

  const topicGuess = normalized.slice(0, 80).trim();
  return `[${topicGuess}]`;
}

function resolveInstruction(warning: AiDraftWarningCode): string {
  switch (warning) {
    case "grounding_empty":
      return "[Add the answer or next step here — there isn't a project-specific pattern for this yet.]";
    case "provider_not_configured":
    case "provider_timeout":
    case "provider_rate_limited":
    case "provider_unavailable":
    case "validation_blocked":
      return "[The AI assistant is unavailable right now. Please fill in the substantive answer.]";
    default:
      return "[Add the substantive answer here.]";
  }
}

export function buildSkeletonDraft(input: {
  readonly inbound: string;
  readonly contact: ContactRecord | null;
  readonly warning: AiDraftWarningCode;
}): string {
  return [
    `Hi ${extractFirstName(input.contact)},`,
    "",
    `Thanks for reaching out about ${extractTopicPlaceholder(input.inbound)}. ${resolveInstruction(
      input.warning,
    )}`,
    "",
    "Let me know if you have more questions.",
    "",
    "Best,",
  ].join("\n");
}

