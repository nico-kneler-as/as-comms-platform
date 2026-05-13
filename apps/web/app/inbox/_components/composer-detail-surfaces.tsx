"use client";

import type { RefObject } from "react";

import { smsMetrics, type SmsMetrics } from "@as-comms/domain/sms-segments";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { TYPE } from "@/app/_lib/design-tokens-v2";

import { ComposerAiDraftWindow } from "./composer-ai-draft-window";
import {
  ComposerRecipientPicker,
  type ComposerRecipientValue,
} from "./composer-recipient-picker";
import { ComposerSendFromChip } from "./composer-send-from-chip";
import {
  AttachmentRow,
  ComposerField,
  InlineErrorBanner,
  RichTextComposerEditor,
} from "./composer-editor-surface";
import { ComposerToolbar } from "./composer-toolbar";
import {
  BookOpenIcon,
  ChevronDownIcon,
  ImageIcon,
  LinkIcon,
  LoaderIcon,
  MailIcon,
  NoteIcon,
  PaperclipIcon,
  PinIcon,
  SendIcon,
  XIcon,
} from "./icons";
import type { AttachmentDraft, InlineComposerError } from "./composer-shared";
import type { ComposerSendKind } from "../_lib/composer-ui";
import type {
  InboxComposerAliasOption,
  InboxSmsSenderOption,
} from "../_lib/view-models";
import type { ComposerSmsRecipient } from "../_hooks/composer-draft-reducer";
import type {
  AiDraftState,
  ComposerValidationError,
} from "./inbox-client-provider";
import { ComposerSmsRecipientPicker } from "./composer-sms-recipient-picker";
import { SendFromPhoneChip } from "./composer-send-from-phone-chip";

function KnowledgeBaseIndicator({
  hasKnowledge,
  projectName,
}: {
  readonly hasKnowledge: boolean;
  readonly projectName: string | null;
}) {
  const isLinked = hasKnowledge && projectName !== null;
  const label = isLinked ? `${projectName} Knowledge Base` : "Without Knowledge Base";

  return (
    <span
      className={cn(
        `inline-flex min-w-0 items-center justify-center gap-1.5 truncate ${TYPE.caption}`,
        isLinked ? "text-emerald-600" : "text-slate-400",
      )}
    >
      <BookOpenIcon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function SendAndSaveMenuItem({
  disabled,
  tooltipMessage,
  onSelect,
}: {
  readonly disabled: boolean;
  readonly tooltipMessage: string | null;
  readonly onSelect: () => void;
}) {
  const item = (
    <DropdownMenuItem
      aria-disabled={disabled ? true : undefined}
      className={cn("rounded-md", disabled ? "opacity-50" : "")}
      onSelect={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }

        onSelect();
      }}
    >
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-slate-900">
          Send and save for AI
        </span>
        <span className={TYPE.caption}>
          Save this sent reply for later approval in project knowledge
        </span>
      </div>
    </DropdownMenuItem>
  );

  if (tooltipMessage === null) {
    return item;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>{item}</div>
      </TooltipTrigger>
      <TooltipContent side="left">{tooltipMessage}</TooltipContent>
    </Tooltip>
  );
}

const SMS_COMPOSER_LENGTH_LIMIT = 320;

function clampSmsComposerBody(value: string): string {
  if (smsMetrics(value).length <= SMS_COMPOSER_LENGTH_LIMIT) {
    return value;
  }

  let nextValue = "";

  for (const char of Array.from(value)) {
    const candidate = `${nextValue}${char}`;
    if (smsMetrics(candidate).length > SMS_COMPOSER_LENGTH_LIMIT) {
      break;
    }

    nextValue = candidate;
  }

  return nextValue;
}

function formatUsPhoneLabel(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, "");
  const nationalNumber =
    digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits.length === 10
        ? digits
        : null;

  return nationalNumber === null
    ? phoneE164
    : `(${nationalNumber.slice(0, 3)}) ${nationalNumber.slice(3, 6)}-${nationalNumber.slice(6)}`;
}

export function ComposerPaneChrome({
  title,
  description,
  activeTab,
  canUseNoteTab,
  onEmail,
  onNote,
  onClose,
}: {
  readonly title: string;
  readonly description: string;
  readonly activeTab: "email" | "note";
  readonly canUseNoteTab: boolean;
  readonly onEmail: () => void;
  readonly onNote: () => void;
  readonly onClose: () => void;
}) {
  return (
    <>
      <header className="border-b border-slate-200 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-slate-900">{title}</p>
            <p className={`mt-1 ${TYPE.caption}`}>{description}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close composer"
            className="size-8"
            onClick={onClose}
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </header>

      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onEmail}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium",
              activeTab === "email"
                ? "bg-[#253746] text-white"
                : "bg-slate-100 text-slate-600",
            )}
          >
            <MailIcon className="size-4" />
            Email
          </button>
          {canUseNoteTab ? (
            <button
              type="button"
              onClick={onNote}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium",
                activeTab === "note"
                  ? "bg-amber-600 text-white"
                  : "bg-amber-50 text-amber-700",
              )}
            >
              <NoteIcon className="size-4" />
              Note
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function ComposerEmailSurface({
  composerAliases,
  selectedAlias,
  aliasError,
  recipient,
  ccRecipients,
  bccRecipients,
  showCc,
  showBcc,
  isReplying,
  recipientAutoFocus = false,
  showAiDraftAffordances = true,
  recipientPlaceholder = "Search contacts",
  recipientError,
  ccError,
  bccError,
  subject,
  subjectError,
  body,
  bodyError,
  attachments,
  attachmentError,
  aiDraft,
  aiDirective,
  repromptText,
  isGeneratingAi,
  runAiDraftDisabled,
  runAiDraftDisabledReason,
  selectedAliasHasCachedContent,
  selectedAliasProjectName,
  selectedAliasSignature,
  aiWarningMessage,
  inlineError,
  canSendAndSaveForAi,
  sendAndSaveDisabledReason,
  isSendDisabled,
  isSending,
  onAliasChange,
  onRecipientChange,
  onCcChange,
  onBccChange,
  onToggleCc,
  onToggleBcc,
  onSubjectChange,
  onBodyChange,
  onClearErrors,
  onAiDirectiveChange,
  onAiEdited,
  onDiscardAi,
  onOpenReprompt,
  onCancelReprompt,
  onApproveAi,
  onRunAiDraft,
  onRepromptTextChange,
  onReprompt,
  onAttachmentClick,
  onAttachmentRemove,
  onSaveDraft,
  onSend,
  onCancel,
}: {
  readonly composerAliases: readonly InboxComposerAliasOption[];
  readonly selectedAlias: string | null;
  readonly aliasError?: ComposerValidationError;
  readonly recipient: ComposerRecipientValue | null;
  readonly ccRecipients: readonly ComposerRecipientValue[];
  readonly bccRecipients: readonly ComposerRecipientValue[];
  readonly showCc: boolean;
  readonly showBcc: boolean;
  readonly isReplying: boolean;
  readonly recipientAutoFocus?: boolean;
  readonly showAiDraftAffordances?: boolean;
  readonly recipientPlaceholder?: string;
  readonly recipientError?: ComposerValidationError;
  readonly ccError?: ComposerValidationError;
  readonly bccError?: ComposerValidationError;
  readonly subject: string;
  readonly subjectError?: ComposerValidationError;
  readonly body: string;
  readonly bodyError?: ComposerValidationError;
  readonly attachments: readonly AttachmentDraft[];
  readonly attachmentError?: ComposerValidationError;
  readonly aiDraft: AiDraftState;
  readonly aiDirective: string;
  readonly repromptText: string;
  readonly isGeneratingAi: boolean;
  readonly runAiDraftDisabled: boolean;
  readonly runAiDraftDisabledReason: string | null;
  readonly selectedAliasHasCachedContent: boolean;
  readonly selectedAliasProjectName: string | null;
  readonly selectedAliasSignature: string;
  readonly aiWarningMessage: string | null;
  readonly inlineError: InlineComposerError | null;
  readonly canSendAndSaveForAi: boolean;
  readonly sendAndSaveDisabledReason: string | null;
  readonly isSendDisabled: boolean;
  readonly isSending: boolean;
  readonly onAliasChange: (value: string | null) => void;
  readonly onRecipientChange: (
    recipient: ComposerRecipientValue | null,
  ) => void;
  readonly onCcChange: (
    recipients: readonly ComposerRecipientValue[],
  ) => void;
  readonly onBccChange: (
    recipients: readonly ComposerRecipientValue[],
  ) => void;
  readonly onToggleCc: (open: boolean) => void;
  readonly onToggleBcc: (open: boolean) => void;
  readonly onSubjectChange: (value: string) => void;
  readonly onBodyChange: (value: {
    readonly bodyPlaintext: string;
    readonly bodyHtml: string;
  }) => void;
  readonly onClearErrors: () => void;
  readonly onAiDirectiveChange: (value: string) => void;
  readonly onAiEdited: () => void;
  readonly onDiscardAi: () => void;
  readonly onOpenReprompt: () => void;
  readonly onCancelReprompt: () => void;
  readonly onApproveAi: () => void;
  readonly onRunAiDraft: () => void;
  readonly onRepromptTextChange: (value: string) => void;
  readonly onReprompt: () => void;
  readonly onAttachmentClick: () => void;
  readonly onAttachmentRemove: (id: string) => void;
  readonly onSaveDraft: () => void;
  readonly onSend: (sendKind: ComposerSendKind) => void;
  readonly onCancel: () => void;
}) {
  const sendAndSaveDisabled = isSendDisabled || !canSendAndSaveForAi;
  const sendAndSaveTooltipMessage =
    canSendAndSaveForAi || sendAndSaveDisabledReason === null
      ? null
      : sendAndSaveDisabledReason;
  const knowledgeIndicator = showAiDraftAffordances ? (
    <KnowledgeBaseIndicator
      hasKnowledge={selectedAliasHasCachedContent}
      projectName={selectedAliasProjectName}
    />
  ) : null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-full flex-col">
        <ComposerField label="FROM">
          <ComposerSendFromChip
            value={selectedAlias}
            aliases={composerAliases}
            onChange={onAliasChange}
            {...(aliasError?.message ? { errorMessage: aliasError.message } : {})}
          />
        </ComposerField>

      <ComposerField label="TO">
        <div className="rounded-md bg-white">
          <ComposerRecipientPicker
            recipients={recipient === null ? [] : [recipient]}
            locked={isReplying}
            single
            autoFocusInput={recipientAutoFocus}
            placeholder={recipientPlaceholder}
            rightSlot={
              !showCc || !showBcc ? (
                <div className="flex items-center gap-1 pt-0.5 text-[11.5px]">
                  {!showCc ? (
                    <button
                      type="button"
                      onClick={() => {
                        onToggleCc(true);
                      }}
                      className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    >
                      Cc
                    </button>
                  ) : null}
                  {!showBcc ? (
                    <button
                      type="button"
                      onClick={() => {
                        onToggleBcc(true);
                      }}
                      className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    >
                      Bcc
                    </button>
                  ) : null}
                </div>
              ) : null
            }
            onRecipientsChange={(nextRecipients) => {
              onRecipientChange(nextRecipients[0] ?? null);
            }}
          />
        </div>
        {recipientError ? (
          <p className="mt-1 text-xs text-rose-700">{recipientError.message}</p>
        ) : null}
      </ComposerField>

      {showCc ? (
        <ComposerField label="CC">
          <ComposerRecipientPicker
            recipients={ccRecipients}
            rightSlot={
              <button
                type="button"
                aria-label="Hide Cc field"
                onClick={() => {
                  onToggleCc(false);
                }}
                className="text-slate-400 hover:text-slate-700"
              >
                <XIcon className="size-3.5" />
              </button>
            }
            onRecipientsChange={onCcChange}
          />
          {ccError ? (
            <p className="mt-1 text-xs text-rose-700">{ccError.message}</p>
          ) : null}
        </ComposerField>
      ) : null}

      {showBcc ? (
        <ComposerField label="BCC">
          <ComposerRecipientPicker
            recipients={bccRecipients}
            rightSlot={
              <button
                type="button"
                aria-label="Hide Bcc field"
                onClick={() => {
                  onToggleBcc(false);
                }}
                className="text-slate-400 hover:text-slate-700"
              >
                <XIcon className="size-3.5" />
              </button>
            }
            onRecipientsChange={onBccChange}
          />
          {bccError ? (
            <p className="mt-1 text-xs text-rose-700">{bccError.message}</p>
          ) : null}
        </ComposerField>
      ) : null}

      <ComposerField label="SUBJ">
        <Input
          value={subject}
          onChange={(event) => {
            onSubjectChange(event.currentTarget.value);
          }}
          placeholder="Subject"
          className={cn(
            "h-8 border-0 px-0 text-[13px] font-medium shadow-none focus-visible:ring-0",
            subjectError ? "text-rose-900" : "",
          )}
        />
        {subjectError ? (
          <p className="mt-1 text-xs text-rose-700">{subjectError.message}</p>
        ) : null}
      </ComposerField>

      <RichTextComposerEditor
        className="flex min-h-0 flex-1 flex-col"
        frameClassName="flex min-h-0 flex-1 flex-col border-x-0 border-b-0 shadow-none"
        contentClassName="min-h-0 flex-1"
        bodyPlaintext={body}
        errorMessage={bodyError?.message}
        onChange={(nextBody) => {
          onBodyChange(nextBody);
          if (aiDraft.status === "inserted") {
            onAiEdited();
          }
        }}
        onClearErrors={onClearErrors}
        topSlot={
          showAiDraftAffordances ? (
            <ComposerAiDraftWindow
              tone="email"
              aiDraft={aiDraft}
              directiveText={aiDirective}
              repromptText={repromptText}
              isGeneratingAi={isGeneratingAi}
              runDraftDisabled={runAiDraftDisabled}
              runDraftDisabledReason={runAiDraftDisabledReason}
              onDirectiveTextChange={onAiDirectiveChange}
              onRepromptTextChange={onRepromptTextChange}
              onRunDraft={onRunAiDraft}
              onOpenReprompt={onOpenReprompt}
              onSubmitReprompt={onReprompt}
              onCancelReprompt={onCancelReprompt}
              onDiscard={onDiscardAi}
              onApprove={onApproveAi}
            />
          ) : undefined
        }
        bottomSlot={
          selectedAliasSignature.length > 0 ? (
            <div className="px-4 pb-3 pt-2 whitespace-pre-line text-[13px] leading-relaxed text-slate-500">
              {selectedAliasSignature}
            </div>
          ) : undefined
        }
        toolbarFooter={({ activeCommands, onCommand }) => (
          <div className="border-t border-slate-100 bg-slate-50/40 px-3 py-2">
            <AttachmentRow
              attachments={attachments}
              onRemove={onAttachmentRemove}
            />
            {attachmentError ? (
              <div className="px-1 pb-3 text-xs text-rose-700">
                {attachmentError.message}
              </div>
            ) : null}

            {inlineError || recipientError || ccError || bccError || attachmentError ? (
              <InlineErrorBanner
                message={
                  inlineError?.message ??
                  recipientError?.message ??
                  ccError?.message ??
                  bccError?.message ??
                  attachmentError?.message ??
                  "Something went wrong."
                }
                retryable={inlineError?.retryable === true}
                onRetry={() => {
                  onSend("send");
                }}
              />
            ) : null}

            <div className="flex min-w-0 items-center gap-2">
              <div className="shrink-0">
                <ComposerToolbar
                  activeCommands={activeCommands}
                  onCommand={onCommand}
                />
              </div>

              <Button
                type="button"
                variant="ghost"
                className="shrink-0 gap-1.5 border-l border-slate-200 pl-3 text-[11.5px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                onClick={onAttachmentClick}
              >
                <PaperclipIcon className="size-3.5" />
                Attach
              </Button>

              {knowledgeIndicator ? (
                <div className="hidden min-w-0 max-w-[18rem] items-center border-l border-slate-200 pl-3 md:flex">
                  {knowledgeIndicator}
                </div>
              ) : null}

              <div className="min-w-0 flex-1" />

              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="text-[12px] text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  onClick={onCancel}
                >
                  Cancel
                </Button>
                <div className="inline-flex items-stretch overflow-hidden rounded-md shadow-sm">
                  <Button
                    type="button"
                    disabled={isSendDisabled}
                    className="h-9 rounded-none rounded-l-md bg-[#253746] px-3 text-[12.5px] font-medium text-white shadow-none hover:bg-[#324558]"
                    onClick={() => {
                      onSend("send");
                    }}
                  >
                    {isSending ? (
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
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        aria-label="Send options"
                        disabled={isSending}
                        className="h-9 rounded-none rounded-r-md border-l border-slate-700 bg-[#253746] px-2 text-white shadow-none hover:bg-[#324558]"
                      >
                        <ChevronDownIcon className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="w-72 rounded-xl p-1.5"
                    >
                      <SendAndSaveMenuItem
                        disabled={sendAndSaveDisabled}
                        tooltipMessage={sendAndSaveTooltipMessage}
                        onSelect={() => {
                          onSend("send-and-save");
                        }}
                      />
                      <DropdownMenuItem
                        className="rounded-md"
                        onSelect={() => {
                          onSaveDraft();
                        }}
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="text-sm font-medium text-slate-900">
                            Save draft
                          </span>
                          <span className={TYPE.caption}>
                            Collapse this draft to the floating pill without sending
                          </span>
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>

            {knowledgeIndicator ? (
              <div className="mt-2 md:hidden">{knowledgeIndicator}</div>
            ) : null}
          </div>
        )}
      />

      {aiWarningMessage ? (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {aiWarningMessage}
        </div>
      ) : null}
        {bodyError ? (
          <div className="px-4 py-2 text-xs text-rose-700">
            {bodyError.message}
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

function resolveSmsRecipientLabel(recipient: ComposerSmsRecipient | null): string {
  if (recipient === null) {
    return "No recipient selected";
  }

  return recipient.kind === "contact"
    ? `${recipient.displayName} (${formatUsPhoneLabel(recipient.phoneE164)})`
    : formatUsPhoneLabel(recipient.phoneE164);
}

export function ComposerSmsSurface({
  smsSenders,
  smsEnabled,
  selectedSenderId,
  recipient,
  lockedRecipient,
  body,
  segmentMetrics,
  aiDraft,
  aiDirective,
  repromptText,
  isGeneratingAi,
  runAiDraftDisabled,
  runAiDraftDisabledReason,
  selectedAliasHasCachedContent,
  selectedAliasProjectName,
  canSendAndSaveForAi,
  sendAndSaveDisabledReason,
  sendDisabledReason,
  inlineError,
  recipientError,
  senderError,
  bodyError,
  isSending,
  onRecipientChange,
  onBodyChange,
  onAiDirectiveChange,
  onAiEdited,
  onDiscardAi,
  onOpenReprompt,
  onCancelReprompt,
  onApproveAi,
  onRunAiDraft,
  onRepromptTextChange,
  onReprompt,
  onSend,
  onCancel,
}: {
  readonly smsSenders: readonly InboxSmsSenderOption[];
  readonly smsEnabled: boolean;
  readonly selectedSenderId: string | null;
  readonly recipient: ComposerSmsRecipient | null;
  readonly lockedRecipient: boolean;
  readonly body: string;
  readonly segmentMetrics: SmsMetrics;
  readonly aiDraft: AiDraftState;
  readonly aiDirective: string;
  readonly repromptText: string;
  readonly isGeneratingAi: boolean;
  readonly runAiDraftDisabled: boolean;
  readonly runAiDraftDisabledReason: string | null;
  readonly selectedAliasHasCachedContent: boolean;
  readonly selectedAliasProjectName: string | null;
  readonly canSendAndSaveForAi: boolean;
  readonly sendAndSaveDisabledReason: string | null;
  readonly sendDisabledReason: string | null;
  readonly inlineError: InlineComposerError | null;
  readonly recipientError?: ComposerValidationError;
  readonly senderError?: ComposerValidationError;
  readonly bodyError?: ComposerValidationError;
  readonly isSending: boolean;
  readonly onRecipientChange: (recipient: ComposerSmsRecipient | null) => void;
  readonly onBodyChange: (value: string) => void;
  readonly onAiDirectiveChange: (value: string) => void;
  readonly onAiEdited: () => void;
  readonly onDiscardAi: () => void;
  readonly onOpenReprompt: () => void;
  readonly onCancelReprompt: () => void;
  readonly onApproveAi: () => void;
  readonly onRunAiDraft: () => void;
  readonly onRepromptTextChange: (value: string) => void;
  readonly onReprompt: () => void;
  readonly onSend: (sendKind?: ComposerSendKind) => void;
  readonly onCancel: () => void;
}) {
  const selectedSender =
    smsSenders.find((sender) => sender.id === selectedSenderId) ??
    smsSenders[0] ??
    null;
  const sendAndSaveDisabled = !canSendAndSaveForAi || isSending;
  const sendAndSaveTooltipMessage =
    sendAndSaveDisabledReason ??
    (!canSendAndSaveForAi ? "Project knowledge capture is unavailable." : null);
  const sendSmsDisabledReason = !smsEnabled
    ? "SMS sending isn't wired up yet — coming soon"
    : sendDisabledReason;
  const smsLengthLimit =
    segmentMetrics.length <= 160 ? 160 : SMS_COMPOSER_LENGTH_LIMIT;
  const smsLengthIsExtended = segmentMetrics.length > 160;
  const smsLengthLabel = `${String(segmentMetrics.length)}/${String(smsLengthLimit)}`;
  const knowledgeIndicator = (
    <KnowledgeBaseIndicator
      hasKnowledge={selectedAliasHasCachedContent}
      projectName={selectedAliasProjectName}
    />
  );
  const sendButton = (
    <div className="inline-flex items-stretch overflow-hidden rounded-md shadow-sm">
      <Button
        type="button"
        disabled={sendSmsDisabledReason !== null || isSending}
        className="h-9 rounded-none rounded-l-md bg-[#253746] px-3 text-[12.5px] font-medium text-white shadow-none hover:bg-[#324558]"
        onClick={() => {
          onSend("send");
        }}
      >
        {isSending ? (
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            aria-label="SMS send options"
            disabled={!smsEnabled || isSending}
            className="h-9 rounded-none rounded-r-md border-l border-slate-700 bg-[#253746] px-2 text-white shadow-none hover:bg-[#324558]"
          >
            <ChevronDownIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 rounded-xl p-1.5">
          <DropdownMenuItem
            className="rounded-md"
            onSelect={() => {
              onSend("send");
            }}
          >
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-medium text-slate-900">Send SMS</span>
              <span className={TYPE.caption}>
                {resolveSmsRecipientLabel(recipient)}
              </span>
            </div>
          </DropdownMenuItem>
          <SendAndSaveMenuItem
            disabled={sendAndSaveDisabled}
            tooltipMessage={sendAndSaveTooltipMessage}
            onSelect={() => {
              onSend("send-and-save");
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-full flex-col">
      <ComposerField label="FROM">
        <SendFromPhoneChip
          sender={selectedSender}
          {...(senderError?.message ? { errorMessage: senderError.message } : {})}
        />
      </ComposerField>

      <ComposerField label="TO">
        <ComposerSmsRecipientPicker
          recipient={recipient}
          locked={lockedRecipient}
          onRecipientChange={onRecipientChange}
          {...(recipientError?.message
            ? { errorMessage: recipientError.message }
            : {})}
        />
      </ComposerField>

      <ComposerField label="SUBJ">
        <div
          aria-hidden="true"
          className="flex h-8 items-center text-[13px] font-medium text-slate-300"
        >
          Subject
        </div>
      </ComposerField>

      <div className="flex min-h-0 flex-1 flex-col border-t border-slate-100">
        <ComposerAiDraftWindow
          tone="sms"
          aiDraft={aiDraft}
          directiveText={aiDirective}
          repromptText={repromptText}
          isGeneratingAi={isGeneratingAi}
          runDraftDisabled={runAiDraftDisabled}
          runDraftDisabledReason={runAiDraftDisabledReason}
          onDirectiveTextChange={onAiDirectiveChange}
          onRepromptTextChange={onRepromptTextChange}
          onRunDraft={onRunAiDraft}
          onOpenReprompt={onOpenReprompt}
          onSubmitReprompt={onReprompt}
          onCancelReprompt={onCancelReprompt}
          onDiscard={onDiscardAi}
          onApprove={onApproveAi}
        />
        <div className="relative min-h-0 flex-1 px-4 pb-3 pt-2">
          <textarea
            rows={7}
            value={body}
            onChange={(event) => {
              onBodyChange(clampSmsComposerBody(event.currentTarget.value));
              if (aiDraft.status === "inserted") {
                onAiEdited();
              }
            }}
            placeholder="Write an SMS reply"
            className={cn(
              "h-full min-h-0 w-full resize-none border-0 bg-white px-0 py-3 pb-8 text-sm leading-6 text-slate-900 shadow-none focus:outline-none focus:ring-0",
              bodyError ? "text-rose-900" : "",
            )}
            aria-describedby="sms-composer-character-count"
          />
          <div
            id="sms-composer-character-count"
            className={cn(
              "pointer-events-none absolute bottom-5 right-5 text-[11.5px] font-medium tabular-nums",
              smsLengthIsExtended ? "text-rose-600" : "text-slate-400",
            )}
            aria-live="polite"
          >
            {smsLengthLabel}
          </div>
          {bodyError ? (
            <p className="mt-2 text-xs text-rose-700">{bodyError.message}</p>
          ) : null}
        </div>
      </div>

      <div className="border-t border-slate-200 px-4 py-[12.5px]">
        {inlineError ? (
          <InlineErrorBanner
            message={inlineError.message}
            retryable={inlineError.retryable}
            onRetry={onSend}
          />
        ) : null}

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-8 gap-1.5 border-sky-200 bg-white px-2.5 text-[12px] font-medium text-sky-700 hover:bg-sky-50 hover:text-sky-800"
            >
              <ImageIcon className="size-3.5" />
              Add MMS
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 gap-1.5 border-slate-200 bg-white px-2.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800"
            >
              <LinkIcon className="size-3.5" />
              Shorten links
            </Button>
          </div>

          {recipientError?.message ? (
            <span className="text-[11.5px] text-rose-700">
              {recipientError.message}
            </span>
          ) : null}

          <div className="hidden min-w-0 max-w-[18rem] items-center border-l border-slate-200 pl-3 md:flex">
            {knowledgeIndicator}
          </div>

          <div className="mt-1 w-full md:hidden">{knowledgeIndicator}</div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="text-[12px] text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              onClick={onCancel}
            >
              Cancel
            </Button>
            {sendSmsDisabledReason === null ? (
              sendButton
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>{sendButton}</div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {sendSmsDisabledReason}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
      </div>
    </TooltipProvider>
  );
}

export function ComposerNoteSurface({
  contactDisplayName,
  body,
  bodyError,
  isSavingNote,
  isSaveNoteDisabled,
  inlineError,
  textareaRef,
  onBodyChange,
  onTextareaInput,
  onSaveNote,
  onCancel,
  onMinimize,
  onClose,
}: {
  readonly contactDisplayName: string;
  readonly body: string;
  readonly bodyError?: ComposerValidationError;
  readonly isSavingNote: boolean;
  readonly isSaveNoteDisabled: boolean;
  readonly inlineError: InlineComposerError | null;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly onBodyChange: (value: string) => void;
  readonly onTextareaInput: (target: HTMLTextAreaElement) => void;
  readonly onSaveNote: () => void;
  readonly onCancel: () => void;
  readonly onMinimize: () => void;
  readonly onClose: () => void;
}) {
  const noteRecipient =
    contactDisplayName.trim().length > 0 ? contactDisplayName : "this contact";

  return (
    <section
      role="region"
      aria-label="Internal note composer"
      className="absolute inset-x-0 bottom-0 z-40 border-t border-amber-200 bg-amber-50 shadow-[0_-12px_30px_rgba(15,23,42,0.08)]"
    >
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2">
        <p className="flex min-w-0 items-center gap-2 text-[13px] text-amber-700">
          <NoteIcon className="size-3.5 shrink-0" />
          <span className="shrink-0 font-semibold text-amber-800">
            Internal note
          </span>
          <span className="truncate">
            — visible to teammates only. Not sent to {noteRecipient}.
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Minimize note composer"
            className="inline-flex size-8 items-center justify-center rounded-md text-amber-600 hover:bg-amber-100 hover:text-amber-800"
            onClick={onMinimize}
          >
            <ChevronDownIcon className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Close note composer"
            className="inline-flex size-8 items-center justify-center rounded-md text-amber-600 hover:bg-amber-100 hover:text-amber-800"
            onClick={onClose}
          >
            <XIcon className="size-4" />
          </button>
        </div>
      </div>

      <div className="bg-white px-5 py-4">
        {inlineError ? (
          <InlineErrorBanner
            message={inlineError.message}
            retryable={inlineError.retryable}
            onRetry={onSaveNote}
          />
        ) : null}
        <textarea
          ref={textareaRef}
          autoFocus
          rows={6}
          value={body}
          onChange={(event) => {
            onBodyChange(event.currentTarget.value);
          }}
          onInput={(event) => {
            onTextareaInput(event.currentTarget);
          }}
          placeholder={`Add a note about ${noteRecipient} for your team...`}
          className={cn(
            "h-40 w-full resize-none border-0 bg-transparent px-0 py-1 text-sm leading-6 text-slate-900 shadow-none placeholder:text-amber-700/45 focus:outline-none focus:ring-0",
            bodyError ? "text-rose-900" : "",
          )}
        />
        {bodyError ? (
          <p className="mt-2 text-xs text-rose-700">{bodyError.message}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-amber-200 bg-amber-50 px-5 py-3">
        <Button
          type="button"
          variant="ghost"
          className="text-[13px] text-slate-500 hover:bg-amber-100/70 hover:text-amber-800"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={isSaveNoteDisabled}
          onClick={onSaveNote}
          className="h-9 bg-amber-700 px-4 text-[13px] text-white hover:bg-amber-800 disabled:bg-amber-300"
        >
          {isSavingNote ? (
            <>
              <LoaderIcon className="size-4 animate-spin" />
              Pinning...
            </>
          ) : (
            <>
              <PinIcon className="size-4" />
              Pin Note
            </>
          )}
        </Button>
      </div>
    </section>
  );
}
