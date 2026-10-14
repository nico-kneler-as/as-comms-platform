"use client";

import { useDeferredValue, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface DonorCampaignList {
  readonly id: string;
  readonly name: string;
  readonly type: string | null;
  readonly status: string | null;
  readonly memberCount: number;
}

export function DonorAudienceStep({
  mode,
  selectedListIds,
  lists,
  lastSyncedAt,
  refreshing,
  onModeChange,
  onSelectedListIdsChange,
  onRefresh,
}: {
  readonly mode: "all_available" | "salesforce_lists";
  readonly selectedListIds: readonly string[];
  readonly lists: readonly DonorCampaignList[];
  readonly lastSyncedAt: string | null;
  readonly refreshing: boolean;
  readonly onModeChange: (mode: "all_available" | "salesforce_lists") => void;
  readonly onSelectedListIdsChange: (ids: readonly string[]) => void;
  readonly onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const visibleLists = useMemo(
    () =>
      lists.filter((list) =>
        `${list.name} ${list.type ?? ""} ${list.status ?? ""}`
          .toLowerCase()
          .includes(deferredQuery),
      ),
    [deferredQuery, lists],
  );
  const selected = new Set(selectedListIds);

  function toggleList(id: string, checked: boolean) {
    const next = new Set(selectedListIds);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectedListIdsChange([...next]);
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-slate-950">Who should receive this?</h2>
        <p className="mt-1 text-sm text-slate-600">Only people on the newsletter list who have not unsubscribed are reached.</p>
      </div>
      <fieldset className="space-y-3">
        <legend className="sr-only">Audience</legend>
        <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 bg-white p-4 has-[:checked]:border-slate-900 has-[:checked]:ring-1 has-[:checked]:ring-slate-900/10">
          <input type="radio" name="donor-audience" checked={mode === "all_available"} onChange={() => { onModeChange("all_available"); }} />
          <span><span className="block font-semibold text-slate-900">Everyone on the newsletter</span><span className="mt-1 block text-sm text-slate-600">Send to the full newsletter audience.</span></span>
        </label>
        <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 bg-white p-4 has-[:checked]:border-slate-900 has-[:checked]:ring-1 has-[:checked]:ring-slate-900/10">
          <input type="radio" name="donor-audience" checked={mode === "salesforce_lists"} onChange={() => { onModeChange("salesforce_lists"); }} />
          <span><span className="block font-semibold text-slate-900">Salesforce campaigns</span><span className="mt-1 block text-sm text-slate-600">Choose one or more campaigns from Salesforce.</span></span>
        </label>
      </fieldset>
      {mode === "salesforce_lists" ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">Last refreshed from Salesforce: {lastSyncedAt ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(lastSyncedAt)) : "not yet"}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</Button>
          </div>
          <label className="mt-4 block text-sm font-medium text-slate-800" htmlFor="donor-campaign-search">Find a campaign</label>
          <Input id="donor-campaign-search" value={query} onChange={(event) => { setQuery(event.currentTarget.value); }} className="mt-1" placeholder="Search campaigns" />
          <div className="mt-3 max-h-72 space-y-2 overflow-y-auto" aria-label="Salesforce campaigns">
            {visibleLists.map((list) => (
              <label key={list.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50">
                <input type="checkbox" checked={selected.has(list.id)} onChange={(event) => { toggleList(list.id, event.currentTarget.checked); }} />
                <span className="min-w-0 flex-1"><span className="block font-medium text-slate-900">{list.name}</span><span className="block text-xs text-slate-500">{[list.type, list.status, `${list.memberCount.toLocaleString()} members`].filter(Boolean).join(" · ")}</span></span>
              </label>
            ))}
            {visibleLists.length === 0 ? <p className="py-4 text-center text-sm text-slate-500">No campaigns match that search.</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
