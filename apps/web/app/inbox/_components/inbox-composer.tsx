"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
} from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  getInternalNoteValidationError,
  normalizeInternalNoteBody,
} from "@/src/lib/internal-note-validation";
import type { UiError } from "@/src/server/ui-result";

import {
  createNoteAction,
  draftWithAiAction,
  sendComposerAction,
  type ComposerSendActionInput,
} from "../actions";
import {
  formatContactRecipientLabel,
  isComposerSendDisabled,
  resolveDefaultAlias,
} from "../_lib/composer-ui";
import type { InboxComposerAliasOption } from "../_lib/view-models";
import {
  ComposerRecipientPicker,
  type ComposerContactRecipient,
  type ComposerRecipientValue,
} from "./composer-recipient-picker";
import {
  useInboxClient,
  type ComposerValidationError,
} from "./inbox-client-provider";
import { AiDraftReprompt } from "./ai-draft-reprompt";
import {
  AlertCircleIcon,
  ChevronDownIcon,
  ImageIcon,
  LoaderIcon,
  MailIcon,
  NoteIcon,
  PaperclipIcon,
  SendIcon,
  SparkleIcon,
  XIcon,
} from "./icons";

const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

interface AttachmentDraft {
  readonly id: string;
  readonly filename: string;
  readonly size: number;
  readonly contentType: string;
  readonly contentBase64: string;
}

interface InlineComposerError {
  readonly message: string;
  readonly retryable: boolean;
}

interface SenderPickerProps {
  readonly aliases: readonly InboxComposerAliasOption[];
  readonly selectedAlias: string | null;
  readonly errorMessage: string | undefined;
  readonly onAliasChange: (alias: string | null) => void;
}

type ComposerFieldErrors = readonly ComposerValidationError[];

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${String(Math.round(bytes / 1024))} KB`;
  }

  return `${bytes.toString()} B`;
}

function resolveRecipientLabel(recipient: ComposerRecipientValue): string {
  return recipient.kind === "contact"
    ? formatContactRecipientLabel({
        displayName: recipient.displayName,
        primaryEmail: recipient.primaryEmail,
      })
    : recipient.emailAddress;
}

function mapFieldErrors(
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

function autoResizeTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = "auto";
  const lineHeight = 24;
  textarea.style.height = `${String(Math.min(textarea.scrollHeight, lineHeight * 20))}px`;
}

import { resolveAiButtonState } from "../_lib/composer-ai";

function resolveAiWarningMessage(
  aiDraft: ReturnType<typeof useInboxClient>["aiDraft"],
): string | null {
  const contradiction = aiDraft.warnings.find(
    (warning) => warning.code === "grounding_contradiction",
  );

  if (contradiction) {
    return `Your directive appears to contradict the project context. ${contradiction.message}`;
  }

  if (aiDraft.responseMode === "deterministic_fallback") {
    return (
      aiDraft.warnings[0]?.message ??
      "AI drafting returned a fallback skeleton. Fill in the project-specific answer before sending."
    );
  }

  const grounding = aiDraft.warnings.find(
    (warning) => warning.code === "grounding_empty",
  );
  if (grounding) {
    return grounding.message;
  }

  return null;
}

function SenderPicker({
  aliases,
  selectedAlias,
  errorMessage,
  onAliasChange,
}: SenderPickerProps) {
  const selectedOption =
    aliases.find((alias) => alias.alias === selectedAlias) ?? null;

  return (
    <label className="flex items-start gap-3">
      <span className="mt-3 w-20 text-sm font-medium text-slate-700">
        Send from:
      </span>
      <div className="flex-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-invalid={errorMessage ? true : undefined}
              className={cn(
                "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left shadow-sm transition-colors hover:border-slate-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-300",
                errorMessage ? "border-rose-300 ring-1 ring-rose-200" : "",
              )}
            >
              <span className="min-w-0">
                {selectedOption ? (
                  <span className="block min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {selectedOption.alias}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {selectedOption.projectName}
                    </span>
                  </span>
                ) : (
                  <span className="text-sm text-slate-500">
                    Choose a sender alias
                  </span>
                )}
              </span>
              <ChevronDownIcon className="size-4 shrink-0 text-slate-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[20rem] rounded-xl p-2"
          >
            <DropdownMenuLabel className="px-2 pb-2 pt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
              Send from
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={selectedAlias ?? ""}
              onValueChange={(value) => {
                onAliasChange(value.length > 0 ? value : null);
              }}
            >
              <DropdownMenuRadioItem value="" className="rounded-lg">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-slate-700">
                    No alias selected
                  </span>
                  <span className="text-xs text-slate-500">
                    Pick a sender before sending
                  </span>
                </div>
              </DropdownMenuRadioItem>
              {aliases.map((alias) => (
                <DropdownMenuRadioItem
                  key={alias.id}
                  value={alias.alias}
                  className="rounded-lg"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-slate-900">
                      {alias.alias}
                    </span>
                    <span className="truncate text-xs text-slate-500">
                      {alias.projectName}
                    </span>
                  </div>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {errorMessage ? (
          <p className="mt-1 text-xs text-rose-700">{errorMessage}</p>
        ) : null}
      </div>
    </label>
  );
}

async function readFileAsAttachment(file: File): Promise<AttachmentDraft> {
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
    id: `${file.name}:${file.lastModified.toString()}:${file.size.toString()}`,
    filename: file.name,
    size: file.size,
    contentType: file.type || "application/octet-stream",
    contentBase64,
  };
}

export function InboxComposerReplyBar({
  contactDisplayName,
  onReply,
}: {
  readonly contactDisplayName: string;
  readonly onReply: () => void;
}) {
  return (
    <div className="border-t border-slate-200 bg-white">
      <button
        type="button"
        onClick={onReply}
        className="flex w-full items-center gap-2.5 px-5 py-3 text-left text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700"
      >
        <MailIcon className="size-4 shrink-0" />
        <span className="truncate">Reply to {contactDisplayName}…</span>
      </button>
    </div>
  );
}

export function InboxComposerDetailPane() {
  const router = useRouter();
  const {
    composerAliases,
    composerPane,
    aiDraft,
    closeComposer,
    showToast,
    composerErrors,
    setComposerErrors,
    setComposerStatus,
    startAiGeneration,
    insertAiDraft,
    markAiDraftEdited,
    repromptAi,
    resetAiDraft,
    setAiError,
  } = useInboxClient();
  const [activeTab, setActiveTab] = useState<"email" | "note">("email");
  const [recipient, setRecipient] = useState<ComposerRecipientValue | null>(
    null,
  );
  const [selectedAlias, setSelectedAlias] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<readonly AttachmentDraft[]>(
    [],
  );
  const [repromptText, setRepromptText] = useState("");
  const [inlineError, setInlineError] = useState<InlineComposerError | null>(
    null,
  );
  const [isSending, startSendTransition] = useTransition();
  const [isSavingNote, startSaveNoteTransition] = useTransition();
  const [isGeneratingAi, startAiTransition] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const replyContext =
    composerPane.mode === "replying" ? composerPane.replyContext : null;

  useEffect(() => {
    if (composerPane.mode === "closed") {
      return;
    }

    const replyRecipient: ComposerContactRecipient | null =
      replyContext === null
        ? null
        : {
            kind: "contact",
            contactId: replyContext.contactId,
            displayName: replyContext.contactDisplayName,
            primaryEmail: null,
            primaryProjectName: null,
            salesforceContactId: null,
          };

    setActiveTab("email");
    setRecipient(replyRecipient);
    setSelectedAlias(replyContext?.defaultAlias ?? null);
    setSubject(replyContext?.subject ?? "");
    setBody("");
    setAttachments([]);
    setRepromptText("");
    setInlineError(null);
    setComposerStatus("idle");
    setComposerErrors([]);
    resetAiDraft();
  }, [
    composerPane.mode,
    replyContext,
    resetAiDraft,
    setComposerErrors,
    setComposerStatus,
  ]);

  useEffect(() => {
    if (!bodyRef.current) {
      return;
    }

    autoResizeTextarea(bodyRef.current);
  }, [body]);

  if (composerPane.mode === "closed") {
    return null;
  }

  const attachmentBytes = attachments.reduce(
    (total, attachment) => total + attachment.size,
    0,
  );
  const isReplying = composerPane.mode === "replying";
  const canUseNoteTab = isReplying && replyContext !== null;
  const selectedAliasRecord =
    selectedAlias === null
      ? null
      : composerAliases.find((alias) => alias.alias === selectedAlias) ?? null;
  const aiButton = resolveAiButtonState({
    body,
    isGenerating: isGeneratingAi,
  });
  const aiWarningMessage = resolveAiWarningMessage(aiDraft);
  const isSendDisabled = isComposerSendDisabled({
    activeTab,
    recipient,
    selectedAlias,
    subject,
    body,
    isSending,
  });
  const isSaveNoteDisabled =
    activeTab !== "note" ||
    !canUseNoteTab ||
    body.trim().length === 0 ||
    isSavingNote;
  const aliasError = composerErrors.find((error) => error.field === "alias");
  const subjectError = composerErrors.find(
    (error) => error.field === "subject",
  );
  const bodyError = composerErrors.find((error) => error.field === "body");
  const recipientError = composerErrors.find(
    (error) => error.field === "recipient",
  );
  const attachmentError = composerErrors.find(
    (error) => error.field === "attachments",
  );
  const clearComposerErrors = () => {
    setInlineError(null);
    setComposerErrors([]);
  };

  const handleRecipientChange = (
    nextRecipient: ComposerRecipientValue | null,
  ) => {
    setRecipient(nextRecipient);
    clearComposerErrors();

    if (isReplying) {
      return;
    }

    setSelectedAlias(
      resolveDefaultAlias({
        recipient: nextRecipient,
        aliases: composerAliases,
      }),
    );
  };

  const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    event.currentTarget.value = "";

    if (files === null || files.length === 0) {
      return;
    }

    const selectedFiles = Array.from(files);
    const nextTotalBytes =
      attachmentBytes +
      selectedFiles.reduce((total, file) => total + file.size, 0);

    if (nextTotalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      setInlineError({
        message: "Attachments can't exceed 20 MB total.",
        retryable: false,
      });
      setComposerErrors([
        {
          field: "attachments",
          message: "Attachments can't exceed 20 MB total.",
        },
      ]);
      return;
    }

    try {
      const nextAttachments = await Promise.all(
        selectedFiles.map((file) => readFileAsAttachment(file)),
      );

      setAttachments((previous) => [...previous, ...nextAttachments]);
      clearComposerErrors();
    } catch {
      setInlineError({
        message: "We couldn't read one of those files. Please try again.",
        retryable: true,
      });
    }
  };

  const runAiDraft = (requestOverride?: {
    readonly mode: "draft" | "fill" | "reprompt";
    readonly repromptDirection?: string;
  }) => {
    if (activeTab !== "email") {
      return;
    }

    clearComposerErrors();

    if (recipient?.kind !== "contact") {
      setInlineError({
        message: "AI drafting is available only when replying to a contact.",
        retryable: false,
      });
      return;
    }

    const baseRequest = {
      contactId: recipient.contactId,
      projectId: selectedAliasRecord?.projectId ?? null,
      threadCursor: replyContext?.threadCursor ?? null,
    } as const;

    const request =
      requestOverride?.mode === "reprompt"
        ? {
            ...baseRequest,
            mode: "reprompt" as const,
            previousDraft: body.trim(),
            repromptDirection: requestOverride.repromptDirection ?? "",
            repromptIndex: aiDraft.repromptChain.length + 1,
          }
        : aiButton.mode === "draft"
          ? {
              ...baseRequest,
              mode: "draft" as const,
            }
          : {
              ...baseRequest,
              mode: "fill" as const,
              operatorPrompt: body.trim(),
            };

    const prompt =
      request.mode === "reprompt"
        ? request.repromptDirection
        : request.mode === "draft"
          ? "Draft with AI"
          : request.operatorPrompt;

    if (request.mode === "reprompt") {
      repromptAi({
        request,
        prompt,
      });
    } else {
      startAiGeneration({
        request,
        prompt,
      });
    }

    startAiTransition(async () => {
      const result = await draftWithAiAction(request);

      if (!result.ok) {
        setAiError(result.message);
        setInlineError({
          message: result.message,
          retryable: false,
        });
        return;
      }

      clearComposerErrors();
      setInlineError(null);
      setBody(result.data.draft);
      setRepromptText("");
      insertAiDraft({
        request,
        response: result.data,
        prompt,
        ...(request.mode === "reprompt"
          ? {
              repromptDirection: request.repromptDirection,
            }
          : {}),
      });
    });
  };

  const submit = () => {
    if (recipient === null || selectedAlias === null || activeTab !== "email") {
      return;
    }

    const payload: ComposerSendActionInput = {
      recipient:
        recipient.kind === "contact"
          ? {
              kind: "contact",
              contactId: recipient.contactId,
            }
          : {
              kind: "email",
              emailAddress: recipient.emailAddress,
            },
      alias: selectedAlias,
      subject: subject.trim(),
      bodyPlaintext: body.trim(),
      attachments: attachments.map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        contentBase64: attachment.contentBase64,
      })),
      ...(replyContext?.threadId === null || replyContext === null
        ? {}
        : { threadId: replyContext.threadId }),
      ...(replyContext?.inReplyToRfc822 === null || replyContext === null
        ? {}
        : {
            inReplyToRfc822: replyContext.inReplyToRfc822,
          }),
    };

    setInlineError(null);
    setComposerErrors([]);
    setComposerStatus("sending");

    startSendTransition(async () => {
      const result = await sendComposerAction(payload);

      if (result.ok) {
        setComposerStatus("sent-success");
        showToast(`Sent to ${resolveRecipientLabel(recipient)}`, "success");
        closeComposer();
        return;
      }

      setComposerErrors(mapFieldErrors(result));
      setComposerStatus(
        result.code === "validation_error"
          ? "validation-error"
          : "send-failure",
      );
      setInlineError({
        message: result.message,
        retryable: result.retryable === true,
      });
    });
  };

  const saveNote = () => {
    if (!isReplying || replyContext === null) {
      return;
    }

    const normalizedBody = normalizeInternalNoteBody(body);
    const validationError = getInternalNoteValidationError(normalizedBody);

    if (validationError !== null) {
      setInlineError({
        message: validationError,
        retryable: false,
      });
      setComposerErrors([
        {
          field: "body",
          message: validationError,
        },
      ]);
      return;
    }

    setInlineError(null);
    setComposerErrors([]);
    setComposerStatus("saving-draft");

    startSaveNoteTransition(async () => {
      const result = await createNoteAction({
        contactId: replyContext.contactId,
        body: normalizedBody,
      });

      if (result.ok) {
        setComposerStatus("draft-saved");
        setBody("");
        closeComposer();
        router.refresh();
        showToast("Note saved.", "success");
        return;
      }

      setComposerErrors(mapFieldErrors(result));
      setComposerStatus("validation-error");
      setInlineError({
        message: result.message,
        retryable: result.retryable === true,
      });
    });
  };

  return (
    <TooltipProvider>
      <section className="flex min-h-0 flex-1 flex-col bg-white">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <p className="text-lg font-semibold text-slate-900">
              {isReplying && recipient?.kind === "contact"
                ? `Reply to ${recipient.displayName}`
                : "New draft"}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {activeTab === "note"
                ? "Internal note for the team timeline."
                : "Plain-text email with file attachments."}
            </p>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close composer"
            className="size-8"
            onClick={closeComposer}
          >
            <XIcon className="size-4" />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5">
          <div className="flex items-center gap-2 border-b border-slate-200 pb-4">
            <button
              type="button"
              onClick={() => {
                setActiveTab("email");
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium",
                activeTab === "email"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600",
              )}
            >
              <MailIcon className="size-4" />
              Email
            </button>

            {canUseNoteTab ? (
              <button
                type="button"
                onClick={() => {
                  setActiveTab("note");
                  clearComposerErrors();
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium",
                  activeTab === "note"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600",
                )}
              >
                <NoteIcon className="size-4" />
                Note
              </button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-400"
                  >
                    <NoteIcon className="size-4" />
                    Note
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  Notes are available when replying to a contact.
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          <div className="mt-5 space-y-5">
            {activeTab === "email" ? (
              <>
                <ComposerRecipientPicker
                  recipient={recipient}
                  locked={isReplying}
                  onRecipientChange={handleRecipientChange}
                />
                {recipientError ? (
                  <p className="-mt-3 text-xs text-rose-700">
                    {recipientError.message}
                  </p>
                ) : null}

                <SenderPicker
                  aliases={composerAliases}
                  selectedAlias={selectedAlias}
                  errorMessage={aliasError?.message}
                  onAliasChange={(nextAlias) => {
                    setSelectedAlias(nextAlias);
                    clearComposerErrors();
                  }}
                />

                <label className="flex items-start gap-3">
                  <span className="mt-2 w-10 text-sm font-medium text-slate-700">
                    Subject:
                  </span>
                  <div className="flex-1">
                    <Input
                      value={subject}
                      onChange={(event) => {
                        setSubject(event.currentTarget.value);
                        clearComposerErrors();
                      }}
                      placeholder="Subject"
                      className={cn(
                        subjectError
                          ? "border-rose-300 ring-1 ring-rose-200"
                          : "",
                      )}
                    />
                    {subjectError ? (
                      <p className="mt-1 text-xs text-rose-700">
                        {subjectError.message}
                      </p>
                    ) : null}
                  </div>
                </label>
              </>
            ) : null}

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">
                  {activeTab === "note" ? "Note" : "Message"}
                </span>
                {activeTab === "email" ? (
                  <div className="flex items-center gap-2">
                    {selectedAliasRecord?.isAiReady ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={aiButton.disabled}
                        onClick={() => {
                          runAiDraft();
                        }}
                      >
                        {isGeneratingAi ? (
                          <LoaderIcon className="size-4 animate-spin" />
                        ) : (
                          <SparkleIcon className="size-4" />
                        )}
                        {aiButton.label}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        attachmentInputRef.current?.click();
                      }}
                    >
                      <PaperclipIcon className="size-4" />
                      Attach file
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        imageInputRef.current?.click();
                      }}
                    >
                      <ImageIcon className="size-4" />
                      Embed image
                    </Button>
                  </div>
                ) : null}
              </div>

              <textarea
                ref={bodyRef}
                rows={6}
                value={body}
                onChange={(event) => {
                  setBody(event.currentTarget.value);
                  if (aiDraft.status === "inserted") {
                    markAiDraftEdited();
                  }
                  clearComposerErrors();
                }}
                onInput={(event) => {
                  autoResizeTextarea(event.currentTarget);
                }}
                placeholder={
                  activeTab === "note"
                    ? "Write a team-visible note"
                    : "Write your message"
                }
                className={cn(
                  "max-h-[30rem] min-h-36 w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-sm leading-6 text-slate-900 shadow-sm focus:outline-none focus:ring-1 focus:ring-slate-300",
                  bodyError ? "border-rose-300 ring-1 ring-rose-200" : "",
                )}
              />
              {aiWarningMessage ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {aiWarningMessage}
                </div>
              ) : null}
              {bodyError ? (
                <p className="text-xs text-rose-700">{bodyError.message}</p>
              ) : null}

              <AiDraftReprompt
                aiDraft={aiDraft}
                value={repromptText}
                onValueChange={setRepromptText}
                onReprompt={() => {
                  runAiDraft({
                    mode: "reprompt",
                    repromptDirection: repromptText.trim(),
                  });
                }}
                disabled={isGeneratingAi}
              />

              {activeTab === "email" && attachments.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {attachments.map((attachment) => (
                    <span
                      key={attachment.id}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700"
                    >
                      <span className="font-medium">{attachment.filename}</span>
                      <span className="text-slate-500">
                        {formatBytes(attachment.size)}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${attachment.filename}`}
                        onClick={() => {
                          clearComposerErrors();
                          setAttachments((previous) =>
                            previous.filter(
                              (item) => item.id !== attachment.id,
                            ),
                          );
                        }}
                        className="text-slate-400 hover:text-slate-700"
                      >
                        <XIcon className="size-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              {activeTab === "email" ? (
                <>
                  {attachmentError ? (
                    <p className="text-xs text-rose-700">
                      {attachmentError.message}
                    </p>
                  ) : null}
                </>
              ) : null}

              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFilesSelected}
              />
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFilesSelected}
              />
            </div>
          </div>
        </div>

        <footer className="border-t border-slate-200 px-6 py-4">
          {inlineError || recipientError || attachmentError ? (
            <div className="mb-3 flex items-start justify-between gap-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
              <div className="flex items-start gap-2">
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                <span>
                  {inlineError?.message ??
                    recipientError?.message ??
                    attachmentError?.message}
                </span>
              </div>
              {inlineError?.retryable ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-rose-200 bg-white text-rose-900 hover:bg-rose-100"
                  onClick={submit}
                >
                  Retry
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center justify-between">
            <Button type="button" variant="ghost" onClick={closeComposer}>
              Cancel
            </Button>

            <Button
              type="button"
              disabled={
                activeTab === "note" ? isSaveNoteDisabled : isSendDisabled
              }
              onClick={activeTab === "note" ? saveNote : submit}
            >
              {activeTab === "note" ? (
                isSavingNote ? (
                  <>
                    <LoaderIcon className="size-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <NoteIcon className="size-4" />
                    Save note
                  </>
                )
              ) : isSending ? (
                <>
                  <LoaderIcon className="size-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <SendIcon className="size-4" />
                  Send
                </>
              )}
            </Button>
          </div>
        </footer>
      </section>
    </TooltipProvider>
  );
}
