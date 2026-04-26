import { formatContactRecipientLabel } from "../_lib/composer-ui";
import type { ComposerValidationError } from "./inbox-client-provider";
import type { ComposerRecipientValue } from "./composer-recipient-picker";
import type { UiError } from "@/src/server/ui-result";

export interface AttachmentDraft {
  readonly id: string;
  readonly filename: string;
  readonly size: number;
  readonly contentType: string;
  readonly contentBase64: string | null;
}

export interface InlineComposerError {
  readonly message: string;
  readonly retryable: boolean;
}

export type ComposerFieldErrors = readonly ComposerValidationError[];

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${String(Math.round(bytes / 1024))} KB`;
  }

  return `${String(bytes)} B`;
}

export function resolveRecipientLabel(recipient: ComposerRecipientValue): string {
  return recipient.kind === "contact"
    ? formatContactRecipientLabel({
        displayName: recipient.displayName,
        primaryEmail: recipient.primaryEmail,
      })
    : recipient.emailAddress;
}

export function resolveComposerDraftKey(input: {
  readonly actorId: string;
  readonly recipient: ComposerRecipientValue | null;
}): string | null {
  const recipient = input.recipient;

  if (recipient === null) {
    return null;
  }

  if (recipient.kind === "contact") {
    return `composer-draft:v1:${input.actorId}:${recipient.contactId}:contact`;
  }

  return `composer-draft:v1:${input.actorId}:email:${normalizeEmail(
    recipient.emailAddress,
  )}`;
}

export function mapFieldErrors(
  result: Pick<UiError, "fieldErrors">,
): ComposerFieldErrors {
  if (result.fieldErrors === undefined) {
    return [];
  }

  const mappedErrors: ComposerValidationError[] = [];

  for (const [field, message] of Object.entries(result.fieldErrors)) {
    switch (field) {
      case "alias":
        mappedErrors.push({ field: "alias", message });
        break;
      case "subject":
        mappedErrors.push({ field: "subject", message });
        break;
      case "attachments":
        mappedErrors.push({ field: "attachments", message });
        break;
      case "body":
      case "bodyPlaintext":
      case "bodyHtml":
        mappedErrors.push({ field: "body", message });
        break;
      default:
        if (field.startsWith("recipient")) {
          mappedErrors.push({ field: "recipient", message });
        }
    }
  }

  return mappedErrors;
}

export function autoResizeTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = "auto";
  const lineHeight = 24;
  textarea.style.height = `${String(Math.min(textarea.scrollHeight, lineHeight * 20))}px`;
}

export async function readFileAsAttachment(
  file: File,
): Promise<AttachmentDraft> {
  const contentBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result;

      if (typeof result !== "string") {
        reject(new Error("Failed to read file."));
        return;
      }

      const [, base64] = result.split(",", 2);

      if (!base64) {
        reject(new Error("Failed to encode file."));
        return;
      }

      resolve(base64);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read file."));
    };
    reader.readAsDataURL(file);
  });

  return {
    id: `${file.name}:${String(file.lastModified)}:${String(file.size)}`,
    filename: file.name,
    size: file.size,
    contentType: file.type || "application/octet-stream",
    contentBase64,
  };
}

export function resolveAiWarningMessage(input: {
  readonly warnings: readonly { readonly code: string; readonly message: string }[];
  readonly responseMode: string | null;
}): string | null {
  const contradiction = input.warnings.find(
    (warning) => warning.code === "grounding_contradiction",
  );

  if (contradiction) {
    return `Your directive appears to contradict the project context. ${contradiction.message}`;
  }

  if (input.responseMode === "deterministic_fallback") {
    return (
      input.warnings[0]?.message ??
      "AI drafting returned a fallback skeleton. Fill in the project-specific answer before sending."
    );
  }

  const grounding = input.warnings.find(
    (warning) => warning.code === "grounding_empty",
  );
  return grounding?.message ?? null;
}
