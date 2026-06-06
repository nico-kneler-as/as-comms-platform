import {
  AlertCircle,
  ArrowDownLeft,
  CheckCheck,
  CornerUpLeft,
  Eye,
  Flag,
  MousePointerClick,
  Users,
  type LucideIcon,
} from "lucide-react";

import {
  TONE_CLASSES,
  type ToneNameV2,
} from "@/app/_lib/design-tokens-v2";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import type { RunDetailModel, RunMetricTileData } from "../_lib/run-detail";
import { LocalDateTime } from "./local-date-time";

const METRIC_META: Record<
  RunMetricTileData["key"],
  { readonly Icon: LucideIcon; readonly tone: ToneNameV2 }
> = {
  queued: { Icon: Users, tone: "slate" },
  sent: { Icon: CheckCheck, tone: "emerald" },
  delivered: { Icon: CheckCheck, tone: "emerald" },
  opened: { Icon: Eye, tone: "sky" },
  clicked: { Icon: MousePointerClick, tone: "indigo" },
  replied: { Icon: CornerUpLeft, tone: "emerald" },
  bounced: { Icon: AlertCircle, tone: "rose" },
  unsubscribed: { Icon: ArrowDownLeft, tone: "amber" },
  complained: { Icon: Flag, tone: "rose" },
};

export function MetricTiles({
  model,
}: {
  readonly model: Pick<
    RunDetailModel,
    | "metrics"
    | "run"
    | "progressPercent"
    | "sentCount"
    | "totalAudience"
    | "estimatedMinutesRemaining"
  >;
}) {
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {model.metrics.map((metric) => {
          const meta = METRIC_META[metric.key];
          const tone = TONE_CLASSES[meta.tone];
          const Icon = meta.Icon;
          const pct = Math.max(0, Math.min(100, metric.percentage));

          return (
            <article
              key={metric.key}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md",
                    tone.subtle,
                    tone.subtleText,
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                </span>
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
                  {metric.label}
                </span>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="font-mono text-[24px] font-semibold leading-none tabular-nums text-slate-900">
                  {metric.value.toLocaleString()}
                </span>
                <span className={cn("text-[11.5px] tabular-nums", tone.subtleText)}>
                  {metric.percentage.toFixed(1)}%
                </span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-200",
                    tone.bg,
                  )}
                  style={{ width: `${String(Math.max(2, pct))}%` }}
                />
              </div>
            </article>
          );
        })}
      </div>

      {model.run.state === "sending" ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex items-center justify-between gap-3 text-[12.5px]">
            <span className="font-medium text-slate-900">
              {model.sentCount.toLocaleString()} of{" "}
              {model.totalAudience.toLocaleString()} sent
            </span>
            <span className="tabular-nums text-slate-600">
              {model.progressPercent}%
            </span>
          </div>
          <Progress
            value={model.progressPercent}
            className="mt-3 bg-amber-100 [&>div]:bg-amber-500"
          />
          {model.run.startedAt !== null ? (
            <div className="mt-3 text-[12.5px] text-slate-600">
              Started <LocalDateTime iso={model.run.startedAt} />
              {model.estimatedMinutesRemaining === null
                ? null
                : ` · ~${String(model.estimatedMinutesRemaining)} min remaining`}
            </div>
          ) : null}
        </div>
      ) : null}

      {model.run.state === "complete" ? (
        <p className="px-1 text-[12.5px] text-slate-600">
          Per-recipient delivery and engagement appear here. Run finalizes after
          30-day events tail.
        </p>
      ) : null}
    </section>
  );
}
