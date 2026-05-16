import { Progress } from "@/components/ui/progress";

import type { RunDetailModel } from "../_lib/run-detail";
import { LocalDateTime } from "./local-date-time";

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
    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {model.metrics.map((metric) => (
          <article
            key={metric.key}
            className="rounded-3xl border border-slate-200 bg-slate-50 p-4"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {metric.label}
            </div>
            <div className="mt-4 flex items-end justify-between gap-3">
              <div className="text-3xl font-semibold tabular-nums text-slate-900">
                {metric.value.toLocaleString()}
              </div>
              <div className="text-sm font-medium tabular-nums text-slate-500">
                {metric.percentage.toFixed(1)}%
              </div>
            </div>
            <div className="mt-2 text-sm text-slate-500">
              {metric.subtitle ??
                `${metric.value.toLocaleString()} of ${model.totalAudience.toLocaleString()}`}
            </div>
          </article>
        ))}
      </div>

      {model.run.state === "sending" ? (
        <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50/70 p-5">
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
        <p className="mt-6 text-sm text-slate-600">
          Per-recipient delivery and engagement appear here. Run finalizes after
          30-day events tail.
        </p>
      ) : null}
    </section>
  );
}
