"use server";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { requireSession } from "@/src/server/auth/session";
import { getAiProviderConfig } from "@/src/server/ai/provider";
import { loadGeneralVoiceEntry } from "@/src/server/ai/retriever";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";
import type { UiResult } from "@/src/server/ui-result";

const polishTextActionInputSchema = z.object({
  text: z.string().refine((value) => value.trim().length >= 1, {
    message: "Text is required.",
  }),
  channel: z.enum(["email", "sms"]),
});

const EMAIL_POLISH_SYSTEM_PROMPT =
  "You are a text-polishing assistant. The operator will give you a draft message. Polish it: fix grammar and typos, tighten phrasing, and improve clarity while preserving the meaning, the facts, and the operator's voice. Do NOT add new information. Do NOT remove substantive content. Do NOT append a signature or sign-off. Return only the polished text — no preamble, no commentary, no quotation marks around the output.";
const SMS_POLISH_SYSTEM_PROMPT =
  "You are a text-polishing assistant for SMS. The operator will give you a draft SMS. Polish it: fix grammar and typos, tighten phrasing, and improve clarity while preserving the meaning and the facts. Keep it concise — target ~140 characters and never exceed 320 (two segments). Plain text only — no markdown, no signature, no salutation if the draft doesn't have one. Return only the polished text — no preamble, no commentary, no quotation marks around the output.";
const SMS_POLISH_MAX_TOKENS = 120;

function buildPolishSystemPrompt(input: {
  readonly channel: "email" | "sms";
  readonly generalVoiceContent: string | null;
}): string {
  const barePrompt =
    input.channel === "sms"
      ? SMS_POLISH_SYSTEM_PROMPT
      : EMAIL_POLISH_SYSTEM_PROMPT;

  if (input.generalVoiceContent === null || input.generalVoiceContent.trim() === "") {
    return barePrompt;
  }

  return [
    "[Tier 1 Voice Instructions]",
    input.generalVoiceContent.trim(),
    "",
    barePrompt,
  ].join("\n");
}

function unauthorizedError(requestId: string): UiResult<never> {
  return {
    ok: false,
    code: "unauthorized",
    message: "You must be signed in to continue.",
    requestId,
    retryable: false,
  };
}

function validationError(
  requestId: string,
  message: string,
  fieldErrors: Record<string, string>,
): UiResult<never> {
  return {
    ok: false,
    code: "validation_error",
    message,
    requestId,
    fieldErrors,
    retryable: false,
  };
}

function toFieldErrors(
  issues: readonly { path: readonly (string | number)[]; message: string }[],
) {
  return Object.fromEntries(
    issues.map((issue) => [issue.path.join("."), issue.message]),
  );
}

export async function polishTextAction(input: {
  readonly text: string;
  readonly channel: "email" | "sms";
}): Promise<UiResult<{ readonly polishedText: string }>> {
  const requestId = randomUUID();
  const parsedInput = polishTextActionInputSchema.safeParse(input);

  if (!parsedInput.success) {
    return validationError(
      requestId,
      "Polish input is invalid.",
      toFieldErrors(parsedInput.error.issues),
    );
  }

  let currentUser;
  try {
    currentUser = await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return unauthorizedError(requestId);
    }

    throw error;
  }

  const provider = getAiProviderConfig();
  const runtime = await getStage1WebRuntime();

  if (provider.invokeModel === null) {
    return {
      ok: false,
      code: "ai_polish_misconfigured",
      message: "AI polish isn't fully set up for this workspace yet. Please contact an admin.",
      requestId,
      retryable: false,
    };
  }

  try {
    const generalVoiceEntry = await loadGeneralVoiceEntry(runtime.repositories);
    const modelResult = await provider.invokeModel({
      model: provider.model,
      system: buildPolishSystemPrompt({
        channel: parsedInput.data.channel,
        generalVoiceContent: generalVoiceEntry?.content ?? null,
      }),
      messages: [
        {
          role: "user",
          content: parsedInput.data.text,
        },
      ],
      maxTokens:
        parsedInput.data.channel === "sms"
          ? SMS_POLISH_MAX_TOKENS
          : provider.maxTokens,
      temperature: provider.temperature,
    });

    // v1 intentionally skips cost-counter integration because the current
    // helper is project-scoped and polish has no project context.
    return {
      ok: true,
      data: {
        polishedText: modelResult.text.trim(),
      },
      requestId,
    };
  } catch (error) {
    console.error("[composer/polish] unexpected failure", {
      requestId,
      actorId: currentUser.id,
      channel: parsedInput.data.channel,
      error,
    });

    return {
      ok: false,
      code: "ai_polish_failed",
      message: "We could not polish this text right now. Please try again.",
      requestId,
      retryable: true,
    };
  }
}
