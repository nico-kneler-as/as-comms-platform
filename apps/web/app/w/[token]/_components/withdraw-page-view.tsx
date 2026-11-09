import { AdventureScientistsLogo } from "@/app/_components/adventure-scientists-logo";

import type { WithdrawPageModel } from "../_lib/withdraw";

export function WithdrawPageView({ model }: { readonly model: WithdrawPageModel }) {
  const isInvalid = model.state === "invalid";
  const isDone = model.state === "done";
  const headline = isInvalid
    ? "This link isn't valid anymore."
    : isDone
      ? `You've withdrawn from ${model.projectName}.`
      : `Withdraw from ${model.projectName}?`;
  const body = isInvalid
    ? "To withdraw from a project, reply to any email from the project team or write to info@adventurescientists.org."
    : isDone
      ? `Thanks for letting us know. The project team will see this, and you won't get more emails about ${model.projectName}.`
      : `This lets the ${model.projectName} team know you're no longer taking part, and stops emails about this project. Your Adventure Scientists newsletter subscription isn't affected.`;

  return (
    <main className="min-h-dvh bg-[linear-gradient(180deg,#f8fafc_0%,#eef4ef_100%)] px-4 py-10 text-slate-900 sm:px-6">
      <section className="mx-auto w-full max-w-2xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        <div className="border-b border-slate-200/80 px-6 py-5 sm:px-8">
          <AdventureScientistsLogo className="h-8 w-32" />
        </div>
        <div className="space-y-6 px-6 py-8 sm:px-8 sm:py-10">
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{headline}</h1>
            <p className="max-w-xl text-sm leading-7 text-slate-700">{body}</p>
          </div>
          {model.state === "confirm" ? (
            <>
              <form action={`/w/${encodeURIComponent(model.token)}/confirm`} method="post">
                <button type="submit" className="inline-flex items-center justify-center rounded-full bg-[#253746] px-5 py-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#1c2933] focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2">
                  Yes, withdraw me
                </button>
              </form>
              <p className="text-sm text-slate-600">Changed your mind? Just close this page.</p>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
