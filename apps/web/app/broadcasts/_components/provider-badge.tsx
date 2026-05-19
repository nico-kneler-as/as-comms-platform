import { cn } from "@/lib/utils";

const PROVIDER_CLASSES = {
  postmark: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200/80",
  mailchimp: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200/80",
} as const;

export function ProviderBadge({
  provider,
  className,
}: {
  readonly provider: "postmark" | "mailchimp";
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]",
        PROVIDER_CLASSES[provider],
        className,
      )}
    >
      {provider}
    </span>
  );
}
