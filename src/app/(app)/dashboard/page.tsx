import Link from "next/link";
import { Search } from "lucide-react";

import { requireAuthenticatedUser } from "@/lib/auth";
import { canEditInstructions } from "@/lib/roles";
import { escapeLikeQuery } from "@/lib/utils";

interface DashboardPageProps {
  searchParams: Promise<{
    q?: string;
  }>;
}

interface DashboardInstruction {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  work_items: DashboardInstructionWorkItem | DashboardInstructionWorkItem[];
}

interface DashboardWorkItemInstruction {
  id: string;
  revision: number;
  updated_at: string;
}

interface DashboardInstructionWorkItem {
  part_number: string;
  mold_number: string;
  item_title: string;
}

interface DashboardPinnedInstructionRow {
  created_at: string;
  work_instructions: DashboardInstruction | DashboardInstruction[] | null;
}

interface DashboardWorkItem {
  id: string;
  part_number: string;
  mold_number: string;
  item_title: string;
  updated_at: string;
  work_instructions: DashboardWorkItemInstruction[];
}

interface DashboardInstructionCard extends DashboardInstruction {
  workItem: DashboardInstructionWorkItem;
}

interface DashboardPinnedInstructionCard extends DashboardInstructionCard {
  pinned_at: string;
}

function normalizeWorkItem(
  relation:
    | DashboardInstructionWorkItem
    | DashboardInstructionWorkItem[]
    | null
    | undefined,
) {
  if (!relation) {
    return null;
  }

  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation;
}

function normalizeInstruction(
  relation: DashboardInstruction | DashboardInstruction[] | null,
) {
  if (!relation) {
    return null;
  }

  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }

  return relation;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { supabase, profile } = await requireAuthenticatedUser();
  const params = await searchParams;
  const query = params.q?.trim() ?? "";

  let searchRequest = supabase
    .from("work_items")
    .select(
      "id, part_number, mold_number, item_title, updated_at, work_instructions(id, revision, updated_at)",
    )
    .order("updated_at", { ascending: false })
    .limit(200);

  if (query) {
    const safeQuery = escapeLikeQuery(query);
    searchRequest = searchRequest.or(
      `part_number.ilike.%${safeQuery}%,mold_number.ilike.%${safeQuery}%`,
    );
  }

  const newestRequest = supabase
    .from("work_instructions")
    .select(
      "id, revision, created_at, updated_at, work_items(part_number, mold_number, item_title)",
    )
    .order("created_at", { ascending: false })
    .limit(5);

  const pinnedRequest = supabase
    .from("user_pinned_instructions")
    .select(
      "created_at, work_instructions(id, revision, created_at, updated_at, work_items(part_number, mold_number, item_title))",
    )
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(25);

  const [
    { data: searchData, error: searchError },
    { data: newestData, error: newestError },
    { data: pinnedData, error: pinnedError },
  ] = await Promise.all([searchRequest, newestRequest, pinnedRequest]);

  const items = (searchData ?? []) as DashboardWorkItem[];
  const newestInstructions = ((newestData ?? []) as DashboardInstruction[])
    .map((instruction) => {
      const workItem = normalizeWorkItem(instruction.work_items);
      if (!workItem) {
        return null;
      }

      return {
        ...instruction,
        workItem,
      };
    })
    .filter((instruction): instruction is DashboardInstructionCard => instruction !== null);

  const pinnedInstructions = ((pinnedData ?? []) as DashboardPinnedInstructionRow[])
    .map((row) => {
      const instruction = normalizeInstruction(row.work_instructions);
      if (!instruction) {
        return null;
      }

      const workItem = normalizeWorkItem(instruction.work_items);
      if (!workItem) {
        return null;
      }

      return {
        ...instruction,
        workItem,
        pinned_at: row.created_at,
      };
    })
    .filter(
      (instruction): instruction is DashboardPinnedInstructionCard => instruction !== null,
    );

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
              Find Work Instructions
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Search by part number or mold number. Each part/mold can hold
              multiple instruction records.
            </p>
          </div>
          {canEditInstructions(profile.role) ? (
            <Link
              href="/instructions/new"
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Create Instruction
            </Link>
          ) : null}
        </div>

        <form className="grid gap-2 md:max-w-xl" action="/dashboard" method="GET">
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Part Number or Mold Number</span>
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                name="q"
                defaultValue={query}
                placeholder="Example: PN-4401 or Mold-23B"
                className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          </label>
          <button
            type="submit"
            className="w-fit rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-500/20 dark:text-cyan-200"
          >
            Search
          </button>
        </form>
      </section>

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
            {pinnedError.message}
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
                  Part {instruction.workItem.part_number} | Mold{" "}
                  {instruction.workItem.mold_number || "N/A"}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Revision {instruction.revision} | Pinned{" "}
                  {new Date(instruction.pinned_at).toLocaleDateString()}
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
            {newestError.message}
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
                  Part {instruction.workItem.part_number} | Mold{" "}
                  {instruction.workItem.mold_number || "N/A"}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Revision {instruction.revision} | Created{" "}
                  {new Date(instruction.created_at).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      {searchError ? (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
          {searchError.message}
        </p>
      ) : null}

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
                  <strong>Part:</strong> {item.part_number} | <strong>Mold:</strong>{" "}
                  {item.mold_number || "N/A"}
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
                      Updated{" "}
                      {new Date(instruction.updated_at).toLocaleDateString()}
                    </p>
                  </Link>
                ))
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
