"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import {
  clearInboxNeedsFollowUpAction,
  markInboxNeedsFollowUpAction,
  markInboxOpenedAction,
  markInboxUnreadAction,
  sendComposerAction,
} from "../actions";
import { plaintextToComposerHtml } from "@/src/lib/html-sanitizer";
import { fetchInboxTimelinePage } from "../_lib/client-api";
import type {
  InboxComposerReplyContext,
  InboxDetailViewModel,
  InboxTimelineEntryViewModel,
} from "../_lib/view-models";
import type { UiError, UiResult } from "@/src/server/ui-result";
import { InboxFreshnessPoller } from "./inbox-freshness-poller";
import { useInboxClient, type Reminder } from "./inbox-client-provider";
import { SectionLabel } from "@/components/ui/section-label";
import {
  LAYOUT,
  SPACING,
  TONE_CLASSES,
  TRANSITION,
  TYPE,
} from "@/app/_lib/design-tokens-v2";
import { InboxComposerReplyBar } from "./inbox-composer";
import {
  InboxContactRail,
  InboxProjectStatusBadge,
} from "./inbox-contact-rail";
import { TimelineSkeleton } from "./inbox-loading";
import { InboxTimeline } from "./inbox-timeline";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  FlagIcon,
  MailOpenIcon,
  PanelRightOpenIcon,
  XIcon,
} from "./icons";

interface DetailProps {
  readonly detail: InboxDetailViewModel;
  readonly currentOperatorUserId: string;
}

type ReminderUnit = "hours" | "days" | "weeks";

const REPLY_SUBJECT_PREFIX_PATTERN = /^\s*(?:(?:re|fwd?)\s*:\s*)+/i;

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
  readonly entry: InboxTimelineEntryViewModel;
  readonly defaultAlias: string | null;
}): InboxComposerReplyContext | null {
  if (input.entry.channel !== "email") {
    return null;
  }

  return {
    contactId: input.contactId,
    contactDisplayName: input.contactDisplayName,
    subject: buildReplySubject(input.entry.subject),
    threadCursor:
      input.entry.kind === "inbound-email" ? input.entry.id : null,
    threadId: input.entry.threadId,
    inReplyToRfc822:
      input.entry.kind === "inbound-email"
        ? input.entry.rfc822MessageId
        : input.entry.inReplyToRfc822,
    defaultAlias: input.defaultAlias,
  };
}

export function InboxDetail({ detail, currentOperatorUserId }: DetailProps) {
  const { contact } = detail;
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const activeTimelineRequestIdRef = useRef(0);
  const shouldScrollToLatestRef = useRef(true);
  const previousContactIdRef = useRef(detail.contact.contactId);
  const {
    reminders,
    setReminder,
    clearReminder,
    isTimelineLoading,
    setTimelineLoading,
    openReplyDraft,
    showToast,
  } = useInboxClient();

  const [railOpen, setRailOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderValue, setReminderValue] = useState("");
  const [reminderUnit, setReminderUnit] = useState<ReminderUnit>("hours");
  const [timelineEntries, setTimelineEntries] = useState(detail.timeline);
  const [timelinePage, setTimelinePage] = useState(detail.timelinePage);
  const [retryingEntryId, setRetryingEntryId] = useState<string | null>(null);
  const [isRetryPending, startRetryTransition] = useTransition();

  useEffect(() => {
    activeTimelineRequestIdRef.current += 1;
    setTimelineLoading(false);
    setTimelineEntries(detail.timeline);
    setTimelinePage(detail.timelinePage);

    if (previousContactIdRef.current !== detail.contact.contactId) {
      shouldScrollToLatestRef.current = true;
      previousContactIdRef.current = detail.contact.contactId;
    }
  }, [
    detail.contact.contactId,
    detail.freshness.inboxUpdatedAt,
    detail.freshness.timelineCount,
    detail.freshness.timelineUpdatedAt,
    detail.timeline,
    detail.timelinePage,
    setTimelineLoading,
  ]);

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
  }, [detail.contact.contactId, timelineEntries]);

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
  const markOpenedRef = useRef(false);

  // Flip bucket to "Opened" on first mount of a detail view whose server-
  // state is still "New". The ref prevents re-firing if the effect re-runs
  // (e.g., router.refresh swapping the detail prop). User-initiated
  // "Mark as unread" goes through `handleMarkUnread` below, which also
  // closes the detail, so we won't immediately re-mark as opened.
  useEffect(() => {
    if (markOpenedRef.current || detail.bucket !== "new") {
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
  }, [contact.contactId, detail.bucket, router]);

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

  const activeProject = contact.activeProjects[0] ?? null;
  const firstName = contact.displayName.split(" ")[0] ?? contact.displayName;
  const isFollowUp = followUpToggle.value;
  const existingReminder = reminders.get(contact.contactId) ?? null;
  const composerReplyContext = detail.composerReplyContext;
  const handleReply = useCallback(
    (entryId: string) => {
      const entry = timelineEntries.find((item) => item.id === entryId);

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
      openReplyDraft,
      timelineEntries,
    ],
  );

  const handleSetReminder = () => {
    const numeric = Number(reminderValue);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    setReminder(contact.contactId, buildReminder(numeric, reminderUnit));
    setReminderValue("");
    setReminderOpen(false);
  };

  const handleClearReminder = () => {
    clearReminder(contact.contactId);
    setReminderOpen(false);
  };

  const handleRetryPending = useCallback(
    (entryId: string) => {
      const entry = timelineEntries.find((item) => item.id === entryId);

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
        : null;

      if (pendingId === null) {
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
            supersedesPendingId: pendingId,
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
    [contact.contactId, contact.displayName, showToast, timelineEntries],
  );

  return (
    <div className="flex min-h-0 flex-1">
      <InboxFreshnessPoller
        contactId={contact.contactId}
        detailFreshness={detail.freshness}
      />

      <section className="flex min-w-0 flex-1 flex-col border-r border-slate-200 bg-white">
        <header
          className={`flex ${LAYOUT.headerHeight} items-center justify-between gap-4 border-b border-slate-200 px-6`}
        >
          <div className="flex min-w-0 items-center gap-4">
            <h1 className={`truncate ${TYPE.headingLg}`}>
              {contact.displayName}
            </h1>
            <div className="hidden h-5 w-px bg-slate-200 sm:block" />
            <div className="hidden min-w-0 flex-1 sm:block">
              {activeProject ? (
                <div className="flex min-w-0 items-center gap-2 text-xs">
                  <span className="min-w-0 truncate font-medium text-slate-700">
                    {activeProject.projectName} {activeProject.year.toString()}
                  </span>
                  <InboxProjectStatusBadge status={activeProject.status} />
                </div>
              ) : (
                <span className="text-xs text-slate-400">
                  No active project
                </span>
              )}
            </div>
            <div className="hidden items-center gap-1.5 sm:flex">
              {isFollowUp ? (
                <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-800">
                  Needs Follow-Up
                </span>
              ) : null}
              {contact.hasUnresolved ? (
                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                  Unresolved
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <FollowUpToggleControl
              needsFollowUp={isFollowUp}
              isPending={followUpToggle.isPending}
              error={followUpToggle.error}
              onToggle={followUpToggle.toggle}
            />

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isMarkUnreadPending}
              onClick={handleMarkUnread}
              aria-label="Mark as unread"
              className="gap-1.5"
              data-inbox-mark-unread="true"
            >
              <MailOpenIcon className="h-3.5 w-3.5" />
              Mark as unread
            </Button>

            <Popover open={reminderOpen} onOpenChange={setReminderOpen}>
              <PopoverTrigger asChild>
                {existingReminder ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100 hover:text-sky-800"
                  >
                    <ClockIcon className="h-3.5 w-3.5" />
                    Reminder · {formatShortReminder(existingReminder)}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Set a reminder"
                  >
                    <ClockIcon className="h-4 w-4" />
                  </Button>
                )}
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72">
                <ReminderPopoverBody
                  existing={existingReminder}
                  value={reminderValue}
                  unit={reminderUnit}
                  onChangeValue={setReminderValue}
                  onChangeUnit={setReminderUnit}
                  onClose={() => {
                    setReminderOpen(false);
                  }}
                  onSet={handleSetReminder}
                  onClear={handleClearReminder}
                />
              </PopoverContent>
            </Popover>

            {!railOpen ? (
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label="Expand contact details"
                aria-expanded={false}
                aria-controls="inbox-contact-rail"
                onClick={() => {
                  setRailOpen(true);
                }}
              >
                <PanelRightOpenIcon className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </header>

        {contact.hasUnresolved ? <UnresolvedBanner /> : null}

        <div
          ref={timelineScrollRef}
          className={`min-h-0 flex-1 overflow-y-auto ${TONE_CLASSES.slate.subtle} ${SPACING.container}`}
        >
          {isTimelineLoading && timelineEntries.length === 0 ? (
            <TimelineSkeleton />
          ) : (
            <InboxTimeline
              entries={timelineEntries}
              volunteerFirstName={firstName}
              currentOperatorUserId={currentOperatorUserId}
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

        <div className="shrink-0">
          {composerReplyContext ? (
            <InboxComposerReplyBar
              contactDisplayName={contact.displayName}
              onReply={() => {
                openReplyDraft(composerReplyContext);
              }}
            />
          ) : null}
        </div>
      </section>

      <div
        className={cn(
          `overflow-hidden border-l ${TRANSITION.layout} ${TRANSITION.reduceMotion}`,
          railOpen
            ? `${LAYOUT.railWidth} border-slate-200 opacity-100`
            : "w-0 border-transparent opacity-0",
        )}
      >
        <div className={LAYOUT.railWidth}>
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

function FollowUpToggleControl({
  needsFollowUp,
  isPending,
  error,
  onToggle,
}: {
  readonly needsFollowUp: boolean;
  readonly isPending: boolean;
  readonly error: UiError | null;
  readonly onToggle: () => void;
}) {
  return (
    <div className="relative">
      <FollowUpToggleButton
        needsFollowUp={needsFollowUp}
        pending={isPending}
        onToggle={onToggle}
      />

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
  pending,
  onToggle,
}: {
  readonly needsFollowUp: boolean;
  readonly pending: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      aria-pressed={needsFollowUp}
      aria-keyshortcuts="f"
      data-inbox-follow-up-toggle="true"
      onClick={onToggle}
      className={cn(
        "gap-1.5",
        needsFollowUp &&
          "border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100 hover:text-rose-800",
      )}
    >
      <FlagIcon className="h-3.5 w-3.5" />
      Needs Follow-Up
    </Button>
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
  const [committedValue, setCommittedValue] = useState(value);
  const [error, setError] = useState<UiError | null>(null);
  const [isPending, startTransition] = useTransition();
  const [optimisticValue, setOptimisticValue] = useOptimistic(
    committedValue,
    (_currentValue: boolean, nextValue: boolean) => nextValue,
  );

  useEffect(() => {
    serverValueRef.current = value;
    setCommittedValue(value);
    setError(null);
  }, [scopeKey, value]);

  const toggle = useCallback(() => {
    const nextValue = !optimisticValue;

    startTransition(async () => {
      setError(null);
      setOptimisticValue(nextValue);
      const result = await perform(nextValue);

      if (result.ok) {
        serverValueRef.current = nextValue;
        setCommittedValue(nextValue);
        // Re-render the RSC tree so the inbox list row reflects the new
        // value. Layout is `force-dynamic` (D-040), so this is a real
        // refetch, not a cache hit.
        router.refresh();
        return;
      }

      setCommittedValue(serverValueRef.current);
      setError(result);
    });
  }, [optimisticValue, perform, router, setOptimisticValue]);

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
      <AlertTriangleIcon className="h-4 w-4 shrink-0 text-amber-600" />
      <span className="text-sm font-medium text-amber-900">
        Unresolved items need attention
      </span>
    </div>
  );
}

interface ReminderPopoverBodyProps {
  readonly existing: Reminder | null;
  readonly value: string;
  readonly unit: ReminderUnit;
  readonly onChangeValue: (value: string) => void;
  readonly onChangeUnit: (unit: ReminderUnit) => void;
  readonly onClose: () => void;
  readonly onSet: () => void;
  readonly onClear: () => void;
}

const REMINDER_UNITS: readonly ReminderUnit[] = ["hours", "days", "weeks"];

function ReminderPopoverBody({
  existing,
  value,
  unit,
  onChangeValue,
  onChangeUnit,
  onClose,
  onSet,
  onClear,
}: ReminderPopoverBodyProps) {
  const numeric = Number(value);
  const canSet = value.length > 0 && Number.isFinite(numeric) && numeric > 0;
  const preview = canSet ? previewForDelta(numeric, unit) : null;

  if (existing) {
    return (
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <SectionLabel as="p">Reminder set</SectionLabel>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {formatLongReminder(existing)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            In {formatShortReminder(existing)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-slate-400 hover:text-slate-700"
          aria-label="Cancel reminder"
          onClick={onClear}
        >
          <XIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <SectionLabel as="p">Remind me in</SectionLabel>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex h-9 w-16 items-center overflow-hidden rounded-md border border-slate-200 shadow-sm">
          <span
            className="flex-1 select-none text-center text-sm font-semibold tabular-nums text-slate-900"
            aria-live="polite"
          >
            {value || "0"}
          </span>
          <div className="flex flex-col border-l border-slate-200">
            <button
              type="button"
              aria-label="Increase"
              onClick={() => {
                const nextValue = Math.min(99, (Number(value) || 0) + 1);
                onChangeValue(nextValue.toString());
              }}
              className="flex h-[18px] w-6 items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <ChevronUpIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Decrease"
              onClick={() => {
                const nextValue = Math.max(0, (Number(value) || 0) - 1);
                onChangeValue(nextValue.toString());
              }}
              className="flex h-[18px] w-6 items-center justify-center border-t border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <ChevronDownIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex flex-1 items-center gap-1 rounded-lg bg-slate-100 p-0.5 text-[11px] font-medium">
          {REMINDER_UNITS.map((option) => {
            const isActive = option === unit;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  onChangeUnit(option);
                }}
                className={cn(
                  "flex-1 rounded-md px-1.5 py-1 capitalize transition-colors duration-150",
                  isActive
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-900",
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>
      <p
        className={cn(
          "mt-2 min-h-4 text-[11px]",
          preview ? "text-slate-500" : "text-transparent",
        )}
        aria-live="polite"
      >
        {preview ?? "—"}
      </p>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canSet} onClick={onSet}>
          Set reminder
        </Button>
      </div>
    </>
  );
}

function buildReminder(value: number, unit: ReminderUnit): Reminder {
  const ms = value * millisPerUnit(unit);
  const firesAt = new Date(Date.now() + ms).toISOString();
  return { value, unit, firesAt };
}

function millisPerUnit(unit: ReminderUnit): number {
  switch (unit) {
    case "hours":
      return 60 * 60 * 1000;
    case "days":
      return 24 * 60 * 60 * 1000;
    case "weeks":
      return 7 * 24 * 60 * 60 * 1000;
  }
}

function previewForDelta(value: number, unit: ReminderUnit): string {
  const ms = value * millisPerUnit(unit);
  const target = new Date(Date.now() + ms);
  return formatAbsolute(target);
}

function formatShortReminder(reminder: Reminder): string {
  const unitLabel =
    reminder.value === 1 ? reminder.unit.slice(0, -1) : reminder.unit;
  return `${reminder.value.toString()} ${unitLabel}`;
}

function formatLongReminder(reminder: Reminder): string {
  return formatAbsolute(new Date(reminder.firesAt));
}

function formatAbsolute(target: Date): string {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfTarget = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
  ).getTime();
  const dayDelta = Math.round(
    (startOfTarget - startOfToday) / (24 * 60 * 60 * 1000),
  );

  const time = formatTime(target);

  if (dayDelta === 0) return `Today at ${time}`;
  if (dayDelta === 1) return `Tomorrow at ${time}`;
  if (dayDelta > 1 && dayDelta < 7) {
    return `${weekdayName(target.getDay())} at ${time}`;
  }
  return `${monthName(target.getMonth())} ${target.getDate().toString()} at ${time}`;
}

function formatTime(target: Date): string {
  const hours24 = target.getHours();
  const minutes = target.getMinutes();
  const ampm = hours24 >= 12 ? "pm" : "am";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  if (minutes === 0) return `${hours12.toString()} ${ampm}`;
  const padded = minutes < 10 ? `0${minutes.toString()}` : minutes.toString();
  return `${hours12.toString()}:${padded} ${ampm}`;
}

function weekdayName(day: number): string {
  return (
    [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ][day] ?? "Unknown"
  );
}

function monthName(month: number): string {
  return (
    [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ][month] ?? "Unknown"
  );
}
