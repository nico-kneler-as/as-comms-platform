"use client";

import type { ChangeEvent, ReactNode } from "react";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, ImagePlus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

export interface BroadcastMediaLibraryAsset {
  readonly id: string;
  readonly url: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
}

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
  assets,
  emptyStateIcon,
}: {
  readonly assets: readonly BroadcastMediaLibraryAsset[];
  readonly emptyStateIcon: ReactNode;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [copiedAssetId, setCopiedAssetId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pending, startTransition] = useTransition();

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
        setFeedback("Image uploaded.");
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
        setFeedback("Image deleted.");
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

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Hosted images</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Upload once, then paste the hosted URL into broadcast HTML.
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
            {pendingAction?.kind === "upload" ? "Uploading..." : "Upload image"}
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
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
          title="No images yet"
          description="Upload one to get started."
          action={
            <Button type="button" onClick={triggerFilePicker}>
              Upload image
            </Button>
          }
          className="min-h-[360px]"
        />
      ) : (
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
                <a
                  href={asset.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block aspect-[16/10] overflow-hidden bg-slate-100"
                >
                  {/* Arbitrary hosted asset URLs are not guaranteed to be in Next image config. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={asset.url}
                    alt={asset.filename}
                    className="h-full w-full object-cover"
                  />
                </a>
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
                      <dd className="truncate">{asset.contentType}</dd>
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
      )}
    </section>
  );
}
