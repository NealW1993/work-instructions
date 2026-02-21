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
  title: string;
  version: number;
  updated_at: string;
}

interface DashboardWorkItem {
  id: string;
  part_number: string;
  mold_number: string;
  item_title: string;
  description: string | null;
  updated_at: string;
  work_instructions: DashboardInstruction[];
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { supabase, profile } = await requireAuthenticatedUser();
  const params = await searchParams;
  const query = params.q?.trim() ?? "";

  let request = supabase
    .from("work_items")
    .select(
      "id, part_number, mold_number, item_title, description, updated_at, work_instructions(id, title, version, updated_at)",
    )
    .order("updated_at", { ascending: false })
    .limit(200);

  if (query) {
    const safeQuery = escapeLikeQuery(query);
    request = request.or(
      `part_number.ilike.%${safeQuery}%,mold_number.ilike.%${safeQuery}%`,
    );
  }

  const { data, error } = await request;

  const items = (data ?? []) as DashboardWorkItem[];

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

      {error ? (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
          {error.message}
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
            {item.description ? (
              <p className="text-sm text-slate-700 dark:text-slate-300">{item.description}</p>
            ) : null}
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
                    <p className="font-semibold">{instruction.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Version {instruction.version} | Updated{" "}
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