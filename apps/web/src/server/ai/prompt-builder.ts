import type { AiDraftRequest, GroundingBundle } from "./types";

interface BuiltPrompt {
  readonly system: string;
  readonly messages: readonly {
    readonly role: "user";
    readonly content: string;
  }[];
}

function renderContextSection(
  title: string,
  content: string | null,
  fallbackLabel: string,
): string {
  return [`[${title}]`, content?.trim().length ? content.trim() : fallbackLabel].join(
    "\n",
  );
}

function renderRecentEvents(bundle: GroundingBundle): string {
  if (bundle.recentEvents.length === 0) {
    return "No recent thread context is available.";
  }

  return bundle.recentEvents
    .map((event) =>
      [
        `- ${event.occurredAt} | ${event.direction} ${event.channel}`,
        event.subject ? `Subject: ${event.subject}` : null,
        event.body ? `Body: ${event.body}` : null,
      ]
        .filter((value): value is string => value !== null)
        .join("\n"),
    )
    .join("\n\n");
}

function buildSystemPrompt(bundle: GroundingBundle): string {
  return [
    renderContextSection(
      "Tier 1 Voice Instructions",
      bundle.generalTraining?.content ?? null,
      "(No global voice instructions are available.)",
    ),
    "",
    renderContextSection(
      "Tier 2 Project Context",
      bundle.projectContext?.content ?? null,
      "(No project-specific context is available.)",
    ),
    "",
    "You are drafting a reply to a volunteer. Use only the information above and the inbound message. Never invent facts.",
  ].join("\n");
}

function buildContextPayload(bundle: GroundingBundle): string {
  return [
    "Inbound message:",
    bundle.targetInbound?.body ?? "[No inbound message was captured.]",
    "",
    "Recent thread context:",
    renderRecentEvents(bundle),
  ].join("\n");
}

function finalizeUserPrompt(parts: readonly string[]): string {
  return [
    ...parts,
    "",
    "Output ONLY the final reply text. Do not include any preamble, sign-off commentary, or marker text OTHER than the contradiction marker if triggered.",
  ].join("\n");
}

export function buildDraftPrompt(
  bundle: GroundingBundle,
  input: Extract<AiDraftRequest, { mode: "draft" }>,
): BuiltPrompt {
  void input;
  return {
    system: buildSystemPrompt(bundle),
    messages: [
      {
        role: "user",
        content: finalizeUserPrompt([buildContextPayload(bundle)]),
      },
    ],
  };
}

export function buildFillPrompt(
  bundle: GroundingBundle,
  input: Extract<AiDraftRequest, { mode: "fill" }>,
): BuiltPrompt {
  return {
    system: buildSystemPrompt(bundle),
    messages: [
      {
        role: "user",
        content: finalizeUserPrompt([
          buildContextPayload(bundle),
          "",
          "Operator directive:",
          input.operatorPrompt,
          "",
          "Expand the operator's directive into a complete reply in the voice and context above. If the directive contradicts the project context, produce the draft as directed AND emit a clear marker that the operator should reconfirm. Example marker: [NOTE: directive may conflict with project context — please verify X].",
        ]),
      },
    ],
  };
}

export function buildRepromptPrompt(
  bundle: GroundingBundle,
  input: Extract<AiDraftRequest, { mode: "reprompt" }>,
): BuiltPrompt {
  return {
    system: buildSystemPrompt(bundle),
    messages: [
      {
        role: "user",
        content: finalizeUserPrompt([
          buildContextPayload(bundle),
          "",
          "Previous draft:",
          input.previousDraft,
          "",
          "Reprompt direction:",
          input.repromptDirection,
          "",
          "Revise the previous draft in light of the direction. Keep the voice and grounding constraints.",
        ]),
      },
    ],
  };
}

export function buildPrompt(
  bundle: GroundingBundle,
  input: AiDraftRequest,
): BuiltPrompt {
  switch (input.mode) {
    case "draft":
      return buildDraftPrompt(bundle, input);
    case "fill":
      return buildFillPrompt(bundle, input);
    case "reprompt":
      return buildRepromptPrompt(bundle, input);
  }
}

export function buildPromptPreview(prompt: BuiltPrompt): string {
  const messageBody = prompt.messages
    .map((message) => `[${message.role.toUpperCase()}]\n${message.content}`)
    .join("\n\n");

  return [`[SYSTEM]`, prompt.system, "", messageBody].join("\n");
}

