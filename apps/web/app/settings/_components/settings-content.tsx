import type { ReactNode } from "react";

interface SettingsContentProps {
  readonly children: ReactNode;
}

/**
 * Column 3 shell. A padded scroll container — page titles live inside each
 * section (on the grey surface) so the shell stays unopinionated.
 */
export function SettingsContent({ children }: SettingsContentProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="w-full max-w-[800px]">{children}</div>
      </div>
    </div>
  );
}
