import { DEFAULT_SMS_OPT_OUT_FOOTER } from "@as-comms/domain/sms-segments";

// Match the exact footer the renderer appends (see sms-broadcast-render.ts) so we
// strip it off the sample body and re-render it once — not duplicate it.
const SMS_OPTOUT_FOOTER = DEFAULT_SMS_OPT_OUT_FOOTER;

function splitSmsSampleBody(sampleBody: string | null) {
  const trimmed = sampleBody?.trim() ?? "";
  if (trimmed.length === 0) {
    return {
      body: null,
      footer: SMS_OPTOUT_FOOTER,
    };
  }

  if (trimmed.endsWith(SMS_OPTOUT_FOOTER)) {
    const withoutFooter = trimmed
      .slice(0, Math.max(trimmed.length - SMS_OPTOUT_FOOTER.length, 0))
      .trimEnd();

    return {
      body: withoutFooter.length > 0 ? withoutFooter : null,
      footer: SMS_OPTOUT_FOOTER,
    };
  }

  return {
    body: trimmed,
    footer: SMS_OPTOUT_FOOTER,
  };
}

export function SmsSampleBubble({
  sampleBody,
  emptyBodyFallback,
}: {
  readonly sampleBody: string | null;
  readonly emptyBodyFallback: string;
}) {
  const { body, footer } = splitSmsSampleBody(sampleBody);

  return (
    <div className="mx-auto max-w-xl rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-5">
      <div className="max-w-[88%] rounded-[24px] rounded-bl-md bg-slate-100 px-4 py-3 text-[13px] leading-relaxed text-slate-900 shadow-sm">
        <p className="whitespace-pre-wrap">{body ?? emptyBodyFallback}</p>
        <p className="mt-2 text-[12px] text-slate-500">{footer}</p>
      </div>
    </div>
  );
}
