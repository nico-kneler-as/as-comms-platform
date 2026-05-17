import { Progress } from "@/components/ui/progress";

import type { RunDetailModel } from "../_lib/run-detail";
import { LocalDateTime } from "./local-date-time";

const METRIC_DOT_CLASS: Record<string, string> = {
  queued: "bg-slate-400",
  sent: "bg-emerald-500",
  delivered: "bg-emerald-500",
  opened: "bg-sky-500",
  clicked: "bg-indigo-500",
  replied: "bg-violet-500",
  bounced: "bg-rose-500",
  unsubscribed: "bg-amber-500",
  complained: "bg-rose-500",
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
    <section className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
          {model.metrics.map((metric) => (
            <article
              key={metric.key}
              className="min-w-0 border-b border-slate-200 px-4 py-3 md:border-r xl:border-b-0"
            >
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                <span
                  className={`size-1.5 rounded-full ${
                    METRIC_DOT_CLASS[metric.key] ?? "bg-slate-300"
                  }`}
                  aria-hidden="true"
                />
                {metric.label}
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <div className="text-xl font-semibold tabular-nums text-slate-900">
                  {metric.value.toLocaleString()}
                </div>
                <div className="text-xs font-medium tabular-nums text-slate-500">
                  {metric.percentage.toFixed(1)}%
                </div>
              </div>
              <div className="mt-1 truncate text-xs text-slate-500">
                {metric.subtitle ??
                  `${metric.value.toLocaleString()} of ${model.totalAudience.toLocaleString()}`}
              </div>
            </article>
          ))}
        </div>
      </div>

      {model.run.state === "sending" ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-5">
          <div className="flex items-center justify-between gap-3 text-sm">
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
            <div className="mt-3 text-sm text-slate-600">
              Started <LocalDateTime iso={model.run.startedAt} />
              {model.estimatedMinutesRemaining === null
                ? null
                : ` · ~${String(model.estimatedMinutesRemaining)} min remaining`}
            </div>
          ) : null}
        </div>
      ) : null}

      {model.run.state === "complete" ? (
        <p className="px-1 text-sm text-slate-600">
          Per-recipient delivery and engagement appear here. Run finalizes after
          30-day events tail.
        </p>
      ) : null}
    </section>
  );
}
