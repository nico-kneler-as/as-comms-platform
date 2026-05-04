import {
  FOCUS_RING,
  TONE_CLASSES,
  TYPE,
  type ToneNameV2,
} from "@/app/_lib/design-tokens-v2";
import { cn } from "@/lib/utils";

import type {
  MetricKey,
  ProjectLifecycleTile as ProjectLifecycleTileData,
} from "../_lib/project-lifecycle-metrics";
import { Sparkline7 } from "./sparkline-7";

export interface ProjectLifecycleTileProps {
  readonly tile: ProjectLifecycleTileData;
  readonly onOpenProject: (projectId: string) => void;
  readonly onOpenMetric: (projectId: string, metricKey: MetricKey) => void;
}

const METRIC_CONFIG: readonly {
  readonly key: MetricKey;
  readonly label: string;
  readonly valueClassName: string;
}[] = [
  { key: "signups", label: "Signups", valueClassName: "text-sky-700" },
  {
    key: "trainingCompletions",
    label: "Training",
    valueClassName: "text-emerald-700",
  },
  {
    key: "dataSubmissions",
    label: "Submissions",
    valueClassName: "text-amber-700",
  },
];

function readUnreadLabel(unreadCount: number): string {
  if (unreadCount === 0) {
    return "No unread";
  }

  return `${unreadCount.toString()} unread`;
}

function readToneClasses(tone: string) {
  if (tone in TONE_CLASSES) {
    return TONE_CLASSES[tone as ToneNameV2];
  }

  return TONE_CLASSES.slate;
}

export function ProjectLifecycleTile({
  tile,
  onOpenProject,
  onOpenMetric,
}: ProjectLifecycleTileProps) {
  const toneClasses = readToneClasses(tile.projectTone);

  return (
    <article className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <span
        aria-hidden="true"
        className={cn("absolute inset-y-0 left-0 w-1.5", toneClasses.bg)}
      />
      <div className="grid gap-4 pl-6 pr-5 py-5 lg:grid-cols-[minmax(0,220px)_1fr]">
        <button
          type="button"
          onClick={() => {
            onOpenProject(tile.projectId);
          }}
          className={cn(
            "flex min-w-0 flex-col items-start rounded-xl px-2 py-1 text-left transition-colors hover:bg-slate-50",
            FOCUS_RING,
          )}
        >
          <span className={cn(TYPE.headingMd, "truncate")}>{tile.projectName}</span>
          <span className={cn(TYPE.caption, "mt-1")}>
            {readUnreadLabel(tile.unreadCount)}
          </span>
        </button>

        <div className="grid gap-3 sm:grid-cols-3">
          {METRIC_CONFIG.map((metric) => (
            <button
              key={metric.key}
              type="button"
              onClick={() => {
                onOpenMetric(tile.projectId, metric.key);
              }}
              className={cn(
                "rounded-xl border border-slate-200 px-3 py-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50",
                FOCUS_RING,
              )}
            >
              <p className={TYPE.label}>{metric.label}</p>
              <div className="mt-2 flex items-baseline gap-2">
                <span className={cn("text-[28px] font-semibold tracking-tight", metric.valueClassName)}>
                  {tile.totals[metric.key].toString()}
                </span>
                <span className={TYPE.caption}>
                  +{tile.today[metric.key].toString()} today
                </span>
              </div>
              <div className="mt-3">
                <Sparkline7
                  values={tile.sparkline[metric.key]}
                  tone={tile.projectTone}
                  metricKey={metric.key}
                />
              </div>
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}
