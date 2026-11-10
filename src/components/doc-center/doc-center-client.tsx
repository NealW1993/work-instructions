"use client";

import Link from "next/link";
import { BookOpen, FileText, GitBranch, Lock, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { cn } from "@/lib/utils";

export interface DocCenterGroup {
  id: string;
  name: string;
}

export interface DocCenterItem {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  kind: "document" | "instruction" | "map";
  status: string;
  updated_at: string;
  group_ids: string[];
  group_names: string[];
}

interface DocCenterClientProps {
  groups: DocCenterGroup[];
  items: DocCenterItem[];
  loadFailed?: boolean;
}

const PAGE_SIZE = 18;

function kindLabel(kind: DocCenterItem["kind"]) {
  switch (kind) {
    case "instruction":
      return "Instruction";
    case "map":
      return "Map";
    case "document":
    default:
      return "Document";
  }
}

function kindIcon(kind: DocCenterItem["kind"]) {
  switch (kind) {
    case "instruction":
      return FileText;
    case "map":
      return GitBranch;
    case "document":
    default:
      return BookOpen;
  }
}

export function DocCenterClient({ groups, items, loadFailed = false }: DocCenterClientProps) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | DocCenterItem["kind"]>("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("updated");
  const [page, setPage] = useState(1);
  const statuses = useMemo(() => [...new Set(items.map((item) => item.status))].sort(), [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return items.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) {
        return false;
      }

      if (groupFilter !== "all" && !item.group_ids.includes(groupFilter)) {
        return false;
      }

      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return [item.title, item.subtitle, item.status, item.group_names.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    }).sort((left, right) => sortBy === "title"
      ? left.title.localeCompare(right.title, undefined, { numeric: true })
      : (Date.parse(right.updated_at) || 0) - (Date.parse(left.updated_at) || 0));
  }, [groupFilter, items, kindFilter, query, sortBy, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleItems = filteredItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hasFilters = Boolean(query.trim() || kindFilter !== "all" || groupFilter !== "all" || statusFilter !== "all");

  function resetFilters() {
    setQuery("");
    setKindFilter("all");
    setGroupFilter("all");
    setStatusFilter("all");
    setPage(1);
  }

  const counts = {
    all: items.length,
    document: items.filter((item) => item.kind === "document").length,
    instruction: items.filter((item) => item.kind === "instruction").length,
    map: items.filter((item) => item.kind === "map").length,
  };

  return (
    <div className="grid gap-4">
      <header className="rounded-2xl border border-white/30 bg-white/80 p-5 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-950 dark:text-slate-50">
              Doc Center
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Explore controlled documents, work instructions, and process maps available through your groups.
            </p>
          </div>
          <Link
            href="/groups"
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-500/20 dark:text-cyan-100"
          >
            <Lock size={15} />
            Groups
          </Link>
        </div>
      </header>

      {loadFailed ? (
        <p role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200">
          Part of the document library could not be loaded. Refresh the page to retry; the results below may be incomplete.
        </p>
      ) : null}

      <section className="grid gap-3 rounded-2xl border border-slate-300/70 bg-white/85 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/75">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="relative block">
            <span className="sr-only">Search doc center</span>
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={query}
              type="search"
              onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              placeholder="Search documents, instructions, maps"
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <select
            aria-label="Content type"
            value={kindFilter}
            onChange={(event) => { setKindFilter(event.target.value as typeof kindFilter); setPage(1); }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="all">All ({counts.all})</option>
            <option value="document">Documents ({counts.document})</option>
            <option value="instruction">Instructions ({counts.instruction})</option>
            <option value="map">Maps ({counts.map})</option>
          </select>
          <select
            aria-label="Access group"
            value={groupFilter}
            onChange={(event) => { setGroupFilter(event.target.value); setPage(1); }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="all">All groups</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
          <p role="status" className="text-sm text-slate-600 dark:text-slate-400">
            {filteredItems.length.toLocaleString()} result{filteredItems.length === 1 ? "" : "s"}
            {hasFilters ? ` of ${items.length.toLocaleString()}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Approval status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
              <option value="all">All statuses</option>
              {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <select aria-label="Sort results" value={sortBy} onChange={(event) => { setSortBy(event.target.value); setPage(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
              <option value="updated">Recently updated</option>
              <option value="title">Title A–Z</option>
            </select>
            {hasFilters ? <button type="button" onClick={resetFilters} className="rounded-lg px-3 py-2 text-sm font-semibold text-cyan-800 hover:bg-cyan-500/10 dark:text-cyan-200">Clear filters</button> : null}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleItems.map((item) => {
            const Icon = kindIcon(item.kind);
            return (
              <Link
                key={`${item.kind}:${item.id}`}
                href={item.href}
                className="grid min-w-0 content-start gap-3 rounded-xl border border-slate-300/70 bg-white/75 p-4 transition hover:border-cyan-500/45 hover:bg-cyan-500/5 dark:border-slate-700 dark:bg-slate-900/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {kindLabel(item.kind)}
                    </p>
                    <h2 title={item.title} className="mt-1 line-clamp-2 break-words font-semibold text-slate-950 dark:text-slate-50">
                      {item.title}
                    </h2>
                  </div>
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-500/35 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200">
                    <Icon size={17} />
                  </span>
                </div>
                <p className="line-clamp-2 text-sm text-slate-600 dark:text-slate-300">
                  {item.subtitle}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      item.status.toLowerCase() === "approved"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
                    )}
                  >
                    {item.status}
                  </span>
                  {item.group_names.length > 0 ? (
                    <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-slate-300 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-300">
                      <Lock size={11} />
                      <span className="max-w-36 truncate">{item.group_names.join(", ")}</span>
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Updated <LocalDateTime value={item.updated_at} mode="date" />
                </p>
              </Link>
            );
          })}
        </div>

        {filteredItems.length === 0 ? (
          <div className="grid justify-items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center dark:border-slate-700">
            <BookOpen aria-hidden="true" size={26} className="text-slate-400" />
            <p className="font-semibold text-slate-800 dark:text-slate-200">{hasFilters ? "No matching documents" : "Your document library is empty"}</p>
            <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">{hasFilters ? "Try another search or clear the filters to see available content." : "Approved content appears here when it is available to your access groups."}</p>
            {hasFilters ? <button type="button" onClick={resetFilters} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700">Clear filters</button> : null}
          </div>
        ) : null}
        {pageCount > 1 ? (
          <nav aria-label="Document results pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <p className="text-sm text-slate-500 dark:text-slate-400">Page {currentPage} of {pageCount}</p>
            <div className="flex gap-2">
              <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700">Previous</button>
              <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700">Next</button>
            </div>
          </nav>
        ) : null}
      </section>
    </div>
  );
}
