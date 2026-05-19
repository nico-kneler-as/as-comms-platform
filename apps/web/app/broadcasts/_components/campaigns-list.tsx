"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
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
  readonly page?: number;
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

  if (input.page === undefined || input.page <= 1) {
    nextParams.delete("page");
  } else {
    nextParams.set("page", input.page.toString());
  }

  const queryString = nextParams.toString();
  return queryString.length === 0
    ? input.pathname
    : `${input.pathname}?${queryString}`;
}

function readPageFromSearchParams(searchParams: URLSearchParams): number {
  const parsed = Number.parseInt(searchParams.get("page") ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
}

function buildPaginationItems(currentPage: number, totalPages: number) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, 4, "ellipsis-right", totalPages] as const;
  }

  if (currentPage >= totalPages - 2) {
    return [
      1,
      "ellipsis-left",
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ] as const;
  }

  return [
    1,
    "ellipsis-left",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "ellipsis-right",
    totalPages,
  ] as const;
}

function buildCurrentHref(pathname: string, searchParams: URLSearchParams) {
  const queryString = searchParams.toString();
  return queryString.length === 0 ? pathname : `${pathname}?${queryString}`;
}

export function CampaignsList({
  items,
  rowsSection,
  projectOptions,
  selectedProjectIds,
  tabs,
  activeFilterId,
  searchQuery,
  page,
  totalPages,
  totalCount,
  showNewCampaignCta,
}: {
  readonly items: readonly CampaignRowViewModel[];
  readonly rowsSection?: ReactNode;
  readonly projectOptions: readonly CampaignProjectOption[];
  readonly selectedProjectIds: readonly string[];
  readonly tabs: readonly CampaignStateTab[];
  readonly activeFilterId: string;
  readonly searchQuery: string;
  readonly page: number;
  readonly totalPages: number;
  readonly totalCount: number;
  readonly showNewCampaignCta: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [searchDraft, setSearchDraft] = useState(searchQuery);

  useEffect(() => {
    setSearchDraft(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const currentParams = new URLSearchParams(searchParams.toString());
      const normalizedDraft = searchDraft.trim();
      const href = buildHref({
        pathname,
        currentParams,
        state: activeFilterId,
        projectIds: selectedProjectIds,
        query: searchDraft,
        page:
          normalizedDraft === searchQuery
            ? readPageFromSearchParams(currentParams)
            : 1,
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
    searchQuery,
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

  const hasActiveFilters =
    activeFilterId !== "all" ||
    selectedProjectIds.length > 0 ||
    searchQuery.length > 0;
  const showColdStart = totalCount === 0 && !hasActiveFilters;
  const showFilteredEmpty = rowsSection === undefined && items.length === 0;
  const paginationItems = buildPaginationItems(page, totalPages);

  if (showColdStart) {
    return (
      <div className="flex flex-1 px-4 py-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1180px] flex-1 rounded-lg border border-slate-200 bg-white">
          <EmptyState
            size="lg"
            icon={<MegaphoneIcon className="size-7 text-slate-500" />}
            title="No broadcasts yet"
            description="Start your first one."
            action={
              showNewCampaignCta ? (
                <Button asChild>
                  <Link href="/broadcasts/new">New broadcast</Link>
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
    <div className="flex min-h-0 flex-1 px-4 py-4 sm:px-6">
      <div className="mx-auto flex min-h-0 w-full max-w-[1180px] flex-1 flex-col">
        <div className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <StateFilterTabs
              tabs={tabs}
              activeTabId={activeFilterId}
              onSelect={(nextState) => {
                if (nextState === activeFilterId) {
                  return;
                }

                const currentParams = new URLSearchParams(
                  searchParams.toString(),
                );
                const href = buildHref({
                  pathname,
                  currentParams,
                  state: nextState,
                  projectIds: selectedProjectIds,
                  query: searchDraft,
                  page: 1,
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
                    className="inline-flex h-9 min-w-[13rem] items-center justify-between rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-700"
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
                  className="w-64 rounded-lg p-1.5"
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
                            query: searchDraft,
                            page: 1,
                          });
                          startTransition(() => {
                            router.replace(href, { scroll: false });
                          });
                        }}
                        className="rounded-md text-[12.5px]"
                      >
                        {project.label}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              <label
                className={cn(
                  "flex h-9 min-w-[18rem] items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-[13px]",
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
                  onInput={(event) => {
                    setSearchDraft(event.currentTarget.value);
                  }}
                  placeholder="Search broadcasts"
                  className="w-full bg-transparent text-slate-900 placeholder:text-slate-400 focus:outline-none"
                />
              </label>
            </div>
          </div>
        </div>

        {showFilteredEmpty ? (
          <div className="flex flex-1 items-center justify-center px-6 py-10">
            <EmptyState
              size="lg"
              icon={<SearchIcon className="size-7 text-slate-500" />}
              title="No broadcasts match these filters."
              description="Clear the current filters to see more broadcast history."
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
          <>
            {rowsSection ?? (
              <div className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
                {items.map((item) => (
                  <CampaignRow
                    key={`${item.provider}:${item.runId}`}
                    item={item}
                  />
                ))}
              </div>
            )}

            {totalPages > 1 ? (
              <Pagination className="mt-4 justify-center">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href={buildHref({
                        pathname,
                        currentParams: new URLSearchParams(
                          searchParams.toString(),
                        ),
                        state: activeFilterId,
                        projectIds: selectedProjectIds,
                        query: searchDraft,
                        page: Math.max(1, page - 1),
                      })}
                      aria-disabled={page <= 1}
                      className={
                        page <= 1 ? "pointer-events-none opacity-50" : ""
                      }
                    />
                  </PaginationItem>

                  {paginationItems.map((item, index) => (
                    <PaginationItem key={`${String(item)}-${String(index)}`}>
                      {typeof item === "number" ? (
                        <PaginationLink
                          href={buildHref({
                            pathname,
                            currentParams: new URLSearchParams(
                              searchParams.toString(),
                            ),
                            state: activeFilterId,
                            projectIds: selectedProjectIds,
                            query: searchDraft,
                            page: item,
                          })}
                          isActive={item === page}
                        >
                          {item}
                        </PaginationLink>
                      ) : (
                        <PaginationEllipsis />
                      )}
                    </PaginationItem>
                  ))}

                  <PaginationItem>
                    <PaginationNext
                      href={buildHref({
                        pathname,
                        currentParams: new URLSearchParams(
                          searchParams.toString(),
                        ),
                        state: activeFilterId,
                        projectIds: selectedProjectIds,
                        query: searchDraft,
                        page: Math.min(totalPages, page + 1),
                      })}
                      aria-disabled={page >= totalPages}
                      className={
                        page >= totalPages
                          ? "pointer-events-none opacity-50"
                          : ""
                      }
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export function CampaignRowsSkeleton({
  rows = 6,
}: {
  readonly rows?: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={`campaign-row-skeleton-${String(index)}`}
          className="grid min-h-[92px] grid-cols-[40px_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-3 sm:min-h-0 sm:grid-cols-[40px_minmax(0,1fr)_minmax(150px,190px)] sm:items-center sm:gap-4"
        >
          <Skeleton className="size-9 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-52" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
          <div className="col-span-2 space-y-2 sm:col-span-1 sm:ml-auto sm:w-[190px]">
            <Skeleton className="ml-auto h-3.5 w-24 max-w-full" />
            <Skeleton className="ml-auto h-3 w-32 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
