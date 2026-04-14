import { FilterIcon, SearchIcon } from "./claude-icons.js";

interface HeaderProps {
  readonly title: string;
  readonly subtitle: string;
  readonly totalCount: number;
}

export function ClaudeInboxListHeader({
  title,
  subtitle,
  totalCount
}: HeaderProps) {
  return (
    <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="flex items-baseline justify-between gap-3 px-5 pb-2 pt-5">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        <span className="text-xs font-medium text-slate-500 tabular-nums">
          {totalCount} people
        </span>
      </div>
      <div className="flex items-center gap-2 px-5 pb-4 pt-2">
        <label className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm focus-within:border-slate-400 focus-within:ring-1 focus-within:ring-slate-300">
          <SearchIcon className="h-4 w-4 text-slate-400" />
          <input
            type="search"
            placeholder="Search people, subjects, projects"
            className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
        </label>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50"
        >
          <FilterIcon className="h-3.5 w-3.5" />
          Filters
        </button>
      </div>
    </div>
  );
}
