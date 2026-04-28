"use client";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SHADOW, TRANSITION, TYPE } from "@/app/_lib/design-tokens-v2";
import { sanitizeComposerHtml } from "@/src/lib/html-sanitizer";

import type { InboxTimelineEntryViewModel } from "../_lib/view-models";
import { autolinkText } from "./_autolink";
import { EmailParticipantHeader } from "./email-participant-header";
import { InboxAvatar } from "./inbox-avatar";
import { formatBytes } from "./composer-shared";
import {
  AdventureScientistsLogo,
  ArrowUpRightIcon,
  CornerUpLeftIcon,
  FileDocIcon,
  LoaderIcon,
  MailIcon,
  PhoneIcon,
  RefreshCwIcon,
} from "./icons";

const WRAP_ANYWHERE = "break-words [overflow-wrap:anywhere]";
const HTML_TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/u;
const EMAIL_HTML_BODY_CLASS =
  "text-pretty text-[14px] leading-relaxed text-slate-700 [&_a]:text-sky-700 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-slate-200 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600 [&_code]:rounded-sm [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_ol]:ml-5 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-slate-100 [&_pre]:p-3 [&_table]:my-2 [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-slate-200 [&_th]:px-2 [&_th]:py-1 [&_ul]:ml-5 [&_ul]:list-disc";

function bodyContainsHtml(body: string): boolean {
  return HTML_TAG_PATTERN.test(body);
}

function sanitizeTimelineHtmlBody(body: string): string {
  return sanitizeComposerHtml(body);
}

function initialsForLabel(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "AS";
  }

  if (parts.length === 1) {
    return (parts[0] ?? "AS").slice(0, 2).toUpperCase();
  }

  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function bodyTextForEntry(entry: InboxTimelineEntryViewModel): string {
  return entry.body.trim();
}

function attachmentLabel(filename: string | null): string {
  return filename?.trim().length ? filename : "Attachment";
}

function MessageAttachments({
  attachments,
}: {
  readonly attachments: InboxTimelineEntryViewModel["attachments"];
}) {
  if (attachments.length === 0) {
    return null;
  }

  const imageAttachments = attachments.filter((attachment) =>
    attachment.mimeType.startsWith("image/"),
  );
  const fileAttachments = attachments.filter(
    (attachment) => !attachment.mimeType.startsWith("image/"),
  );

  return (
    <div className="mt-3 flex flex-col gap-3">
      {imageAttachments.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {imageAttachments.map((attachment) => {
            const label = attachmentLabel(attachment.filename);

            return (
              <Dialog key={attachment.id}>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- proxy serves authenticated bytes; next/image optimizer cannot fetch through cookie auth */}
                    <img
                      src={attachment.proxyUrl}
                      alt={label}
                      loading="lazy"
                      className="h-[160px] w-[240px] object-cover"
                    />
                  </button>
                </DialogTrigger>
                <DialogContent className="max-w-4xl border-slate-200 bg-white p-3">
                  <DialogTitle className="px-8 text-sm">{label}</DialogTitle>
                  {/* eslint-disable-next-line @next/next/no-img-element -- same reason as the trigger thumbnail above */}
                  <img
                    src={attachment.proxyUrl}
                    alt={label}
                    className="max-h-[80vh] w-full rounded-md object-contain"
                  />
                </DialogContent>
              </Dialog>
            );
          })}
        </div>
      ) : null}

      {fileAttachments.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {fileAttachments.map((attachment) => {
            const label = attachmentLabel(attachment.filename);

            return (
              <a
                key={attachment.id}
                href={attachment.proxyUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Download ${label}`}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors duration-150 ease-out hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
              >
                <FileDocIcon className="size-3.5 shrink-0" />
                <span className="max-w-[16rem] truncate">{label}</span>
                <span className="text-slate-400">{formatBytes(attachment.sizeBytes)}</span>
                <ArrowUpRightIcon className="size-3 shrink-0 text-slate-400" />
              </a>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ReplyFooter({
  entryId,
  tone,
  onReply,
}: {
  readonly entryId: string;
  readonly tone: "slate" | "sky" | "sky-inverse";
  readonly onReply?: (entryId: string) => void;
}) {
  if (onReply === undefined) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-center justify-end border-t px-4 py-2",
        tone === "sky-inverse"
          ? "border-sky-500/40"
          : tone === "sky"
            ? "border-sky-100/60"
            : "border-slate-100",
      )}
    >
      <button
        type="button"
        onClick={() => {
          onReply(entryId);
        }}
        className={cn(
          "inline-flex items-center gap-1 text-[12px]",
          TRANSITION.fast,
          TRANSITION.reduceMotion,
          tone === "sky-inverse"
            ? "text-sky-100 hover:text-white hover:underline"
            : "text-sky-700 hover:underline",
        )}
      >
        <CornerUpLeftIcon className="h-3 w-3" />
        <span>Reply</span>
      </button>
    </div>
  );
}

function InboundMetadataRow({
  entry,
}: {
  readonly entry: InboxTimelineEntryViewModel;
}) {
  const ChannelIcon = entry.channel === "email" ? MailIcon : PhoneIcon;

  return (
    <div className={cn("mt-1.5 flex items-center gap-1.5 px-1", TYPE.micro)}>
      <ChannelIcon className="h-3 w-3" />
      <span className="font-medium text-slate-500">{entry.actorLabel}</span>
      {entry.isUnread ? (
        <span
          className="inline-flex h-1.5 w-1.5 rounded-full bg-sky-500"
          aria-label="Unread"
        />
      ) : null}
    </div>
  );
}

function OutboundSmsMetaRow({
  entry,
}: {
  readonly entry: InboxTimelineEntryViewModel;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 pr-1 text-[11px] text-sky-600">
      <PhoneIcon className="h-3 w-3" />
      <span className="font-medium uppercase tracking-wide">SMS</span>
      <span className="text-sky-300">·</span>
      <time
        dateTime={entry.occurredAt}
        title={entry.occurredAt}
        className="text-sky-700/80"
      >
        {entry.occurredAtLabel}
      </time>
    </div>
  );
}

function OutboundStatusBanner({
  entry,
  isRetrying,
  onRetryPending,
}: {
  readonly entry: InboxTimelineEntryViewModel;
  readonly isRetrying: boolean;
  readonly onRetryPending?: (entryId: string) => void;
}) {
  if (entry.sendStatus === "pending") {
    return (
      <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-white px-2 py-1 text-[11px] font-medium text-sky-700">
        <LoaderIcon className="size-3 animate-spin" />
        Sending...
      </div>
    );
  }

  if (entry.sendStatus !== "failed" && entry.sendStatus !== "orphaned") {
    return null;
  }

  const canRetry =
    entry.attachmentCount === 0 && onRetryPending !== undefined;
  const retryDisabledReason =
    entry.attachmentCount > 0
      ? "Re-attach files and send as a new message"
      : null;

  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900">
      <span>
        {entry.failedReason === "bounce"
          ? "Your last reply to this contact bounced — recipient address may be invalid."
          : entry.sendStatus === "failed"
            ? "Send failed."
            : "Send stalled before confirmation."}
      </span>
      {retryDisabledReason ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 font-medium text-rose-500"
              >
                <RefreshCwIcon className="size-3" />
                Retry
              </button>
            </TooltipTrigger>
            <TooltipContent>{retryDisabledReason}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <button
          type="button"
          disabled={!canRetry || isRetrying}
          onClick={() => {
            if (canRetry) {
              onRetryPending(entry.id);
            }
          }}
          className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 font-medium text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isRetrying ? (
            <LoaderIcon className="size-3 animate-spin" />
          ) : (
            <RefreshCwIcon className="size-3" />
          )}
          Retry
        </button>
      )}
    </div>
  );
}

function OutboundBrandAvatar() {
  return (
    <span
      aria-label="Adventure Scientists"
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white ring-1 ring-slate-900/10"
    >
      <AdventureScientistsLogo className="size-6" />
    </span>
  );
}

export function MessageBubble({
  entry,
  direction,
  onReply,
  isRetrying = false,
  onRetryPending,
}: {
  readonly entry: InboxTimelineEntryViewModel;
  readonly direction: "inbound" | "outbound";
  readonly onReply?: (entryId: string) => void;
  readonly isRetrying?: boolean;
  readonly onRetryPending?: (entryId: string) => void;
}) {
  const isEmail = entry.channel === "email";
  // Pre-PR-#170 we rendered every email body as plaintext via
  // `whitespace-pre-wrap`. PR #170 added a sanitized HTML render path for
  // legitimately rich-formatted emails. Keep both: HTML if present,
  // plaintext+autolink fallback otherwise.
  const sanitizedHtmlBody = (() => {
    const candidateBody = bodyTextForEntry(entry);
    return entry.channel === "email" && bodyContainsHtml(candidateBody)
      ? sanitizeTimelineHtmlBody(candidateBody)
      : null;
  })();
  const isOutbound = direction === "outbound";
  const body = bodyTextForEntry(entry);
  const inboundAvatar = (
    <InboxAvatar
      initials={initialsForLabel(entry.actorLabel)}
      tone="slate"
      size="sm"
    />
  );

  const bubbleClassName = isEmail
    ? isOutbound
      ? "border border-sky-100 bg-sky-50"
      : "border border-slate-200 bg-white"
    : isOutbound
      ? "border border-sky-600 bg-sky-600 text-white"
      : "border border-slate-200 bg-white";
  const replyTone = isOutbound ? (isEmail ? "sky" : "sky-inverse") : "slate";

  return (
    <li
      className={cn(
        "flex w-full flex-col",
        isOutbound ? "items-end pl-16" : "items-start pr-16",
      )}
    >
      {isOutbound && !isEmail ? <OutboundSmsMetaRow entry={entry} /> : null}

      <div
        className={cn(
          "flex w-full items-start gap-2.5",
          isOutbound ? "justify-end" : "justify-start",
        )}
      >
        {!isOutbound ? (
          <div className="mt-2 shrink-0">{inboundAvatar}</div>
        ) : null}

        <div
          className={cn(
            "min-w-0 w-full max-w-[640px] overflow-hidden rounded-xl",
            SHADOW.sm,
            bubbleClassName,
          )}
        >
          {isEmail ? (
            <EmailParticipantHeader
              entry={entry}
              tone={isOutbound ? "sky" : "slate"}
            />
          ) : null}

          <div className={cn("px-4", isEmail ? "py-3" : "py-2.5")}>
            {isOutbound ? (
              <OutboundStatusBanner
                entry={entry}
                isRetrying={isRetrying}
                {...(onRetryPending === undefined ? {} : { onRetryPending })}
              />
            ) : null}

            {isEmail && entry.subject ? (
              <p
                className={cn(
                  "mb-1.5 text-balance text-[14px] font-semibold text-slate-900",
                  WRAP_ANYWHERE,
                )}
              >
                {entry.subject}
              </p>
            ) : null}

            {sanitizedHtmlBody !== null && sanitizedHtmlBody.length > 0 ? (
              <div
                className={cn(EMAIL_HTML_BODY_CLASS, WRAP_ANYWHERE)}
                dangerouslySetInnerHTML={{ __html: sanitizedHtmlBody }}
              />
            ) : body.length > 0 ? (
              <p
                className={cn(
                  "whitespace-pre-wrap text-pretty text-[14px] leading-relaxed",
                  isOutbound && !isEmail ? "text-white" : "text-slate-700",
                  WRAP_ANYWHERE,
                )}
              >
                {autolinkText(body)}
              </p>
            ) : null}

            <MessageAttachments attachments={entry.attachments} />
          </div>

          <ReplyFooter
            entryId={entry.id}
            tone={replyTone}
            {...(onReply === undefined ? {} : { onReply })}
          />
        </div>

        {isOutbound ? (
          <div className="mt-2 shrink-0">
            <OutboundBrandAvatar />
          </div>
        ) : null}
      </div>

      {!isOutbound ? <InboundMetadataRow entry={entry} /> : null}
    </li>
  );
}
