"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";

import { FOCUS_RING, RADIUS, SHADOW, TRANSITION, TYPE } from "@/app/_lib/design-tokens-v2";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type {
  LogsSettingsViewModel,
  LogStreamDescriptorViewModel,
  SourceEvidenceCollisionDetailViewModel
} from "@/src/server/settings/selectors";

import { SettingsSection } from "./settings-section";

const EXACT_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short"
});

function formatTimestamp(timestamp: string): string {
  return EXACT_TIMESTAMP_FORMATTER.format(new Date(timestamp));
}

function toStreamHref(streamId: string, beforeTimestamp?: string | null): string {
  const params = new URLSearchParams();
  params.set("stream", streamId);

  if (beforeTimestamp !== null && beforeTimestamp !== undefined) {
    params.set("before", beforeTimestamp);
  }

  return `/settings/logs?${params.toString()}`;
}

function isSourceEvidenceCollisionDetail(
  value: Readonly<Record<string, unknown>>
): value is SourceEvidenceCollisionDetailViewModel {
  return (
    typeof value.provider === "string" &&
    typeof value.idempotencyKey === "string" &&
    typeof value.winning === "object" &&
    value.winning !== null &&
    Array.isArray(value.losing)
  );
}

function formatCollisionLine(input: {
  readonly recordId: string;
  readonly checksum: string;
  readonly timestamp: string;
}): string {
  return `${input.recordId} • ${input.checksum} • ${formatTimestamp(input.timestamp)}`;
}

function StreamSelector({
  activeStream,
  streams,
  onChange
}: {
  readonly activeStream: LogStreamDescriptorViewModel;
  readonly streams: readonly LogStreamDescriptorViewModel[];
  readonly onChange: (streamId: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-h-11 w-full items-center justify-between gap-3 border border-slate-200 bg-white px-3 py-2 text-left",
            RADIUS.md,
            SHADOW.sm,
            TRANSITION.fast,
            TRANSITION.reduceMotion,
            FOCUS_RING,
            "hover:border-slate-300"
          )}
          aria-label="Select log stream"
        >
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-slate-900">
              {activeStream.label}
            </span>
            <span className={cn("mt-0.5 block truncate", TYPE.caption)}>
              {activeStream.description}
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[20rem] rounded-xl p-2"
      >
        <DropdownMenuLabel className="px-2 pb-2 pt-1 text-[11px] font-semibold text-slate-500">
          Log stream
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={activeStream.id}
          onValueChange={(nextValue) => {
            onChange(nextValue);
          }}
        >
          {streams.map((stream) => (
            <DropdownMenuRadioItem
              key={stream.id}
              value={stream.id}
              className="rounded-lg"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-slate-900">
                  {stream.label}
                </span>
                <span className={cn("truncate", TYPE.caption)}>
                  {stream.description}
                </span>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DetailPanel({
  detail
}: {
  readonly detail: Readonly<Record<string, unknown>>;
}) {
  if (!isSourceEvidenceCollisionDetail(detail)) {
    return (
      <div className={cn(TYPE.caption, "text-slate-500")}>
        Detail unavailable.
      </div>
    );
  }

  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className={TYPE.label}>Provider</dt>
      <dd className={cn(TYPE.bodySm, "text-slate-700")}>{detail.provider}</dd>

      <dt className={TYPE.label}>Idempotency key</dt>
      <dd className={cn(TYPE.bodySm, "break-all text-slate-700")}>
        {detail.idempotencyKey}
      </dd>

      <dt className={TYPE.label}>Winning source-evidence</dt>
      <dd className={cn(TYPE.bodySm, "break-all text-slate-700")}>
        {formatCollisionLine({
          recordId: detail.winning.sourceEvidenceId,
          checksum: detail.winning.checksum,
          timestamp: detail.winning.receivedAt,
        })}
      </dd>

      <dt className={TYPE.label}>Losing quarantine rows</dt>
      <dd className={cn("space-y-1", TYPE.bodySm, "text-slate-700")}>
        {detail.losing.map((entry) => (
          <div key={entry.quarantineId}>
            {formatCollisionLine({
              recordId: entry.quarantineId,
              checksum: entry.checksum,
              timestamp: entry.attemptedAt,
            })}
          </div>
        ))}
      </dd>
    </dl>
  );
}

export function LogsPage({
  viewModel
}: {
  readonly viewModel: LogsSettingsViewModel;
}) {
  const router = useRouter();
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const streamsById = new Map(viewModel.streams.map((stream) => [stream.id, stream]));
  const activeStream =
    streamsById.get(viewModel.activeStreamId) ??
    viewModel.streams[0];

  if (activeStream === undefined) {
    return null;
  }

  return (
    <SettingsSection
      id="logs"
      title="Logs"
      description="Operational signals from ingestion and sync."
    >
      <div className="flex flex-col gap-4">
        <StreamSelector
          activeStream={activeStream}
          streams={viewModel.streams}
          onChange={(streamId) => {
            router.replace(toStreamHref(streamId), { scroll: false });
          }}
        />

        <div
          className={cn(
            "overflow-hidden border border-slate-200 bg-white",
            RADIUS.lg,
            SHADOW.sm
          )}
        >
          {viewModel.entries.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className={TYPE.caption}>No log entries.</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50/80">
                <tr>
                  <th
                    scope="col"
                    className={cn("px-5 py-3 text-left", TYPE.label)}
                  >
                    Timestamp
                  </th>
                  <th
                    scope="col"
                    className={cn("px-5 py-3 text-left", TYPE.label)}
                  >
                    Stream
                  </th>
                  <th
                    scope="col"
                    className={cn("px-5 py-3 text-left", TYPE.label)}
                  >
                    Summary
                  </th>
                  <th
                    scope="col"
                    className={cn("w-28 px-5 py-3 text-left", TYPE.label)}
                  >
                    Detail
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {viewModel.entries.map((entry) => {
                  const expanded = expandedEntryId === entry.id;
                  const streamLabel =
                    streamsById.get(entry.streamId)?.label ?? entry.streamId;

                  return (
                    <Fragment key={entry.id}>
                      <tr
                        className={cn(
                          "cursor-pointer align-top",
                          TRANSITION.fast,
                          "hover:bg-slate-50/80"
                        )}
                        onClick={() => {
                          setExpandedEntryId((current) =>
                            current === entry.id ? null : entry.id
                          );
                        }}
                      >
                        <td className="px-5 py-3 align-top">
                          <div className={cn(TYPE.caption, "tabular-nums text-slate-600")}>
                            {formatTimestamp(entry.timestamp)}
                          </div>
                        </td>
                        <td className="px-5 py-3 align-top">
                          <span className={cn(TYPE.bodySm, "text-slate-700")}>
                            {streamLabel}
                          </span>
                        </td>
                        <td className="px-5 py-3 align-top">
                          <p className={cn(TYPE.bodySm, "text-slate-900")}>
                            {entry.summary}
                          </p>
                        </td>
                        <td className="px-5 py-3 align-top">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={`${entry.id}-detail`}
                            className={cn(
                              "inline-flex items-center gap-1.5 text-sm font-medium text-slate-600",
                              TRANSITION.fast,
                              "hover:text-slate-900",
                              FOCUS_RING,
                              RADIUS.sm
                            )}
                            onClick={(event) => {
                              event.stopPropagation();
                              setExpandedEntryId((current) =>
                                current === entry.id ? null : entry.id
                              );
                            }}
                          >
                            {expanded ? (
                              <ChevronDown className="size-4" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="size-4" aria-hidden="true" />
                            )}
                            {expanded ? "Hide" : "Show"}
                          </button>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr id={`${entry.id}-detail`}>
                          <td
                            colSpan={4}
                            className="bg-slate-50/70 px-5 py-4"
                          >
                            <DetailPanel detail={entry.detail} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {viewModel.nextBeforeTimestamp !== null ? (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                router.replace(
                  toStreamHref(
                    viewModel.activeStreamId,
                    viewModel.nextBeforeTimestamp
                  ),
                  { scroll: false }
                );
              }}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}
