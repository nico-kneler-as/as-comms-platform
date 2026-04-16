"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import {
  useClaudeInboxClient,
  type AiDraftStatus,
  type ComposerStatus
} from "./claude-inbox-client-provider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";

import {
  AlertCircleIcon,
  BoldIcon,
  BotIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  FileDocIcon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  LoaderIcon,
  MailIcon,
  NoteIcon,
  PaperclipIcon,
  PhoneIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SendIcon,
  SparkleIcon,
  TrashIcon,
  UploadIcon,
  WifiOffIcon,
  XCircleIcon,
  XIcon
} from "./claude-icons";

type ComposerMode = "email" | "sms" | "note";

interface ComposerProps {
  readonly contactDisplayName: string;
  readonly smsEligible: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

const EMAIL_ALIASES = [
  { id: "jordan", label: "Jordan Cole", email: "jordan@adventurescientists.org" },
  { id: "team", label: "AS Team", email: "team@adventurescientists.org" },
  { id: "noreply", label: "No Reply", email: "noreply@adventurescientists.org" }
] as const;

export function ClaudeInboxComposer({
  contactDisplayName,
  smsEligible,
  onOpenChange
}: ComposerProps) {
  const [isOpen, setIsOpenRaw] = useState(false);

  const setIsOpen = (open: boolean) => {
    setIsOpenRaw(open);
    onOpenChange?.(open);
  };
  const [mode, setMode] = useState<ComposerMode>("email");
  const [draft, setDraft] = useState("");
  const [subject, setSubject] = useState("");
  const [fromAlias, setFromAlias] = useState<string>(EMAIL_ALIASES[0]!.id);
  const [aiPrompt, setAiPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    composerStatus,
    composerErrors,
    setComposerStatus,
    setComposerErrors,
    aiDraft,
    startAiGeneration,
    insertAiDraft,
    markAiDraftEdited,
    discardAiDraft,
    repromptAi,
    resetAiDraft
  } = useClaudeInboxClient();

  const placeholder = placeholderForMode(mode, contactDisplayName);
  const firstName =
    contactDisplayName.split(" ")[0] ?? contactDisplayName;

  // When AI finishes generating, place the text into the textarea
  const prevStatus = useRef(aiDraft.status);
  useEffect(() => {
    if (
      prevStatus.current !== "inserted" &&
      aiDraft.status === "inserted" &&
      aiDraft.generatedText
    ) {
      setDraft(aiDraft.generatedText);
    }
    if (
      aiDraft.status === "generating" ||
      aiDraft.status === "reprompting"
    ) {
      setIsOpen(true);
    }
    prevStatus.current = aiDraft.status;
  }, [aiDraft.status, aiDraft.generatedText]);

  // Auto-collapse after successful send
  useEffect(() => {
    if (composerStatus !== "sent-success") return undefined;
    const timer = setTimeout(() => {
      setIsOpen(false);
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [composerStatus]);

  const handleSend = () => {
    if (mode === "email" && !subject.trim()) {
      setComposerErrors([
        { field: "subject", message: "Subject is required" }
      ]);
      setComposerStatus("validation-error");
      return;
    }
    if (!draft.trim()) {
      setComposerErrors([
        { field: "body", message: "Message body cannot be empty" }
      ]);
      setComposerStatus("validation-error");
      return;
    }
    setComposerErrors([]);
    setComposerStatus("sending");
    setTimeout(() => {
      if (Math.random() > 0.2) {
        setComposerStatus("sent-success");
        setDraft("");
        setSubject("");
        resetAiDraft();
        setTimeout(() => {
          setComposerStatus("idle");
        }, 2500);
      } else {
        setComposerStatus("send-failure");
      }
    }, 1200);
  };

  const handleDraftWithAi = () => {
    if (
      aiDraft.status === "idle" ||
      aiDraft.status === "discarded" ||
      aiDraft.status === "error"
    ) {
      startAiGeneration("Draft a helpful reply");
      setTimeout(() => {
        insertAiDraft(
          `Hi ${firstName},\n\nThanks for reaching out. I've looked into this and wanted to follow up with some next steps.\n\nLet me know if you have any questions.\n\nBest,\nJordan`
        );
      }, 2000);
    }
  };

  const handleReprompt = () => {
    repromptAi(aiPrompt || "Make it more concise");
    setAiPrompt("");
    setTimeout(() => {
      insertAiDraft(
        `Hi ${firstName},\n\nFollowing up on your message — here are the next steps. Let me know if questions come up.\n\nBest,\nJordan`
      );
    }, 1500);
  };

  const handleDiscard = () => {
    setDraft("");
    discardAiDraft();
  };

  const isShowingAiDraft =
    aiDraft.status === "inserted" && draft === aiDraft.generatedText;
  const isAiEdited = aiDraft.status === "edited-after-generation";
  const isAiGenerating =
    aiDraft.status === "generating" || aiDraft.status === "reprompting";
  const hasAiDraftActive = isShowingAiDraft || isAiEdited;

  // ───── Collapsed reply bar ─────
  if (!isOpen) {
    return (
      <div className="border-t border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => {
            setIsOpen(true);
          }}
          className="flex w-full items-center gap-2.5 px-5 py-3 text-left text-sm text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
        >
          <MailIcon className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">
            Reply to {contactDisplayName}…
          </span>
        </button>
      </div>
    );
  }

  // ───── Expanded composer ─────
  return (
    <div className="border-t border-slate-200 bg-white">
      {/* Toolbar: mode tabs | AI button + minimize */}
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-2">
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value) setMode(value as ComposerMode);
          }}
          size="sm"
          className="gap-1 rounded-lg bg-slate-100 p-0.5"
        >
          <ToggleGroupItem
            value="email"
            className="gap-1.5 rounded-md px-2.5 text-xs data-[state=on]:bg-white data-[state=on]:text-slate-900 data-[state=on]:shadow-sm [&_svg]:size-3.5"
          >
            <MailIcon className="h-3.5 w-3.5" />
            Email
          </ToggleGroupItem>
          <ToggleGroupItem
            value="sms"
            disabled={!smsEligible}
            title={smsEligible ? undefined : "No verified phone"}
            className="gap-1.5 rounded-md px-2.5 text-xs data-[state=on]:bg-white data-[state=on]:text-slate-900 data-[state=on]:shadow-sm [&_svg]:size-3.5"
          >
            <PhoneIcon className="h-3.5 w-3.5" />
            SMS
          </ToggleGroupItem>
          <ToggleGroupItem
            value="note"
            className="gap-1.5 rounded-md px-2.5 text-xs data-[state=on]:bg-white data-[state=on]:text-slate-900 data-[state=on]:shadow-sm [&_svg]:size-3.5"
          >
            <NoteIcon className="h-3.5 w-3.5" />
            Note
          </ToggleGroupItem>
        </ToggleGroup>

        <div className="flex items-center gap-1.5">
          {/* Draft with AI — ALWAYS visible, state changes label */}
          <AiButton
            status={aiDraft.status}
            onDraftWithAi={handleDraftWithAi}
          />
          <button
            type="button"
            aria-label="Minimize composer"
            onClick={() => {
              setIsOpen(false);
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <ChevronDownIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Inline AI status banners */}
      {aiDraft.status === "error" ? (
        <div className="flex items-center gap-2 border-b border-red-100 bg-red-50/60 px-5 py-2">
          <AlertCircleIcon className="h-3.5 w-3.5 shrink-0 text-red-500" />
          <p className="flex-1 text-xs text-red-700">
            {aiDraft.errorMessage ?? "Something went wrong."}
          </p>
          <button
            type="button"
            onClick={resetAiDraft}
            className="text-xs font-medium text-red-700 hover:text-red-900"
          >
            Try again
          </button>
        </div>
      ) : null}

      {aiDraft.status === "unavailable" ? (
        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-2">
          <WifiOffIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <p className="text-xs text-slate-500">
            AI drafting is temporarily unavailable.
          </p>
        </div>
      ) : null}

      {/* Compose area */}
      <div className={mode === "note" ? "bg-amber-50/50" : ""}>
        {mode === "email" ? (
          <>
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-2 text-xs">
              <span className="w-12 shrink-0 font-medium text-slate-700">
                From:
              </span>
              <select
                value={fromAlias}
                onChange={(e) => {
                  const target = e.currentTarget as unknown as {
                    readonly value: string;
                  };
                  setFromAlias(target.value);
                }}
                className="flex-1 bg-transparent text-xs text-slate-900 focus:outline-none"
              >
                {EMAIL_ALIASES.map((alias) => (
                  <option key={alias.id} value={alias.id}>
                    {alias.label} &lt;{alias.email}&gt;
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-2 text-xs">
              <span className="w-12 shrink-0 font-medium text-slate-700">
                To:
              </span>
              <span className="text-slate-600">{contactDisplayName}</span>
            </div>
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-2 text-xs">
              <label
                htmlFor="claude-inbox-subject"
                className="w-12 shrink-0 font-medium text-slate-700"
              >
                Subject:
              </label>
              <input
                id="claude-inbox-subject"
                type="text"
                value={subject}
                onChange={(event) => {
                  const target = event.currentTarget as unknown as {
                    readonly value: string;
                  };
                  setSubject(target.value);
                  if (composerStatus === "validation-error") {
                    setComposerStatus("idle");
                    setComposerErrors([]);
                  }
                }}
                placeholder="Add a subject"
                className={cn(
                  "flex-1 bg-transparent text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none",
                  composerStatus === "validation-error" &&
                    composerErrors.some((e) => e.field === "subject") &&
                    "text-red-700 placeholder:text-red-400"
                )}
              />
            </div>
          </>
        ) : null}

        {/* Textarea — or AI generating indicator */}
        <div className="relative">
          {isAiGenerating ? (
            <div className="flex min-h-[8rem] items-center justify-center gap-3 px-5">
              <BotIcon className="h-4 w-4 text-violet-500" />
              <span className="text-xs text-violet-600">
                {aiDraft.status === "reprompting"
                  ? "Regenerating draft…"
                  : "Writing a draft…"}
              </span>
              <div className="flex gap-1">
                <span className="h-1 w-1 animate-bounce rounded-full bg-violet-400 [animation-delay:0ms]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-violet-400 [animation-delay:150ms]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-violet-400 [animation-delay:300ms]" />
              </div>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => {
                const target = event.currentTarget as unknown as {
                  readonly value: string;
                };
                setDraft(target.value);
                if (composerStatus === "validation-error") {
                  setComposerStatus("idle");
                  setComposerErrors([]);
                }
                if (
                  aiDraft.status === "inserted" &&
                  target.value !== aiDraft.generatedText
                ) {
                  markAiDraftEdited();
                }
              }}
              placeholder={placeholder}
              rows={6}
              className={cn(
                "block w-full resize-none bg-transparent px-5 py-3 text-sm leading-6 text-slate-900 placeholder:text-slate-400 focus:outline-none",
                composerStatus === "validation-error" &&
                  composerErrors.some((e) => e.field === "body") &&
                  "ring-1 ring-inset ring-red-200"
              )}
            />
          )}

          {hasAiDraftActive ? (
            <div className="absolute left-0 top-0 h-full w-0.5 bg-violet-300" />
          ) : null}
        </div>
      </div>

      {/* Formatting toolbar */}
      {!isAiGenerating ? <FormattingToolbar mode={mode} /> : null}

      {/* AI draft toolbar — shown when AI content is in the textarea */}
      {hasAiDraftActive ? (
        <AiToolbar
          isEdited={isAiEdited}
          aiPrompt={aiPrompt}
          onPromptChange={setAiPrompt}
          onReprompt={handleReprompt}
          onDiscard={handleDiscard}
          disabled={isAiGenerating}
        />
      ) : null}

      {/* Validation errors */}
      {composerStatus === "validation-error" && composerErrors.length > 0 ? (
        <div className="border-t border-red-100 bg-red-50/50 px-5 py-2">
          {composerErrors.map((error) => (
            <p
              key={error.field}
              className="flex items-center gap-1.5 text-xs text-red-700"
            >
              <AlertCircleIcon className="h-3 w-3 shrink-0" />
              {error.message}
            </p>
          ))}
        </div>
      ) : null}

      {/* Footer: status left, send right */}
      <div className="flex items-center border-t border-slate-100 px-5 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ComposerStatusIndicator
            status={composerStatus}
            onRetry={handleSend}
            onDismiss={() => {
              setComposerStatus("idle");
            }}
          />

          {mode === "note" && composerStatus === "idle" ? (
            <p className="text-[11px] text-slate-500">
              Only visible to operators.
            </p>
          ) : null}

          {composerStatus === "idle" &&
          draft.length > 0 &&
          !hasAiDraftActive ? (
            <span className="flex items-center gap-1 text-[11px] text-slate-400">
              <CheckCircleIcon className="h-3 w-3" />
              Auto-saved
            </span>
          ) : null}
        </div>

        <Button
          size="sm"
          className="ml-3 gap-1.5"
          disabled={
            composerStatus === "sending" ||
            composerStatus === "sent-success" ||
            isAiGenerating
          }
          onClick={handleSend}
        >
          {composerStatus === "sending" ? (
            <>
              <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
              Sending…
            </>
          ) : composerStatus === "sent-success" ? (
            <>
              <CheckCircleIcon className="h-3.5 w-3.5" />
              Sent
            </>
          ) : (
            <>
              <SendIcon className="h-3.5 w-3.5" />
              {mode === "note" ? "Save note" : "Send"}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ───── AI button (always visible in toolbar) ─────

function AiButton({
  status,
  onDraftWithAi
}: {
  readonly status: AiDraftStatus;
  readonly onDraftWithAi: () => void;
}) {
  // Generating / reprompting — show spinner
  if (status === "generating" || status === "reprompting") {
    return (
      <Button variant="outline" size="sm" className="gap-1.5" disabled>
        <LoaderIcon className="h-3.5 w-3.5 animate-spin text-violet-600" />
        <span className="text-xs">Generating…</span>
      </Button>
    );
  }

  // Unavailable — disabled with note
  if (status === "unavailable") {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-slate-400"
        disabled
      >
        <WifiOffIcon className="h-3.5 w-3.5" />
        <span className="text-xs">AI unavailable</span>
      </Button>
    );
  }

  // Draft is active (inserted or edited) — button still visible but secondary
  if (status === "inserted" || status === "edited-after-generation") {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-slate-400"
        disabled
      >
        <SparkleIcon className="h-3.5 w-3.5" />
        <span className="text-xs">AI active</span>
      </Button>
    );
  }

  // Default — ready to use
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={onDraftWithAi}
    >
      <SparkleIcon className="h-3.5 w-3.5 text-violet-600" />
      <span className="text-xs">Draft with AI</span>
    </Button>
  );
}

// ───── Composer status indicator ─────

function ComposerStatusIndicator({
  status,
  onRetry,
  onDismiss
}: {
  readonly status: ComposerStatus;
  readonly onRetry: () => void;
  readonly onDismiss: () => void;
}) {
  switch (status) {
    case "idle":
      return null;
    case "saving-draft":
      return (
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <LoaderIcon className="h-3 w-3 animate-spin" />
          Saving…
        </span>
      );
    case "draft-saved":
      return (
        <span className="flex items-center gap-1.5 text-xs text-emerald-700">
          <CheckCircleIcon className="h-3 w-3" />
          Saved
        </span>
      );
    case "validation-error":
      return (
        <span className="flex items-center gap-1.5 text-xs text-red-600">
          <AlertCircleIcon className="h-3 w-3" />
          Fix errors above
        </span>
      );
    case "sending":
      return (
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <LoaderIcon className="h-3 w-3 animate-spin" />
          Sending…
        </span>
      );
    case "sent-success":
      return (
        <span className="flex items-center gap-1.5 text-xs text-emerald-700">
          <CheckCircleIcon className="h-3 w-3" />
          Sent
        </span>
      );
    case "send-failure":
      return (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-red-600">
            <XCircleIcon className="h-3 w-3" />
            Failed
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-red-700 hover:text-red-900"
            onClick={onRetry}
          >
            <RefreshCwIcon className="mr-1 h-3 w-3" />
            Retry
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-slate-500"
            onClick={onDismiss}
          >
            Dismiss
          </Button>
        </div>
      );
  }
}

// ───── AI draft toolbar ─────

function AiToolbar({
  isEdited,
  aiPrompt,
  onPromptChange,
  onReprompt,
  onDiscard,
  disabled
}: {
  readonly isEdited: boolean;
  readonly aiPrompt: string;
  readonly onPromptChange: (v: string) => void;
  readonly onReprompt: () => void;
  readonly onDiscard: () => void;
  readonly disabled: boolean;
}) {
  const [repromptOpen, setRepromptOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const openReprompt = () => {
    setRepromptOpen(true);
    setTimeout(() => {
      const el = inputRef.current;
      if (el && "focus" in el) {
        (el as unknown as { focus: () => void }).focus();
      }
    }, 50);
  };

  const submitReprompt = () => {
    onReprompt();
    setRepromptOpen(false);
  };

  return (
    <div className="flex items-center gap-2 border-t border-violet-100 bg-violet-50/40 px-5 py-1.5">
      <SparkleIcon className="h-3 w-3 shrink-0 text-violet-500" />
      <span className="text-[11px] font-medium text-violet-700">
        {isEdited ? "AI draft · edited" : "AI draft"}
      </span>

      <div className="ml-auto flex items-center gap-1">
        {repromptOpen ? (
          <>
            <div className="flex items-center overflow-hidden rounded-md border border-violet-200 bg-white shadow-sm">
              <input
                ref={inputRef}
                type="text"
                value={aiPrompt}
                onChange={(e) => {
                  const target = e.currentTarget as unknown as {
                    readonly value: string;
                  };
                  onPromptChange(target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitReprompt();
                  if (e.key === "Escape") setRepromptOpen(false);
                }}
                placeholder="e.g. Make it shorter…"
                className="w-48 px-2.5 py-1 text-[11px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={submitReprompt}
                disabled={disabled}
                className="flex items-center border-l border-violet-200 bg-violet-50 px-2 py-1 text-violet-600 transition-colors hover:bg-violet-100 disabled:opacity-50"
              >
                <SendIcon className="h-3 w-3" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setRepromptOpen(false);
              }}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:text-slate-600"
            >
              <XIcon className="h-3 w-3" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={openReprompt}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-violet-700 transition-colors hover:bg-violet-100 hover:text-violet-900 disabled:opacity-50"
          >
            <RotateCcwIcon className="h-3 w-3" />
            Redo
          </button>
        )}
        <div className="mx-0.5 h-3 w-px bg-violet-200" />
        <button
          type="button"
          onClick={onDiscard}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-slate-500 transition-colors hover:text-red-600"
        >
          <TrashIcon className="h-3 w-3" />
          Discard
        </button>
      </div>
    </div>
  );
}

// ───── Formatting toolbar ─────

type LinkState = "idle" | "editing" | "inserted";
type ImageState = "idle" | "picking" | "uploading" | "uploaded" | "error";
type AttachState = "idle" | "picking" | "uploading" | "attached" | "error";

interface AttachedFile {
  readonly name: string;
  readonly size: string;
}

function FormattingToolbar({ mode }: { readonly mode: ComposerMode }) {
  // Text formatting (toggle states)
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [list, setList] = useState<"none" | "bullet" | "ordered">("none");

  // Link state
  const [linkState, setLinkState] = useState<LinkState>("idle");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");

  // Image embed state
  const [imageState, setImageState] = useState<ImageState>("idle");
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // File attach state
  const [attachState, setAttachState] = useState<AttachState>("idle");
  const [attachedFiles, setAttachedFiles] = useState<readonly AttachedFile[]>(
    []
  );

  const handleInsertLink = () => {
    if (linkUrl.trim()) {
      setLinkState("inserted");
      setTimeout(() => {
        setLinkState("idle");
        setLinkUrl("");
        setLinkText("");
      }, 1500);
    }
  };

  const handleImagePick = () => {
    setImageState("uploading");
    setTimeout(() => {
      setImagePreview("landscape-photo.jpg");
      setImageState("uploaded");
    }, 1200);
  };

  const handleAttachFile = () => {
    setAttachState("uploading");
    setTimeout(() => {
      setAttachedFiles((prev) => [
        ...prev,
        { name: "training-schedule.pdf", size: "245 KB" }
      ]);
      setAttachState("attached");
    }, 1000);
  };

  const handleRemoveFile = (name: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.name !== name));
    if (attachedFiles.length <= 1) {
      setAttachState("idle");
    }
  };

  const handleRemoveImage = () => {
    setImagePreview(null);
    setImageState("idle");
  };

  const isSms = mode === "sms";

  return (
    <TooltipProvider delayDuration={300}>
      <div className="border-t border-slate-100">
        {/* Attached files strip */}
        {attachedFiles.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-2">
            {attachedFiles.map((file) => (
              <span
                key={file.name}
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-700"
              >
                <FileDocIcon className="h-3 w-3 text-slate-500" />
                {file.name}
                <span className="text-slate-400">{file.size}</span>
                <button
                  type="button"
                  onClick={() => {
                    handleRemoveFile(file.name);
                  }}
                  className="ml-0.5 rounded p-0.5 text-slate-400 hover:text-red-500"
                >
                  <XIcon className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {/* Embedded image preview */}
        {imagePreview ? (
          <div className="border-b border-slate-100 px-5 py-2">
            <div className="inline-flex items-center gap-2 rounded-md bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">
              <ImageIcon className="h-3 w-3" />
              <span className="font-medium">{imagePreview}</span>
              <span className="text-emerald-500">embedded</span>
              <button
                type="button"
                onClick={handleRemoveImage}
                className="ml-1 rounded p-0.5 text-emerald-500 hover:text-red-500"
              >
                <XIcon className="h-2.5 w-2.5" />
              </button>
            </div>
          </div>
        ) : null}

        {/* Toolbar buttons */}
        <div className="flex items-center gap-0.5 px-4 py-1.5">
          {/* Text formatting — email and note only */}
          {!isSms ? (
            <>
              <ToolbarButton
                icon={<BoldIcon className="h-3.5 w-3.5" />}
                label="Bold"
                active={bold}
                onClick={() => {
                  setBold((b) => !b);
                }}
              />
              <ToolbarButton
                icon={<ItalicIcon className="h-3.5 w-3.5" />}
                label="Italic"
                active={italic}
                onClick={() => {
                  setItalic((i) => !i);
                }}
              />
              <ToolbarButton
                icon={<ListIcon className="h-3.5 w-3.5" />}
                label="Bullet list"
                active={list === "bullet"}
                onClick={() => {
                  setList((l) => (l === "bullet" ? "none" : "bullet"));
                }}
              />
              <ToolbarButton
                icon={<ListOrderedIcon className="h-3.5 w-3.5" />}
                label="Numbered list"
                active={list === "ordered"}
                onClick={() => {
                  setList((l) => (l === "ordered" ? "none" : "ordered"));
                }}
              />

              <div className="mx-1 h-4 w-px bg-slate-200" />
            </>
          ) : null}

          {/* Add Link */}
          <Popover
            open={linkState === "editing"}
            onOpenChange={(open) => {
              setLinkState(open ? "editing" : "idle");
            }}
          >
            <PopoverTrigger asChild>
              <span>
                <ToolbarButton
                  icon={<LinkIcon className="h-3.5 w-3.5" />}
                  label={
                    linkState === "inserted" ? "Link inserted" : "Add link"
                  }
                  active={linkState === "editing"}
                  success={linkState === "inserted"}
                  onClick={() => {
                    setLinkState("editing");
                  }}
                />
              </span>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-72"
              onOpenAutoFocus={(e) => {
                e.preventDefault();
              }}
            >
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Insert link
                </p>
                <input
                  type="text"
                  value={linkUrl}
                  onChange={(e) => {
                    const target = e.currentTarget as unknown as {
                      readonly value: string;
                    };
                    setLinkUrl(target.value);
                  }}
                  placeholder="https://…"
                  className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
                />
                <input
                  type="text"
                  value={linkText}
                  onChange={(e) => {
                    const target = e.currentTarget as unknown as {
                      readonly value: string;
                    };
                    setLinkText(target.value);
                  }}
                  placeholder="Display text (optional)"
                  className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
                />
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setLinkState("idle");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!linkUrl.trim()}
                    onClick={handleInsertLink}
                  >
                    Insert
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Embed Image — email and note only */}
          {!isSms ? (
            <Popover
              open={imageState === "picking"}
              onOpenChange={(open) => {
                setImageState(open ? "picking" : "idle");
              }}
            >
              <PopoverTrigger asChild>
                <span>
                  <ToolbarButton
                    icon={
                      imageState === "uploading" ? (
                        <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ImageIcon className="h-3.5 w-3.5" />
                      )
                    }
                    label={
                      imageState === "uploading"
                        ? "Uploading…"
                        : imageState === "uploaded"
                          ? "Image embedded"
                          : imageState === "error"
                            ? "Upload failed"
                            : "Embed image"
                    }
                    active={imageState === "picking"}
                    success={imageState === "uploaded"}
                    error={imageState === "error"}
                    disabled={imageState === "uploading"}
                    onClick={() => {
                      if (
                        imageState === "idle" ||
                        imageState === "error"
                      ) {
                        setImageState("picking");
                      }
                    }}
                  />
                </span>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64">
                <div className="space-y-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Embed image
                  </p>
                  <button
                    type="button"
                    onClick={handleImagePick}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 py-6 text-xs text-slate-500 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-700"
                  >
                    <UploadIcon className="h-4 w-4" />
                    Choose image or drag here
                  </button>
                  <p className="text-center text-[10px] text-slate-400">
                    PNG, JPG, GIF up to 5 MB
                  </p>
                </div>
              </PopoverContent>
            </Popover>
          ) : null}

          {/* Attach File */}
          <ToolbarButton
            icon={
              attachState === "uploading" ? (
                <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PaperclipIcon className="h-3.5 w-3.5" />
              )
            }
            label={
              attachState === "uploading"
                ? "Uploading…"
                : attachState === "attached"
                  ? `${attachedFiles.length.toString()} attached`
                  : attachState === "error"
                    ? "Attach failed"
                    : "Attach file"
            }
            error={attachState === "error"}
            disabled={attachState === "uploading"}
            onClick={() => {
              if (
                attachState === "idle" ||
                attachState === "attached" ||
                attachState === "error"
              ) {
                handleAttachFile();
              }
            }}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

// ───── Toolbar button primitive ─────

function ToolbarButton({
  icon,
  label,
  active = false,
  success = false,
  error = false,
  disabled = false,
  onClick
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly active?: boolean;
  readonly success?: boolean;
  readonly error?: boolean;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400",
            "disabled:pointer-events-none disabled:opacity-40",
            active
              ? "bg-slate-200 text-slate-900"
              : success
                ? "text-emerald-600"
                : error
                  ? "text-red-500"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="rounded bg-slate-900 px-2 py-1 text-[11px] text-white"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// ───── Helpers ─────

function placeholderForMode(mode: ComposerMode, name: string): string {
  switch (mode) {
    case "email":
      return `Reply to ${name}…`;
    case "sms":
      return `Text ${name}…`;
    case "note":
      return "Write a note for the team — not visible to the contact.";
  }
}
