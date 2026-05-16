"use client";

import * as React from "react";
import { useState, useTransition } from "react";

import type { PostmarkSenderStatus } from "@as-comms/contracts";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

import {
  loadPostmarkSenderSetupAction,
  recheckPostmarkSenderStatusAction,
  type PostmarkSenderSetupMutationData,
} from "../actions";

const STATUS_META: Record<
  PostmarkSenderStatus,
  {
    readonly label: string;
    readonly classes: string;
  }
> = {
  verified: {
    label: "Verified",
    classes: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  pending: {
    label: "Pending",
    classes: "bg-amber-50 text-amber-800 ring-amber-200",
  },
  unverified: {
    label: "Not verified",
    classes: "bg-slate-100 text-slate-700 ring-slate-200",
  },
  rejected: {
    label: "Failed",
    classes: "bg-rose-50 text-rose-700 ring-rose-200",
  },
};

function recordLabel(record: PostmarkSenderSetupMutationData["dnsRecords"][number]) {
  return record.kind === "dkim" ? "DKIM" : "Return-Path";
}

export function PostmarkSenderStatusSection(props: {
  readonly projectId: string;
  readonly primaryEmail: string | null;
  readonly initialStatus: PostmarkSenderStatus;
}) {
  const [status, setStatus] = useState(props.initialStatus);
  const [details, setDetails] = useState<PostmarkSenderSetupMutationData | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const meta = STATUS_META[status];

  const domain =
    props.primaryEmail === null
      ? null
      : props.primaryEmail.slice(props.primaryEmail.lastIndexOf("@") + 1);

  function copyValue(value: string) {
    startTransition(async () => {
      try {
        await navigator.clipboard.writeText(value);
        setFeedback("Copied.");
      } catch {
        setFeedback("Copy failed.");
      }
    });
  }

  function loadSetup() {
    if (details !== null) {
      return;
    }

    startTransition(async () => {
      const result = await loadPostmarkSenderSetupAction(props.projectId);
      if (!result.ok) {
        setFeedback(result.message);
        return;
      }

      setDetails(result.data);
      setStatus(result.data.status);
      setFeedback(null);
    });
  }

  function recheck() {
    startTransition(async () => {
      const result = await recheckPostmarkSenderStatusAction(props.projectId);
      if (!result.ok) {
        setFeedback(result.message);
        return;
      }

      setDetails(result.data);
      setStatus(result.data.status);
      setFeedback("Sender status checked.");
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Postmark sender verification
            </h3>
            <StatusBadge
              label={meta.label}
              colorClasses={meta.classes}
              variant="soft"
            />
          </div>
          <p className="text-sm text-slate-600">
            {domain === null
              ? "Add a project inbox alias to configure sender verification."
              : `Primary sending domain: ${domain}`}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || domain === null}
          onClick={recheck}
        >
          Re-check now
        </Button>
      </div>

      {status !== "verified" ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
          <button
            type="button"
            className="text-sm font-medium text-slate-800 hover:text-slate-950"
            onClick={() => {
              const next = !expanded;
              setExpanded(next);
              if (next) {
                loadSetup();
              }
            }}
          >
            {expanded ? "Hide setup" : "Setup"}
          </button>

          {expanded ? (
            <div className="mt-3 flex flex-col gap-3">
              {details?.dnsRecords.length ? (
                details.dnsRecords.map((record) => (
                  <div
                    key={`${record.kind}:${record.host}:${record.value}`}
                    className="rounded-md border border-slate-200 bg-white p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">
                        {recordLabel(record)}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => {
                          copyValue(record.value);
                        }}
                      >
                        Copy value
                      </Button>
                    </div>
                    <dl className="mt-2 grid gap-1 text-xs text-slate-600">
                      <div className="grid grid-cols-[88px,1fr] gap-2">
                        <dt>Host</dt>
                        <dd className="font-mono text-slate-800">{record.host}</dd>
                      </div>
                      <div className="grid grid-cols-[88px,1fr] gap-2">
                        <dt>Type</dt>
                        <dd className="font-mono text-slate-800">{record.type}</dd>
                      </div>
                      <div className="grid grid-cols-[88px,1fr] gap-2">
                        <dt>Value</dt>
                        <dd className="break-all font-mono text-slate-800">
                          {record.value}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-600">
                  {pending
                    ? "Loading Postmark DNS records..."
                    : "No DNS records are available for this domain yet."}
                </p>
              )}

              {details?.returnPathDomain ? (
                <p className="text-xs text-slate-500">
                  Return-Path domain:{" "}
                  <span className="font-mono text-slate-700">
                    {details.returnPathDomain}
                  </span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {feedback ? (
        <p
          className={cn(
            "mt-3 text-xs",
            /failed|not configured|could not/iu.test(feedback)
              ? "text-rose-600"
              : "text-slate-500",
          )}
        >
          {feedback}
        </p>
      ) : null}
    </div>
  );
}
