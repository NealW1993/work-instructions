"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export interface DashboardInstructionCardData {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  creator_name: string;
  workItem: {
    part_number: string;
    mold_number: string;
    item_title: string;
  };
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

export interface DashboardWorkItemData {
  id: string;
  part_number: string;
  mold_number: string;
  item_title: string;
  updated_at: string;
  work_instructions: DashboardWorkItemInstructionData[];
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
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString();
}

function itemMatchesQuery(item: DashboardWorkItemData, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  const haystack = `${item.item_title} ${item.part_number} ${item.mold_number}`.toLowerCase();
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
    `${new Date(instruction.created_at).toLocaleDateString()}`;

  return haystack.toLowerCase().includes(normalizedQuery);
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
}: DashboardClientProps) {
  const [query, setQuery] = useState(initialQuery);
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

  const filteredItems = useMemo(() => {
    if (!normalizedQuery) {
      return items;
    }

    return items
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
  }, [items, normalizedQuery]);

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

        <label className="grid gap-1 text-sm md:max-w-xl">
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
              {filteredItems.length === 1 ? "" : "s"} for &quot;{query.trim()}&quot;.
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
                      {item.item_title}
                    </h2>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      <strong>Part:</strong> {item.part_number || "N/A"} |{" "}
                      <strong>Mold:</strong> {item.mold_number || "N/A"}
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
                          Created {formatDate(instruction.created_at)} by{" "}
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
            ) : pinnedInstructions.length === 0 ? (
              <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                No pinned instructions yet. Open an instruction and click the pin button.
              </p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {pinnedInstructions.map((instruction) => (
                  <Link
                    key={instruction.id}
                    href={`/instructions/${instruction.id}`}
                    className="rounded-xl border border-slate-300/70 bg-white/70 p-3 transition hover:border-cyan-500 hover:bg-cyan-500/5 dark:border-slate-700 dark:bg-slate-950/70"
                  >
                    <p className="font-semibold">{instruction.workItem.item_title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Part {instruction.workItem.part_number || "N/A"} | Mold{" "}
                      {instruction.workItem.mold_number || "N/A"}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Revision {instruction.revision} | Created{" "}
                      {formatDate(instruction.created_at)} by {instruction.creator_name} | Pinned{" "}
                      {formatDate(instruction.pinned_at)}
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
                The latest 5 instructions created across the system.
              </p>
            </div>
            {newestError ? (
              <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
                {newestError}
              </p>
            ) : newestInstructions.length === 0 ? (
              <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                No instructions available yet.
              </p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {newestInstructions.map((instruction) => (
                  <Link
                    key={instruction.id}
                    href={`/instructions/${instruction.id}`}
                    className="rounded-xl border border-slate-300/70 bg-white/70 p-3 transition hover:border-cyan-500 hover:bg-cyan-500/5 dark:border-slate-700 dark:bg-slate-950/70"
                  >
                    <p className="font-semibold">{instruction.workItem.item_title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Part {instruction.workItem.part_number || "N/A"} | Mold{" "}
                      {instruction.workItem.mold_number || "N/A"}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Revision {instruction.revision} | Created{" "}
                      {formatDate(instruction.created_at)} by {instruction.creator_name}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="grid gap-4">
            {items.length === 0 ? (
              <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-6 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                No work instructions found.
              </p>
            ) : null}

            {items.map((item) => (
              <article
                key={item.id}
                className="grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-4 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-5"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                      {item.item_title}
                    </h2>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      <strong>Part:</strong> {item.part_number || "N/A"} |{" "}
                      <strong>Mold:</strong> {item.mold_number || "N/A"}
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
                          Created {formatDate(instruction.created_at)} by{" "}
                          {instruction.creator_name}
                        </p>
                      </Link>
                    ))
                  )}
                </div>
              </article>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
