import { TONE_CLASSES, type ToneNameV2 } from "@/app/_lib/design-tokens-v2";

type MetricKey = "signups" | "trainingCompletions" | "dataSubmissions";

export interface Sparkline7Props {
  readonly values: readonly number[];
  readonly tone: string;
  readonly metricKey: MetricKey;
}

const METRIC_BAR_CLASS: Record<MetricKey, string> = {
  signups: "fill-sky-500",
  trainingCompletions: "fill-emerald-500",
  dataSubmissions: "fill-amber-500",
};

function readToneClasses(tone: string) {
  if (tone in TONE_CLASSES) {
    return TONE_CLASSES[tone as ToneNameV2];
  }

  return TONE_CLASSES.slate;
}

export function Sparkline7({
  values,
  tone,
  metricKey,
}: Sparkline7Props) {
  const toneClasses = readToneClasses(tone);
  const points = values.slice(0, 7);
  const max = Math.max(0, ...points);

  return (
    <svg
      viewBox="0 0 70 20"
      aria-hidden="true"
      className="h-5 w-full"
      preserveAspectRatio="none"
    >
      <line
        x1="0"
        y1="19"
        x2="70"
        y2="19"
        className={toneClasses.dot}
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="1"
      />
      {points.map((value, index) => {
        const normalizedHeight = max === 0 ? 1.5 : Math.max(1.5, (value / max) * 15);
        const x = index * 10 + 1;
        const y = 19 - normalizedHeight;
        const isToday = index === 6;

        return (
          <rect
            key={`${metricKey}-${index.toString()}`}
            x={x}
            y={y}
            width="6"
            height={normalizedHeight}
            rx="1.5"
            className={METRIC_BAR_CLASS[metricKey]}
            fillOpacity={isToday ? 0.95 : 0.38}
          />
        );
      })}
    </svg>
  );
}
