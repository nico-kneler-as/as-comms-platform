export type StatusTone = "ok" | "warn" | "fail";

export interface StatusCard {
  readonly title: string;
  readonly status: StatusTone;
  readonly description: string;
}

const toneClasses: Record<StatusTone, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-950",
  warn: "border-amber-200 bg-amber-50 text-amber-950",
  fail: "border-rose-200 bg-rose-50 text-rose-950"
};

const pillClasses: Record<StatusTone, string> = {
  ok: "bg-emerald-600/10 text-emerald-700",
  warn: "bg-amber-600/10 text-amber-700",
  fail: "bg-rose-600/10 text-rose-700"
};

export interface StatusGridProps {
  readonly items: readonly StatusCard[];
}

export function StatusGrid({ items }: StatusGridProps) {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      {items.map((item) => (
        <article
          key={item.title}
          className={`rounded-3xl border p-6 shadow-sm ${toneClasses[item.status]}`}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{item.title}</h2>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${pillClasses[item.status]}`}
            >
              {item.status}
            </span>
          </div>
          <p className="text-sm leading-6 opacity-90">{item.description}</p>
        </article>
      ))}
    </section>
  );
}
