import { signIn } from "../../../src/server/auth";

// The sign-in page is the one /auth route reachable without a session. It
// MUST stay outside the middleware matcher (see apps/web/middleware.ts).
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in — AS Comms"
};

async function signInWithGoogle(): Promise<void> {
  "use server";
  await signIn("google", { redirectTo: "/inbox" });
}

export default function SignInPage() {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-slate-50 p-6">
      <section className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <header className="mb-6 flex flex-col gap-1 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Adventure Scientists
          </h1>
          <p className="text-sm text-slate-500">
            Sign in to the volunteer comms platform.
          </p>
        </header>
        <form action={signInWithGoogle} className="flex flex-col gap-3">
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            Continue with Google
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-400">
          Access is restricted to authorized operators.
        </p>
      </section>
    </main>
  );
}
