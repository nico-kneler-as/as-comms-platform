"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

import {
  ChevronDownIcon,
  MegaphoneIcon,
  SearchIcon,
} from "@/app/inbox/_components/icons";

import type { CampaignRowViewModel } from "./campaign-row";
import { CampaignRow } from "./campaign-row";
import type { CampaignStateTab } from "./state-filter-tabs";
import { StateFilterTabs } from "./state-filter-tabs";

const DESKTOP_ROW_HEIGHT = 92;
const MOBILE_ROW_HEIGHT = 156;
const OVERSCAN = 6;

interface CampaignProjectOption {
  readonly id: string;
  readonly label: string;
}

function buildHref(input: {
  readonly pathname: string;
  readonly currentParams: URLSearchParams;
  readonly state?: string;
  readonly projectIds?: readonly string[];
  readonly query?: string;
}) {
  const nextParams = new URLSearchParams(input.currentParams.toString());

  if (input.state === undefined || input.state === "all") {
    nextParams.delete("state");
  } else {
    nextParams.set("state", input.state);
  }

  nextParams.delete("projectId");
  for (const projectId of input.projectIds ?? []) {
    nextParams.append("projectId", projectId);
  }

  const normalizedQuery = input.query?.trim() ?? "";
  if (normalizedQuery.length === 0) {
    nextParams.delete("q");
  } else {
    nextParams.set("q", normalizedQuery);
  }

  const queryString = nextParams.toString();
  return queryString.length === 0
    ? input.pathname
    : `${input.pathname}?${queryString}`;
}

function buildCurrentHref(pathname: string, searchParams: URLSearchParams) {
  const queryString = searchParams.toString();
  return queryString.length === 0 ? pathname : `${pathname}?${queryString}`;
}

export function CampaignsList({
  items,
  projectOptions,
  selectedProjectIds,
  tabs,
  activeFilterId,
  searchQuery,
  totalCount,
  showNewCampaignCta,
}: {
  readonly items: readonly CampaignRowViewModel[];
  readonly projectOptions: readonly CampaignProjectOption[];
  readonly selectedProjectIds: readonly string[];
  readonly tabs: readonly CampaignStateTab[];
  readonly activeFilterId: string;
  readonly searchQuery: string;
  readonly totalCount: number;
  readonly showNewCampaignCta: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [searchDraft, setSearchDraft] = useState(searchQuery);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(640);
  const [rowHeight, setRowHeight] = useState(DESKTOP_ROW_HEIGHT);

  useEffect(() => {
    setSearchDraft(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) {
      return;
    }

    const syncSize = () => {
      setViewportHeight(element.clientHeight);
      setRowHeight(
        element.clientWidth < 640 ? MOBILE_ROW_HEIGHT : DESKTOP_ROW_HEIGHT,
      );
    };
    const syncScroll = () => {
      setScrollTop(element.scrollTop);
    };

    syncSize();
    syncScroll();

    const observer = new ResizeObserver(syncSize);
    observer.observe(element);
    element.addEventListener("scroll", syncScroll, { passive: true });

    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", syncScroll);
    };
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const currentParams = new URLSearchParams(searchParams.toString());
      const href = buildHref({
        pathname,
        currentParams,
        state: activeFilterId,
        projectIds: selectedProjectIds,
        query: searchDraft,
      });
      if (href === buildCurrentHref(pathname, currentParams)) {
        return;
      }
      startTransition(() => {
        router.replace(href, { scroll: false });
      });
    }, 400);

    return () => {
      window.clearTimeout(handle);
    };
  }, [
    activeFilterId,
    pathname,
    router,
    searchDraft,
    searchParams,
    selectedProjectIds,
    startTransition,
  ]);

  const selectedProjectLabel =
    selectedProjectIds.length === 0
      ? "All projects"
      : selectedProjectIds.length === 1
        ? (projectOptions.find(
            (project) => project.id === selectedProjectIds[0],
          )?.label ?? "1 project")
        : `${selectedProjectIds.length.toString()} projects`;

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + OVERSCAN * 2;
  const endIndex = Math.min(items.length, startIndex + visibleCount);
  const visibleItems = useMemo(
    () => items.slice(startIndex, endIndex),
    [endIndex, items, startIndex],
  );

  const hasActiveFilters =
    activeFilterId !== "all" ||
    selectedProjectIds.length > 0 ||
    searchQuery.length > 0;
  const showColdStart = totalCount === 0 && !hasActiveFilters;

  if (showColdStart) {
    return (
      <div className="flex flex-1 px-4 py-8 sm:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-1 rounded-2xl border border-slate-200 bg-white">
          <EmptyState
            size="lg"
            icon={<MegaphoneIcon className="size-7 text-slate-500" />}
            title="No campaigns yet"
            description="Start your first one."
            action={
              showNewCampaignCta ? (
                <Button asChild>
                  <Link href="/campaigns/new">New campaign</Link>
                </Button>
              ) : undefined
            }
            className="w-full"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 px-4 py-6 sm:px-8">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col">
        <div className="pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <StateFilterTabs
              tabs={tabs}
              activeTabId={activeFilterId}
              onSelect={(nextState) => {
                const href = buildHref({
                  pathname,
                  currentParams: new URLSearchParams(searchParams.toString()),
                  state: nextState,
                  projectIds: selectedProjectIds,
                  query: searchQuery,
                });
                startTransition(() => {
                  router.replace(href, { scroll: false });
                });
              }}
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex min-w-[13rem] items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm"
                  >
                    <span className="truncate">{selectedProjectLabel}</span>
                    <ChevronDownIcon
                      className="size-4 text-slate-400"
                      aria-hidden="true"
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-64 rounded-2xl p-1.5"
                >
                  {projectOptions.map((project) => {
                    const checked = selectedProjectIds.includes(project.id);

                    return (
                      <DropdownMenuCheckboxItem
                        key={project.id}
                        checked={checked}
                        onSelect={(event) => {
                          event.preventDefault();
                          const nextProjectIds = checked
                            ? selectedProjectIds.filter(
                                (projectId) => projectId !== project.id,
                              )
                            : [...selectedProjectIds, project.id];
                          const href = buildHref({
                            pathname,
                            currentParams: new URLSearchParams(
                              searchParams.toString(),
                            ),
                            state: activeFilterId,
                            projectIds: nextProjectIds,
                            query: searchQuery,
                          });
                          startTransition(() => {
                            router.replace(href, { scroll: false });
                          });
                        }}
                        className="rounded-xl text-[12.5px]"
                      >
                        {project.label}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              <label
                className={cn(
                  "flex min-w-[18rem] items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm",
                  "shadow-sm",
                  isPending ? "ring-1 ring-slate-200" : "",
                )}
              >
                <SearchIcon
                  className="size-4 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  data-campaign-search="true"
                  type="text"
                  value={searchDraft}
                  onChange={(event) => {
                    setSearchDraft(event.currentTarget.value);
                  }}
                  placeholder="Search campaigns"
                  className="w-full bg-transparent text-slate-900 placeholder:text-slate-400 focus:outline-none"
                />
              </label>
            </div>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 py-12">
            <EmptyState
              size="lg"
              icon={<SearchIcon className="size-7 text-slate-500" />}
              title="No campaigns match these filters."
              description="Clear the current filters to see more campaign history."
              action={
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    startTransition(() => {
                      router.replace(pathname, { scroll: false });
                    });
                  }}
                >
                  Clear filters
                </Button>
              }
              className="w-full"
            />
          </div>
        ) : (
          <div
            ref={viewportRef}
            className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white"
          >
            <div
              className="relative overflow-hidden"
              style={{ height: `${String(items.length * rowHeight)}px` }}
            >
              {visibleItems.map((item, index) => {
                const rowIndex = startIndex + index;

                return (
                  <CampaignRow
                    key={`${item.provider}:${item.runId}`}
                    item={item}
                    style={{
                      position: "absolute",
                      top: `${String(rowIndex * rowHeight)}px`,
                      left: 0,
                      right: 0,
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
