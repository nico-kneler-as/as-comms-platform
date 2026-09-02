"use client";

import type { ChangeEvent, ReactNode } from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, FileAudio2, FileText, ImagePlus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

import {
  toMediaLibraryItem,
  type BroadcastMediaLibraryAsset,
} from "../_lib/media-library-item";

export type { BroadcastMediaLibraryAsset } from "../_lib/media-library-item";

interface PendingAction {
  readonly kind: "upload" | "delete";
  readonly assetId?: string;
}

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes.toLocaleString()} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function readErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { message?: unknown };
    if (typeof payload.message === "string" && payload.message.length > 0) {
      return payload.message;
    }
  }

  return "Request failed.";
}

export function BroadcastMediaLibrary({
  initialAssets,
  initialNextCursor,
  emptyStateIcon,
}: {
  readonly initialAssets: readonly BroadcastMediaLibraryAsset[];
  readonly initialNextCursor: string | null;
  readonly emptyStateIcon: ReactNode;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [assets, setAssets] = useState(initialAssets);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [copiedAssetId, setCopiedAssetId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pending, startTransition] = useTransition();

  // Re-sync the grid when the server re-renders with fresh data (e.g. after
  // router.refresh() following an upload or delete). Without this, the client
  // state seeded once from the initial props would shadow the refreshed list,
  // so new files would not appear and deleted ones would not disappear.
  useEffect(() => {
    setAssets(initialAssets);
    setNextCursor(initialNextCursor);
  }, [initialAssets, initialNextCursor]);

  function triggerFilePicker() {
    inputRef.current?.click();
  }

  function handleUpload(file: File) {
    setPendingAction({ kind: "upload" });
    setFeedback(null);

    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/broadcasts/images", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          setFeedback(await readErrorMessage(response));
          return;
        }

        setCopiedAssetId(null);
        setFeedback("File uploaded.");
        router.refresh();
      } catch {
        setFeedback("Upload failed.");
      } finally {
        setPendingAction(null);
        if (inputRef.current) {
          inputRef.current.value = "";
        }
      }
    });
  }

  function handleDelete(assetId: string) {
    setPendingAction({ kind: "delete", assetId });
    setFeedback(null);

    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/broadcasts/images/${encodeURIComponent(assetId)}`,
          {
            method: "DELETE",
          },
        );

        if (!response.ok) {
          setFeedback(await readErrorMessage(response));
          return;
        }

        setCopiedAssetId((current) => (current === assetId ? null : current));
        setFeedback("File deleted.");
        router.refresh();
      } catch {
        setFeedback("Delete failed.");
      } finally {
        setPendingAction(null);
      }
    });
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    handleUpload(file);
  }

  async function handleCopy(asset: BroadcastMediaLibraryAsset) {
    try {
      await navigator.clipboard.writeText(asset.url);
      setCopiedAssetId(asset.id);
      setFeedback("URL copied.");
    } catch {
      setFeedback("Copy failed.");
    }
  }

  async function handleLoadMore() {
    if (nextCursor === null || loadingMore) {
      return;
    }

    setLoadMoreError(null);
    setLoadingMore(true);

    try {
      const response = await fetch(
        `/api/broadcasts/images?cursor=${encodeURIComponent(nextCursor)}&limit=100`,
      );

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const payload = (await response.json()) as {
        items: readonly {
          id: string;
          url: string;
          filename: string;
          contentType: string;
          kind: "image" | "audio" | "document";
          typeLabel: string;
          sizeBytes: number;
          createdAt: string;
        }[];
        nextCursor: string | null;
      };

      setAssets((current) => [
        ...current,
        ...payload.items.map(toMediaLibraryItem),
      ]);
      setNextCursor(payload.nextCursor);
    } catch (error) {
      setLoadMoreError(
        error instanceof Error && error.message.length > 0
          ? error.message
          : "Load more failed.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Hosted files</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Upload once, then paste the hosted URL into broadcast content — images, audio, and PDFs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={triggerFilePicker}
          >
            <ImagePlus className="size-4" aria-hidden="true" />
            {pendingAction?.kind === "upload" ? "Uploading..." : "Upload file"}
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,audio/mpeg,audio/mp4,audio/wav,application/pdf,.mp3,.m4a,.wav,.pdf"
          className="sr-only"
          onChange={handleFileSelection}
        />
      </div>

      {feedback ? (
        <div className="px-5 pt-4">
          <p
            className={cn(
              "rounded-lg border px-3 py-2 text-sm",
              /failed/iu.test(feedback)
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-slate-200 bg-slate-50 text-slate-600",
            )}
          >
            {feedback}
          </p>
        </div>
      ) : null}

      {assets.length === 0 ? (
        <EmptyState
          size="lg"
          icon={emptyStateIcon}
          title="No files yet"
          description="Upload one to get started."
          action={
            <Button type="button" onClick={triggerFilePicker}>
              Upload file
            </Button>
          }
          className="min-h-[360px]"
        />
      ) : (
        <div>
          <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
            {assets.map((asset) => {
              const isDeleting =
                pendingAction?.kind === "delete" &&
                pendingAction.assetId === asset.id;

              return (
                <article
                  key={asset.id}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                >
                  {asset.kind === "image" ? (
                    <a href={asset.url} target="_blank" rel="noreferrer" className="block aspect-[16/10] overflow-hidden bg-slate-100">
                      {/* Arbitrary hosted asset URLs are not guaranteed to be in Next image config. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={asset.url} alt={asset.filename} className="h-full w-full object-cover" />
                    </a>
                  ) : (
                    <div className="flex aspect-[16/10] flex-col items-center justify-center gap-3 bg-slate-100 p-4 text-slate-600">
                      {asset.kind === "audio" ? <FileAudio2 className="size-9" aria-hidden="true" /> : <FileText className="size-9" aria-hidden="true" />}
                      <span className="text-sm font-medium">{asset.typeLabel}</span>
                      {asset.kind === "audio" ? <audio controls preload="none" src={asset.url} className="w-full" /> : null}
                    </div>
                  )}
                  <div className="flex flex-col gap-4 p-4">
                    <div className="min-w-0">
                      <p
                        className="truncate text-sm font-medium text-slate-900"
                        title={asset.filename}
                      >
                        {asset.filename}
                      </p>
                      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs text-slate-500">
                        <dt>Type</dt>
                        <dd className="truncate">{asset.typeLabel}</dd>
                        <dt>Size</dt>
                        <dd>{formatBytes(asset.sizeBytes)}</dd>
                        <dt>Added</dt>
                        <dd>{DATE_FORMATTER.format(new Date(asset.createdAt))}</dd>
                      </dl>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => {
                          void handleCopy(asset);
                        }}
                      >
                        {copiedAssetId === asset.id ? (
                          <Check className="size-4" aria-hidden="true" />
                        ) : (
                          <Copy className="size-4" aria-hidden="true" />
                        )}
                        {copiedAssetId === asset.id ? "Copied" : "Copy URL"}
                      </Button>
                      <Button asChild size="sm" variant="ghost">
                        <a href={asset.url} target="_blank" rel="noreferrer">
                          <ExternalLink className="size-4" aria-hidden="true" />
                          Open
                        </a>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        disabled={pending}
                        onClick={() => {
                          handleDelete(asset.id);
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                        {isDeleting ? "Deleting..." : "Delete"}
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="border-t border-slate-200 px-5 py-4">
            {loadMoreError ? (
              <p className="mb-3 text-sm text-rose-700">{loadMoreError}</p>
            ) : null}
            {nextCursor !== null ? (
              <Button
                type="button"
                variant="outline"
                disabled={loadingMore}
                onClick={() => {
                  void handleLoadMore();
                }}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
