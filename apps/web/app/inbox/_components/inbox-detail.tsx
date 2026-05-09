"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  archiveInboxContactAction,
  clearInboxNeedsFollowUpAction,
  markInboxNeedsFollowUpAction,
  markInboxOpenedAction,
  markInboxUnreadAction,
  sendComposerAction,
  unarchiveInboxContactAction,
} from "../actions";
import { plaintextToComposerHtml } from "@/src/lib/html-sanitizer";
import { fetchInboxTimelinePage } from "../_lib/client-api";
import type {
  InboxComposerReplyContext,
  InboxDetailSummaryViewModel,
  InboxDetailTimelineViewModel,
  InboxTimelineEntryViewModel,
  OptimisticOutbound,
} from "../_lib/view-models";
import type { UiError, UiResult } from "@/src/server/ui-result";
import { InboxFreshnessPoller } from "./inbox-freshness-poller";
import { useInboxClient } from "./inbox-client-provider";
import { InboxAvatar } from "./inbox-avatar";
import { StatusBadge } from "@/components/ui/status-badge";
import { PROJECT_STATUS_BADGE } from "@/app/_lib/design-tokens";
import {
  LAYOUT,
  SPACING,
  TONE_CLASSES,
  TRANSITION,
} from "@/app/_lib/design-tokens-v2";
import { InboxComposerReplyBar } from "./inbox-composer";
import { InboxContactRail } from "./inbox-contact-rail";
import { TimelineSkeleton } from "./inbox-loading";
import { InboxTimeline } from "./inbox-timeline";
import {
  AlertTriangleIcon,
  ArchiveBoxIcon,
  ArchiveRestoreIcon,
  FlagIcon,
  MailOpenIcon,
  UserRoundIcon,
} from "./icons";

interface DetailProps {
  readonly detail: InboxDetailSummaryViewModel;
  readonly timelineSlot?: ReactNode;
  readonly currentOperatorUserId: string;
}

interface InboxDetailTimelinePanelProps {
  readonly contact: InboxDetailSummaryViewModel["contact"];
  readonly composerReplyContext: InboxComposerReplyContext | null;
  readonly initialTimeline: InboxDetailTimelineViewModel;
  readonly currentOperatorUserId: string;
}

const REPLY_SUBJECT_PREFIX_PATTERN = /^\s*(?:(?:re|fwd?)\s*:\s*)+/i;

function extractEmailAddresses(value: string | null | undefined): string[] {
  if (value === null || value === undefined) {
    return [];
  }

  return Array.from(
    new Set(
      Array.from(value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)).map(
        (match) => match[0].toLowerCase(),
      ),
    ),
  );
}

function buildReplySubject(subject: string | null): string {
  const normalizedSubject = subject?.trim() ?? "";

  if (normalizedSubject.length === 0) {
    return "";
  }

  const trimmedSubject = normalizedSubject
    .replace(REPLY_SUBJECT_PREFIX_PATTERN, "")
    .trim();

  return trimmedSubject.length === 0 ? "" : `Re: ${trimmedSubject}`;
}

function buildTimelineReplyContext(input: {
  readonly contactId: string;
  readonly contactDisplayName: string;
  readonly contactPrimaryPhone: string | null;
  readonly entry: InboxTimelineEntryViewModel;
  readonly defaultAlias: string | null;
}): InboxComposerReplyContext | null {
  if (input.entry.channel !== "email") {
    return null;
  }

  return {
    contactId: input.contactId,
    contactDisplayName: input.contactDisplayName,
    contactPrimaryPhone: input.contactPrimaryPhone,
    subject: buildReplySubject(input.entry.subject),
    threadCursor: input.entry.kind === "inbound-email" ? input.entry.id : null,
    threadId: input.entry.threadId,
    inReplyToRfc822:
      input.entry.kind === "inbound-email"
        ? input.entry.rfc822MessageId
        : input.entry.inReplyToRfc822,
    defaultAlias: input.defaultAlias,
    cc: extractEmailAddresses(input.entry.ccHeader),
  };
}

function sortTimelineEntries(
  entries: readonly InboxTimelineEntryViewModel[],
): readonly InboxTimelineEntryViewModel[] {
  return [...entries].sort(compareTimelineEntries);
}

function timelineLifecycleOrdinal(
  entry: InboxTimelineEntryViewModel,
): number | null {
  if (entry.kind !== "system-event") {
    return null;
  }

  const normalized = entry.body.toLowerCase();

  if (normalized.startsWith("signed up")) {
    return 1;
  }

  if (normalized.startsWith("received training")) {
    return 2;
  }

  if (normalized.startsWith("completed training")) {
    return 3;
  }

  if (normalized.startsWith("submitted first data")) {
    return 4;
  }

  return null;
}

function compareTimelineEntries(
  left: InboxTimelineEntryViewModel,
  right: InboxTimelineEntryViewModel,
): number {
  const leftDate = left.occurredAt.slice(0, 10);
  const rightDate = right.occurredAt.slice(0, 10);

  if (leftDate !== rightDate) {
    return left.occurredAt.localeCompare(right.occurredAt);
  }

  const leftLifecycleOrdinal = timelineLifecycleOrdinal(left);
  const rightLifecycleOrdinal = timelineLifecycleOrdinal(right);

  if (leftLifecycleOrdinal !== null && rightLifecycleOrdinal !== null) {
    const lifecycleDifference =
      leftLifecycleOrdinal - rightLifecycleOrdinal;

    if (lifecycleDifference !== 0) {
      return lifecycleDifference;
    }
  }

  return left.occurredAt.localeCompare(right.occurredAt);
}

function realEntryMatchesOptimistic(
  realEntry: InboxTimelineEntryViewModel,
  optimisticEntry: OptimisticOutbound,
): boolean {
  if (realEntry.id === optimisticEntry.id) {
    return false;
  }

  if (realEntry.kind !== optimisticEntry.kind) {
    return false;
  }

  if (realEntry.subject !== optimisticEntry.subject) {
    return false;
  }

  if (realEntry.mailbox !== optimisticEntry.mailbox) {
    return false;
  }

  return realEntry.occurredAt >= optimisticEntry.occurredAt;
}

export function InboxDetail({ detail, timelineSlot }: DetailProps) {
  const { contact } = detail;
  const { openReplyDraft } = useInboxClient();

  const [railOpen, setRailOpen] = useState(false);
  const followUpToggle = useOptimisticBooleanToggle({
    scopeKey: contact.contactId,
    value: detail.needsFollowUp,
    perform: useCallback(
      async (nextValue: boolean): Promise<UiResult<unknown>> => {
        const formData = new FormData();
        formData.set("contactId", contact.contactId);

        if (nextValue) {
          return markInboxNeedsFollowUpAction(formData);
        }

        return clearInboxNeedsFollowUpAction(formData);
      },
      [contact.contactId],
    ),
  });
  const router = useRouter();
  const [isMarkUnreadPending, startMarkUnreadTransition] = useTransition();
  const [isArchivePending, startArchiveTransition] = useTransition();
  const markOpenedRef = useRef(false);

  // Acknowledging an unread conversation uses the same open path whether the
  // unread state came from an inbound volunteer message or a non-alias
  // teammate reply. The ref prevents re-firing if the effect re-runs.
  useEffect(() => {
    if (
      markOpenedRef.current ||
      !detail.projectionAvailable ||
      !detail.isUnread
    ) {
      return;
    }
    markOpenedRef.current = true;
    const formData = new FormData();
    formData.set("contactId", contact.contactId);
    void markInboxOpenedAction(formData).then((result) => {
      if (result.ok) {
        router.refresh();
      }
    });
  }, [contact.contactId, detail.isUnread, detail.projectionAvailable, router]);

  const handleMarkUnread = useCallback(() => {
    startMarkUnreadTransition(async () => {
      const formData = new FormData();
      formData.set("contactId", contact.contactId);
      const result = await markInboxUnreadAction(formData);
      if (result.ok) {
        router.push("/inbox");
      }
    });
  }, [contact.contactId, router]);

  const handleArchive = useCallback(() => {
    startArchiveTransition(async () => {
      const formData = new FormData();
      formData.set("contactId", contact.contactId);
      const result = await archiveInboxContactAction(formData);
      if (result.ok) {
        router.push("/inbox");
      }
    });
  }, [contact.contactId, router]);

  const handleUnarchive = useCallback(() => {
    startArchiveTransition(async () => {
      const formData = new FormData();
      formData.set("contactId", contact.contactId);
      const result = await unarchiveInboxContactAction(formData);
      if (result.ok) {
        // Stay on the conversation; it's now in the regular inbox.
        // router.refresh() picks up the updated isArchived flag and the
        // header button switches back to "Archive".
        router.refresh();
      }
    });
  }, [contact.contactId, router]);

  const headerProject = contact.activeProjects[0] ?? detail.conversationProject;
  const isFollowUp = followUpToggle.value;
  const composerReplyContext = detail.composerReplyContext;

  return (
    <div className="flex min-h-0 flex-1">
      <InboxFreshnessPoller
        contactId={contact.contactId}
        detailFreshness={detail.freshness}
      />

      <section className="flex min-w-0 flex-1 flex-col border-r border-slate-200 bg-white">
        <header
          className={`flex ${LAYOUT.headerHeight} items-center justify-between gap-4 border-b border-slate-200 px-5`}
        >
          <div className="flex min-w-0 items-center gap-3.5">
            <InboxAvatar
              initials={detail.initials}
              tone={detail.avatarTone}
              size="sm"
              className="size-7 text-[11px]"
            />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold leading-tight text-slate-900 text-balance">
                {contact.displayName}
              </h1>
              {headerProject ? (
                <div className="mt-0.5 flex min-w-0 items-center gap-2">
                  <span
                    className="min-w-0 truncate text-[12px] font-medium leading-none text-slate-500"
                    title={
                      "source" in headerProject &&
                      headerProject.source === "conversation"
                        ? "Via project alias"
                        : undefined
                    }
                  >
                    {headerProject.projectName}
                  </span>
                  {"status" in headerProject ? (
                    <StatusBadge
                      variant="subtle"
                      colorClasses={PROJECT_STATUS_BADGE[headerProject.status]}
                      label={headerProject.statusLabel}
                      className="shrink-0"
                    />
                  ) : null}
                </div>
              ) : (
                <span className="text-xs text-slate-400">
                  No active project
                </span>
              )}
            </div>
            <div className="hidden items-center gap-1.5 sm:flex">
              {contact.hasUnresolved ? (
                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                  Unresolved
                </span>
              ) : null}
            </div>
          </div>

          <TooltipProvider delayDuration={200}>
            <div className="flex shrink-0 items-center gap-2">
              {detail.projectionAvailable ? (
                <>
                  <FollowUpToggleControl
                    needsFollowUp={isFollowUp}
                    error={followUpToggle.error}
                    onToggle={followUpToggle.toggle}
                  />

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Mark unread"
                        data-inbox-mark-unread="true"
                        disabled={isMarkUnreadPending}
                        onClick={handleMarkUnread}
                        className="size-8 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:z-20"
                      >
                        <MailOpenIcon className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Mark unread</TooltipContent>
                  </Tooltip>
                </>
              ) : null}

              {detail.projectionAvailable ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={
                        detail.isArchived
                          ? "Move back to inbox"
                          : "Archive conversation"
                      }
                      disabled={isArchivePending}
                      onClick={
                        detail.isArchived ? handleUnarchive : handleArchive
                      }
                      className="size-8 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:z-20"
                    >
                      {detail.isArchived ? (
                        <ArchiveRestoreIcon className="size-4" />
                      ) : (
                        <ArchiveBoxIcon className="size-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {detail.isArchived
                      ? "Move back to inbox"
                      : "Archive conversation"}
                  </TooltipContent>
                </Tooltip>
              ) : null}

              {!railOpen ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Volunteer details"
                      aria-expanded={false}
                      aria-controls="inbox-contact-rail"
                      onClick={() => {
                        setRailOpen(true);
                      }}
                      className="size-8 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:z-20"
                    >
                      <UserRoundIcon className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Volunteer details</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </TooltipProvider>
        </header>

        {contact.hasUnresolved ? <UnresolvedBanner /> : null}

        {timelineSlot ?? <InboxDetailTimelineFallback />}

        <div className="shrink-0">
          {composerReplyContext ? (
            <InboxComposerReplyBar
              contactDisplayName={contact.displayName}
              onReply={() => {
                openReplyDraft(composerReplyContext);
              }}
              onNote={() => {
                openReplyDraft(composerReplyContext, "note");
              }}
            />
          ) : null}
        </div>
      </section>

      <div
        className={cn(
          `min-h-0 shrink-0 overflow-hidden border-l ${TRANSITION.layout} ${TRANSITION.reduceMotion}`,
          railOpen
            ? `${LAYOUT.railWidth} border-slate-200 opacity-100`
            : "w-0 border-transparent opacity-0",
        )}
      >
        <div className={`flex h-full min-h-0 flex-col ${LAYOUT.railWidth}`}>
          <InboxContactRail
            contact={contact}
            onClose={() => {
              setRailOpen(false);
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function InboxDetailTimelinePanel({
  contact,
  composerReplyContext,
  initialTimeline,
  currentOperatorUserId,
}: InboxDetailTimelinePanelProps) {
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const activeTimelineRequestIdRef = useRef(0);
  const shouldScrollToLatestRef = useRef(true);
  const previousContactIdRef = useRef(contact.contactId);
  const {
    isTimelineLoading,
    setTimelineLoading,
    optimisticOutbounds,
    clearOptimisticForContact,
    removeOptimisticOutbound,
    openReplyDraft,
    showToast,
  } = useInboxClient();
  const [timelineEntries, setTimelineEntries] = useState(
    initialTimeline.timeline,
  );
  const [timelinePage, setTimelinePage] = useState(
    initialTimeline.timelinePage,
  );
  const [retryingEntryId, setRetryingEntryId] = useState<string | null>(null);
  const [isRetryPending, startRetryTransition] = useTransition();

  useEffect(() => {
    activeTimelineRequestIdRef.current += 1;
    setTimelineLoading(false);
    setTimelineEntries(initialTimeline.timeline);
    setTimelinePage(initialTimeline.timelinePage);

    if (previousContactIdRef.current !== contact.contactId) {
      clearOptimisticForContact(previousContactIdRef.current);
      shouldScrollToLatestRef.current = true;
      previousContactIdRef.current = contact.contactId;
    }
  }, [
    clearOptimisticForContact,
    contact.contactId,
    initialTimeline.timeline,
    initialTimeline.timelinePage,
    setTimelineLoading,
  ]);

  const activeOptimisticOutbounds = useMemo(
    () =>
      optimisticOutbounds.filter(
        (entry) => entry.contactId === contact.contactId,
      ),
    [contact.contactId, optimisticOutbounds],
  );

  const mergedTimelineEntries = useMemo(
    () =>
      sortTimelineEntries([...timelineEntries, ...activeOptimisticOutbounds]),
    [activeOptimisticOutbounds, timelineEntries],
  );

  useEffect(() => {
    const matchedSettledIds = activeOptimisticOutbounds
      .filter(
        (entry) =>
          entry.settledAt !== null &&
          timelineEntries.some((realEntry) =>
            realEntryMatchesOptimistic(realEntry, entry),
          ),
      )
      .map((entry) => entry.clientGeneratedId);

    if (matchedSettledIds.length === 0) {
      return;
    }

    for (const clientGeneratedId of matchedSettledIds) {
      removeOptimisticOutbound(clientGeneratedId);
    }
  }, [activeOptimisticOutbounds, removeOptimisticOutbound, timelineEntries]);

  useEffect(() => {
    if (!shouldScrollToLatestRef.current) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const container = timelineScrollRef.current;

      if (!container) {
        return;
      }

      container.scrollTop = container.scrollHeight;
      shouldScrollToLatestRef.current = false;
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [contact.contactId, mergedTimelineEntries]);

  const loadOlderTimeline = useCallback(async () => {
    if (!timelinePage.hasMore || timelinePage.nextCursor === null) {
      return;
    }

    const requestId = activeTimelineRequestIdRef.current + 1;
    activeTimelineRequestIdRef.current = requestId;
    const container = timelineScrollRef.current;
    const previousScrollHeight = container?.scrollHeight ?? 0;
    const previousScrollTop = container?.scrollTop ?? 0;
    setTimelineLoading(true);

    try {
      const nextPage = await fetchInboxTimelinePage({
        contactId: contact.contactId,
        cursor: timelinePage.nextCursor,
      });

      if (activeTimelineRequestIdRef.current !== requestId) {
        return;
      }

      setTimelineEntries((previousEntries) => [
        ...nextPage.entries,
        ...previousEntries,
      ]);
      setTimelinePage(nextPage.page);

      window.requestAnimationFrame(() => {
        const nextContainer = timelineScrollRef.current;

        if (!nextContainer) {
          return;
        }

        const nextScrollHeight = nextContainer.scrollHeight;
        nextContainer.scrollTop =
          previousScrollTop + (nextScrollHeight - previousScrollHeight);
      });
    } catch {
      // Keep the current timeline page visible; polling or the next click can retry.
    } finally {
      if (activeTimelineRequestIdRef.current === requestId) {
        setTimelineLoading(false);
      }
    }
  }, [contact.contactId, setTimelineLoading, timelinePage]);

  const handleReply = useCallback(
    (entryId: string) => {
      const entry = mergedTimelineEntries.find((item) => item.id === entryId);

      if (entry === undefined) {
        if (composerReplyContext !== null) {
          openReplyDraft(composerReplyContext);
        }
        return;
      }

      const replyContext =
        buildTimelineReplyContext({
          contactId: contact.contactId,
          contactDisplayName: contact.displayName,
          contactPrimaryPhone: contact.primaryPhone,
          entry,
          defaultAlias: composerReplyContext?.defaultAlias ?? null,
        }) ?? composerReplyContext;

      if (replyContext !== null) {
        openReplyDraft(replyContext);
      }
    },
    [
      composerReplyContext,
      contact.contactId,
      contact.displayName,
      contact.primaryPhone,
      mergedTimelineEntries,
      openReplyDraft,
    ],
  );

  const handleRetryPending = useCallback(
    (entryId: string) => {
      const entry = mergedTimelineEntries.find((item) => item.id === entryId);

      if (
        entry?.sendStatus === undefined ||
        entry.sendStatus === null ||
        entry.sendStatus === "pending" ||
        entry.attachmentCount > 0 ||
        entry.mailbox === null
      ) {
        return;
      }

      const pendingId = entry.id.startsWith("pending-outbound:")
        ? entry.id.slice("pending-outbound:".length)
        : entry.id.startsWith("optimistic:")
          ? null
          : null;

      if (
        !entry.id.startsWith("pending-outbound:") &&
        !entry.id.startsWith("optimistic:")
      ) {
        return;
      }

      const mailbox = entry.mailbox;

      setRetryingEntryId(entry.id);
      startRetryTransition(async () => {
        try {
          const result = await sendComposerAction({
            recipient: {
              kind: "contact",
              contactId: contact.contactId,
            },
            alias: mailbox,
            subject: entry.subject ?? "",
            bodyPlaintext: entry.body,
            bodyHtml: plaintextToComposerHtml(entry.body),
            attachments: [],
            ...(entry.threadId === null ? {} : { threadId: entry.threadId }),
            ...(entry.inReplyToRfc822 === null
              ? {}
              : { inReplyToRfc822: entry.inReplyToRfc822 }),
            ...(pendingId === null ? {} : { supersedesPendingId: pendingId }),
          });

          if (result.ok) {
            showToast(`Sent to ${contact.displayName}`, "success");
          } else {
            showToast(result.message, "error");
          }
        } catch {
          showToast("We could not retry that email right now.", "error");
        }
        setRetryingEntryId(null);
      });
    },
    [contact.contactId, contact.displayName, mergedTimelineEntries, showToast],
  );

  const volunteerFirstName =
    contact.displayName.split(" ")[0] ?? contact.displayName;

  return (
    <div
      ref={timelineScrollRef}
      className={`min-h-0 flex-1 overflow-y-auto ${TONE_CLASSES.slate.subtle} ${SPACING.container}`}
    >
      {isTimelineLoading && mergedTimelineEntries.length === 0 ? (
        <TimelineSkeleton />
      ) : (
        <InboxTimeline
          entries={mergedTimelineEntries}
          volunteerFirstName={volunteerFirstName}
          currentOperatorUserId={currentOperatorUserId}
          showEarlierHistoryDivider={timelinePage.hasHiddenEarlierHistory}
          hasMore={timelinePage.hasMore}
          isLoadingOlder={isTimelineLoading}
          retryingEntryId={isRetryPending ? retryingEntryId : null}
          onRetryPending={handleRetryPending}
          onReply={handleReply}
          onLoadOlder={() => {
            void loadOlderTimeline();
          }}
        />
      )}
    </div>
  );
}

export function InboxDetailTimelineFallback() {
  return (
    <div
      className={`min-h-0 flex-1 overflow-y-auto ${TONE_CLASSES.slate.subtle} ${SPACING.container}`}
    >
      <TimelineSkeleton />
    </div>
  );
}

function FollowUpToggleControl({
  needsFollowUp,
  error,
  onToggle,
}: {
  readonly needsFollowUp: boolean;
  readonly error: UiError | null;
  readonly onToggle: () => void;
}) {
  return (
    <div className="relative">
      <FollowUpToggleButton needsFollowUp={needsFollowUp} onToggle={onToggle} />

      {error ? (
        <div
          role="alert"
          className="absolute right-0 top-full z-10 mt-2 w-72 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 shadow-sm"
        >
          {error.message}
        </div>
      ) : null}
    </div>
  );
}

function FollowUpToggleButton({
  needsFollowUp,
  onToggle,
}: {
  readonly needsFollowUp: boolean;
  readonly onToggle: () => void;
}) {
  const tooltipLabel = needsFollowUp
    ? "Pending — click to clear"
    : "Needs Follow-Up";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-pressed={needsFollowUp}
          aria-label="Needs Follow-Up"
          aria-keyshortcuts="f"
          data-inbox-follow-up-toggle="true"
          onClick={onToggle}
          className={cn(
            "size-8 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:z-20",
            needsFollowUp &&
              "bg-rose-50 text-rose-800 hover:bg-rose-100 hover:text-rose-900",
          )}
        >
          <FlagIcon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltipLabel}</TooltipContent>
    </Tooltip>
  );
}

function useOptimisticBooleanToggle({
  scopeKey,
  value,
  perform,
}: {
  readonly scopeKey: string;
  readonly value: boolean;
  readonly perform: (nextValue: boolean) => Promise<UiResult<unknown>>;
}) {
  const router = useRouter();
  const serverValueRef = useRef(value);
  const optimisticValueRef = useRef(value);
  const desiredValueRef = useRef(value);
  const inFlightRef = useRef(false);
  const [committedValue, setCommittedValue] = useState(value);
  const [error, setError] = useState<UiError | null>(null);
  const [isPending, startTransition] = useTransition();
  const [optimisticValue, setOptimisticValue] = useOptimistic(
    committedValue,
    (_currentValue: boolean, nextValue: boolean) => nextValue,
  );

  useEffect(() => {
    serverValueRef.current = value;
    optimisticValueRef.current = value;
    desiredValueRef.current = value;
    inFlightRef.current = false;
    setCommittedValue(value);
    setError(null);
  }, [scopeKey, value]);

  const toggle = useCallback(() => {
    const nextValue = !optimisticValueRef.current;

    if (inFlightRef.current) {
      startTransition(() => {
        optimisticValueRef.current = nextValue;
        desiredValueRef.current = nextValue;
        setError(null);
        setOptimisticValue(nextValue);
      });
      return;
    }

    startTransition(async () => {
      optimisticValueRef.current = nextValue;
      desiredValueRef.current = nextValue;
      setError(null);
      setOptimisticValue(nextValue);
      inFlightRef.current = true;
      let hasCommittedUpdate = false;

      while (serverValueRef.current !== desiredValueRef.current) {
        const valueToPersist = desiredValueRef.current;
        const result = await perform(valueToPersist);

        if (!result.ok) {
          optimisticValueRef.current = serverValueRef.current;
          desiredValueRef.current = serverValueRef.current;
          setCommittedValue(serverValueRef.current);
          setOptimisticValue(serverValueRef.current);
          setError(result);
          inFlightRef.current = false;
          return;
        }

        hasCommittedUpdate = true;
        serverValueRef.current = valueToPersist;
        optimisticValueRef.current = valueToPersist;
        setCommittedValue(valueToPersist);
      }

      inFlightRef.current = false;

      if (hasCommittedUpdate) {
        // Re-render the RSC tree so the inbox list row reflects the new
        // value. Layout is `force-dynamic` (D-040), so this is a real
        // refetch, not a cache hit.
        router.refresh();
      }
    });
  }, [perform, router, setOptimisticValue]);

  return {
    value: optimisticValue,
    isPending,
    error,
    toggle,
  } as const;
}

function UnresolvedBanner() {
  return (
    <div
      className={`flex items-center gap-2 border-b border-amber-200 px-6 py-2.5 ${TONE_CLASSES.amber.subtle}`}
      role="status"
    >
      <AlertTriangleIcon className="size-4 shrink-0 text-amber-600" />
      <span className="text-sm font-medium text-amber-900">
        Unresolved items need attention
      </span>
    </div>
  );
}
