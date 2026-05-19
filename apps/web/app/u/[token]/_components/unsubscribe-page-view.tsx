import { AdventureScientistsLogo } from "@/app/_components/adventure-scientists-logo";

import type { UnsubscribePageModel } from "../_lib/unsubscribe";

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-8 w-8"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" className="fill-current/10" />
      <path d="M8 12.5l2.5 2.5L16.5 9" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-8 w-8"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.5" y="6" width="17" height="12" rx="2" className="fill-current/10" />
      <path d="M4 7.5l8 5.5 8-5.5" />
    </svg>
  );
}

export function UnsubscribePageView({
  model,
}: {
  readonly model: UnsubscribePageModel;
}) {
  return (
    <main className="min-h-dvh bg-[linear-gradient(180deg,#f8fafc_0%,#eef4ef_100%)] px-4 py-10 text-slate-900 sm:px-6">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        {model.state === "success" && model.showAllCta ? (
          <a
            href="#unsubscribe-all"
            className="sr-only rounded-md bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm focus:not-sr-only focus:self-start focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            Skip to unsubscribe from all emails
          </a>
        ) : null}

        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
          <div className="border-b border-slate-200/80 px-6 py-5 sm:px-8">
            <AdventureScientistsLogo className="h-8 w-32" />
          </div>

          <div className="space-y-6 px-6 py-8 sm:px-8 sm:py-10">
            {model.state === "pending" ? (
              <div className="flex items-center gap-3 text-slate-700">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                  <MailIcon />
                </div>
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-700/80">
                  Confirm your choice
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-emerald-700">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
                  <CheckIcon />
                </div>
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700/80">
                  {model.state === "success"
                    ? "Email preferences updated"
                    : "Link not found"}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
                {model.headline}
              </h1>
              <p className="max-w-xl text-sm leading-7 text-slate-700">
                {model.body}
              </p>
            </div>

            {model.email !== null ? (
              <div className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">
                {model.email}
              </div>
            ) : null}

            {model.state === "pending" ? (
              <form action={`/u/${encodeURIComponent(model.token)}/confirm`} method="post">
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-full bg-[#253746] px-5 py-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#1c2933] focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
                >
                  Confirm unsubscribe
                </button>
              </form>
            ) : null}

            {model.state === "success" ? (
              <>
                <div className="h-px bg-slate-200" />

                {model.showAllBanner ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-medium leading-6 text-emerald-800">
                    {model.variant === "project"
                      ? "Got it. You're now unsubscribed from every Adventure Scientists campaign, across every project and the newsletter."
                      : "Got it. You're now unsubscribed from every Adventure Scientists campaign."}
                  </div>
                ) : null}

                {model.showAllCta && model.ctaPrompt !== null && model.ctaLabel !== null ? (
                  <div id="unsubscribe-all" className="space-y-4">
                    <p className="text-sm leading-7 text-slate-700">
                      {model.ctaPrompt}
                    </p>
                    <form action={`/u/${encodeURIComponent(model.token)}/all`} method="post">
                      <button
                        type="submit"
                        className="inline-flex items-center justify-center rounded-full bg-[#253746] px-5 py-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#1c2933] focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
                      >
                        {model.ctaLabel}
                      </button>
                    </form>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <footer className="border-t border-slate-200/80 bg-slate-50 px-6 py-5 text-sm text-slate-600 sm:px-8">
            <div className="space-y-1">
              {model.footerAddress !== null ? <p>{model.footerAddress}</p> : null}
              <p>
                Did this happen by mistake?{" "}
                <a
                  href="mailto:info@adventurescientists.org"
                  className="font-medium text-slate-900 underline underline-offset-2"
                >
                  Contact us
                </a>
                .
              </p>
            </div>
          </footer>
        </section>
      </div>
    </main>
  );
}
