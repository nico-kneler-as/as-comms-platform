import Link from "next/link";
import { ImageIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  countBroadcastMediaAssets,
  listBroadcastMediaAssets,
} from "@/src/server/stage1-runtime";

import { BroadcastMediaLibrary } from "./_components/broadcast-media-library";
import { toMediaLibraryItem } from "./_lib/media-library-item";

export const metadata = {
  title: "Broadcast media library",
};

export const dynamic = "force-dynamic";

export default async function BroadcastMediaLibraryPage() {
  const [{ items, nextCursor }, totalAssets] = await Promise.all([
    listBroadcastMediaAssets({ limit: 100, cursor: null }),
    countBroadcastMediaAssets(),
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-100">
      <div className="px-6 pt-6 pb-4">
        <div className="mx-auto w-full max-w-[1180px]">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h1 className="text-lg font-semibold tracking-tight text-balance text-slate-950">
                  Media library
                </h1>
                <span className="text-sm tabular-nums text-slate-500">
                  {totalAssets.toLocaleString()}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-pretty text-slate-500">
                Upload hosted broadcast images and copy the public URL into HTML
                email content.
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/broadcasts">Back to broadcasts</Link>
            </Button>
          </header>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 px-6 pb-6">
        <div className="mx-auto flex min-h-0 w-full max-w-[1180px] flex-1 flex-col">
          <BroadcastMediaLibrary
            initialAssets={items.map(toMediaLibraryItem)}
            initialNextCursor={nextCursor}
            emptyStateIcon={<ImageIcon className="size-7 text-slate-500" />}
          />
        </div>
      </div>
    </div>
  );
}
