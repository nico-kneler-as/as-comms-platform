import type { ReactNode } from "react";

export interface AppShellProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}

export function AppShell({
  eyebrow,
  title,
  description,
  children
}: AppShellProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-14 sm:px-10">
      <header className="space-y-4">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-sky-700">
          {eyebrow}
        </p>
        <div className="max-w-3xl space-y-4">
          <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
            {title}
          </h1>
          <p className="text-base leading-7 text-slate-700 sm:text-lg">{description}</p>
        </div>
      </header>
      {children}
    </main>
  );
}
