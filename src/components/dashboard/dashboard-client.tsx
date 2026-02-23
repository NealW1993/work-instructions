"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { LocalDateTime } from "@/components/ui/local-date-time";

interface DashboardWorkItemSummary {
  department_id: string;
  department_name: string;
  part_number: string;
  mold_number: string;
  item_title: string;
}

export interface DashboardInstructionCardData {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  creator_name: string;
  workItem: DashboardWorkItemSummary;
}

export interface DashboardPinnedInstructionCardData
  extends DashboardInstructionCardData {
  pinned_at: string;
}

export interface DashboardWorkItemInstructionData {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  creator_name: string;
}

export interface DashboardWorkItemData extends DashboardWorkItemSummary {
  id: string;
  updated_at: string;
  work_instructions: DashboardWorkItemInstructionData[];
}

interface DashboardDepartmentOption {
  id: string;
  name: string;
}

interface DepartmentInsight {
  id: string;
  name: string;
  instructionCount: number;
}

interface DashboardClientProps {
  canEdit: boolean;
  initialQuery: string;
  searchError: string | null;
  newestError: string | null;
  pinnedError: string | null;
  pinnedInstructions: DashboardPinnedInstructionCardData[];
  newestInstructions: DashboardInstructionCardData[];
  items: DashboardWorkItemData[];
  departmentOptions: DashboardDepartmentOption[];
}

function formatDateForSearch(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(parsed);
}

function itemMatchesQuery(item: DashboardWorkItemData, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  const haystack =
    `${item.item_title} ${item.part_number} ${item.mold_number} ${item.department_name}`.toLowerCase();
  return haystack.includes(normalizedQuery);
}

function instructionMatchesQuery(
  instruction: DashboardWorkItemInstructionData,
  normalizedQuery: string,
) {
  if (!normalizedQuery) {
    return true;
  }

  const haystack =
    `revision ${instruction.revision} ${instruction.creator_name} ` +
    `${formatDateForSearch(instruction.created_at)}`;

  return haystack.toLowerCase().includes(normalizedQuery);
}

function getPrimaryPartOrMoldLabel(workItem: DashboardWorkItemSummary) {
  const mold = workItem.mold_number?.trim();
  if (mold) {
    return `Mold # ${mold}`;
  }

  const part = workItem.part_number?.trim();
  if (part) {
    return `Part # ${part}`;
  }

  return "Part # N/A";
}

function getLabelWithDepartment(workItem: DashboardWorkItemSummary) {
  return `${getPrimaryPartOrMoldLabel(workItem)} | ${workItem.department_name}`;
}

export function DashboardClient({
  canEdit,
  initialQuery,
  searchError,
  newestError,
  pinnedError,
  pinnedInstructions,
  newestInstructions,
  items,
  departmentOptions,
}: DashboardClientProps) {
  const [query, setQuery] = useState(initialQuery);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("all");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  useEffect(() => {
    if (!searchInputRef.current || !initialQuery) {
      return;
    }

    searchInputRef.current.focus();
    const cursorPosition = searchInputRef.current.value.length;
    searchInputRef.current.setSelectionRange(cursorPosition, cursorPosition);
  }, [initialQuery]);

  const departmentInsights = useMemo(() => {
    const insights = new Map<string, DepartmentInsight>();

    for (const option of departmentOptions) {
      insights.set(option.id, {
        id: option.id,
        name: option.name,
        instructionCount: 0,
      });
    }

    for (const item of items) {
      const existing = insights.get(item.department_id);
      if (existing) {
        existing.instructionCount += item.work_instructions.length;
      } else {
        insights.set(item.department_id, {
          id: item.department_id,
          name: item.department_name,
          instructionCount: item.work_instructions.length,
        });
      }
    }

    return Array.from(insights.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [departmentOptions, items]);

  const totalInstructionCount = useMemo(() => {
    return departmentInsights.reduce((sum, entry) => sum + entry.instructionCount, 0);
  }, [departmentInsights]);

  const selectedDepartmentName =
    selectedDepartmentId === "all"
      ? "All Departments"
      : departmentInsights.find((entry) => entry.id === selectedDepartmentId)?.name ??
        "Unknown Department";

  const departmentFilteredItems = useMemo(() => {
    if (selectedDepartmentId === "all") {
      return items;
    }

    return items.filter((item) => item.department_id === selectedDepartmentId);
  }, [items, selectedDepartmentId]);

  const filteredItems = useMemo(() => {
    if (!normalizedQuery) {
      return departmentFilteredItems;
    }

    return departmentFilteredItems
      .map((item) => {
        const includeAllInstructions = itemMatchesQuery(item, normalizedQuery);
        if (includeAllInstructions) {
          return item;
        }

        const matchingInstructions = item.work_instructions.filter((instruction) =>
          instructionMatchesQuery(instruction, normalizedQuery),
        );

        if (matchingInstructions.length === 0) {
          return null;
        }

        return {
          ...item,
          work_instructions: matchingInstructions,
        };
      })
      .filter((item): item is DashboardWorkItemData => item !== null);
  }, [departmentFilteredItems, normalizedQuery]);

  const filteredPinnedInstructions = useMemo(() => {
    if (selectedDepartmentId === "all") {
      return pinnedInstructions;
    }

    return pinnedInstructions.filter(
      (instruction) => instruction.workItem.department_id === selectedDepartmentId,
    );
  }, [pinnedInstructions, selectedDepartmentId]);

  const filteredNewestInstructions = useMemo(() => {
    if (selectedDepartmentId === "all") {
      return newestInstructions;
    }

    return newestInstructions.filter(
      (instruction) => instruction.workItem.department_id === selectedDepartmentId,
    );
  }, [newestInstructions, selectedDepartmentId]);

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
              Find Work Instructions
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Search updates instantly by part number or mold number.
            </p>
          </div>
          {canEdit ? (
            <Link
              href="/instructions/new"
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Create Instruction
            </Link>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_260px]">
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Part Number or Mold Number</span>
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                ref={searchInputRef}
                value={query}
                autoComplete="off"
                spellCheck={false}
                placeholder="Start typing (example: P, PG, PN-4401, Mold-23B)"
                onChange={(event) => setQuery(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Department</span>
            <select
              value={selectedDepartmentId}
              onChange={(event) => setSelectedDepartmentId(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="all">All Departments</option>
              {departmentInsights.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-2">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Department Insight
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedDepartmentId("all")}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                selectedDepartmentId === "all"
                  ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-800 dark:text-cyan-200"
                  : "border-slate-400/30 bg-slate-900/10 dark:bg-white/10"
              }`}
            >
              All ({totalInstructionCount})
            </button>
            {departmentInsights.map((department) => (
              <button
                key={department.id}
                type="button"
                onClick={() => setSelectedDepartmentId(department.id)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  selectedDepartmentId === department.id
                    ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-800 dark:text-cyan-200"
                    : "border-slate-400/30 bg-slate-900/10 dark:bg-white/10"
                }`}
              >
                {department.name} ({department.instructionCount})
              </button>
            ))}
          </div>
        </div>
      </section>

      {searchError ? (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
          {searchError}
        </p>
      ) : null}

      {isSearching ? (
        <section className="grid gap-4">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
              Search Results
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {filteredItems.length} matching work item
              {filteredItems.length === 1 ? "" : "s"} for &quot;{query.trim()}&quot; in{" "}
              {selectedDepartmentName}.
            </p>
          </div>

          {filteredItems.length === 0 ? (
            <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-6 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              No work instructions found.
            </p>
          ) : (
            filteredItems.map((item) => (
              <article
                key={item.id}
                className="grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-4 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-5"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                      {getLabelWithDepartment(item)}
                    </h2>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      {item.item_title}
                    </p>
                  </div>
                  <span className="rounded-full border border-slate-400/30 bg-slate-900/10 px-3 py-1 text-xs font-semibold dark:bg-white/10">
                    {item.work_instructions.length} instruction
                    {item.work_instructions.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {item.work_instructions.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      No instructions yet for this work item.
                    </p>
                  ) : (
                    item.work_instructions.map((instruction) => (
                      <Link
                        key={instruction.id}
                        href={`/instructions/${instruction.id}`}
                        className="rounded-xl border border-slate-300/70 bg-white/70 p-3 transition hover:border-cyan-500 hover:bg-cyan-500/5 dark:border-slate-700 dark:bg-slate-950/70"
                      >
                        <p className="font-semibold">Revision {instruction.revision}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Created <LocalDateTime value={instruction.created_at} mode="date" /> by{" "}
                          {instruction.creator_name}
                        </p>
                      </Link>
                    ))
                  )}
                </div>
              </article>
            ))
          )}
        </section>
      ) : (
        <>
          <section className="grid gap-4 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
                Your Pinned Instructions
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Quick-access instructions you&apos;ve pinned.
              </p>
            </div>
            {pinnedError ? (
              <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
                {pinnedError}
              </p>
            ) : filteredPinnedInstructions.length === 0 ? (
              <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                No pinned instructions for {selectedDepartmentName}.
              </p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {filteredPinnedInstructions.map((instruction) => (
                  <Link
                    key={instruction.id}
                    href={`/instructions/${instruction.id}`}
                    className="rounded-xl border border-slate-300/70 bg-white/70 p-3 transition hover:border-cyan-500 hover:bg-cyan-500/5 dark:border-slate-700 dark:bg-slate-950/70"
                  >
                    <p className="font-semibold">
                      {getLabelWithDepartment(instruction.workItem)}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {instruction.workItem.item_title}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Revision {instruction.revision} | Created{" "}
                      <LocalDateTime value={instruction.created_at} mode="date" /> by{" "}
                      {instruction.creator_name} | Pinned{" "}
                      <LocalDateTime value={instruction.pinned_at} mode="date" />
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="grid gap-4 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
                Newest Work Instructions
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                The latest 6 instructions created across the system.
              </p>
            </div>
            {newestError ? (
              <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
                {newestError}
              </p>
            ) : filteredNewestInstructions.length === 0 ? (
              <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                No instructions available for {selectedDepartmentName}.
              </p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {filteredNewestInstructions.map((instruction) => (
                  <Link
                    key={instruction.id}
                    href={`/instructions/${instruction.id}`}
                    className="rounded-xl border border-slate-300/70 bg-white/70 p-3 transition hover:border-cyan-500 hover:bg-cyan-500/5 dark:border-slate-700 dark:bg-slate-950/70"
                  >
                    <p className="font-semibold">
                      {getLabelWithDepartment(instruction.workItem)}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {instruction.workItem.item_title}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Revision {instruction.revision} | Created{" "}
                      <LocalDateTime value={instruction.created_at} mode="date" /> by{" "}
                      {instruction.creator_name}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
