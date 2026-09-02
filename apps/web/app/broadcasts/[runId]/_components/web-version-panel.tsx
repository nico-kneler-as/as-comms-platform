"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Eye } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import {
  publishBroadcastWebVersionNow,
  setBroadcastWebVersionPublished,
} from "../../actions";
import type { RunDetailModel } from "../_lib/run-detail";
import { Panel } from "./run-detail-panels";

type WebVersion = RunDetailModel["webVersion"];

export function WebVersionPanel({
  runId,
  webVersion,
}: {
  readonly runId: string;
  readonly webVersion: WebVersion;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (webVersion === null) {
    return null;
  }

  function runAction(action: () => Promise<{ readonly ok: boolean; readonly message?: string }>) {
    setError(null);
    startTransition(() => {
      void action().then((result) => {
        if (!result.ok) {
          setError(result.message ?? "Unable to update the public page.");
          return;
        }
        router.refresh();
      });
    });
  }

  function handleCopy() {
    const url = webVersion?.url ?? null;
    if (url === null) {
      return;
    }

    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => {
          setCopied(false);
        }, 2_000);
      })
      .catch(() => {
        setError("Copy failed.");
      });
  }

  const link =
    webVersion.url === null ? null : (
      <p
        className={
          webVersion.state === "unpublished"
            ? "truncate font-mono text-[11px] text-slate-400"
            : "truncate font-mono text-[11px] text-slate-600"
        }
        title={webVersion.url}
      >
        {webVersion.url}
      </p>
    );

  return (
    <Panel title="Web version">
      <div className="space-y-2.5">
        {webVersion.state === "none" ? (
          webVersion.canPublish ? (
            <>
              <p className="text-[12px] text-slate-600">
                No public page for this broadcast.
              </p>
              <Button
                type="button"
                size="sm"
                className="h-7 text-[11.5px]"
                disabled={isPending}
                onClick={() => {
                  runAction(() => publishBroadcastWebVersionNow(runId));
                }}
              >
                {isPending ? "Publishing…" : "Publish web version"}
              </Button>
            </>
          ) : (
            <p className="text-[12px] text-slate-500">
              A public page is created when this broadcast sends.
            </p>
          )
        ) : webVersion.state === "pending" ? (
          <>
            {link}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-[11.5px]"
                disabled={isPending}
                onClick={handleCopy}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <span className="text-[11px] text-slate-500">
                Goes live when this broadcast sends.
              </span>
            </div>
          </>
        ) : webVersion.state === "published" ? (
          <>
            {link}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-[11.5px]"
                disabled={isPending}
                onClick={handleCopy}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? "Copied" : "Copy link"}
              </Button>
              <a
                href={webVersion.url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-[11.5px] font-medium text-slate-700 hover:bg-slate-50"
              >
                <Eye className="size-3" />
                Open
              </a>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[11.5px]"
                disabled={isPending}
                onClick={() => {
                  runAction(() => setBroadcastWebVersionPublished(runId, false));
                }}
              >
                Unpublish
              </Button>
            </div>
          </>
        ) : (
          <>
            {link}
            <p className="text-[11px] leading-relaxed text-slate-500">
              Unpublished — the link returns a &apos;not available&apos; page.
            </p>
            <Button
              type="button"
              size="sm"
              className="h-7 text-[11.5px]"
              disabled={isPending}
              onClick={() => {
                runAction(() => setBroadcastWebVersionPublished(runId, true));
              }}
            >
              {isPending ? "Republishing…" : "Republish"}
            </Button>
          </>
        )}
        {error === null ? null : (
          <p role="alert" className="text-[11px] text-red-700">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}
