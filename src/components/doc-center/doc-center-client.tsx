"use client";

import Link from "next/link";
import { BookOpen, FileText, GitBranch, Lock, Search } from "lucide-react";
import { useMemo, useState } from "react";

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
}

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

export function DocCenterClient({ groups, items }: DocCenterClientProps) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | DocCenterItem["kind"]>("all");
  const [groupFilter, setGroupFilter] = useState("all");

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return items.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) {
        return false;
      }

      if (groupFilter !== "all" && !item.group_ids.includes(groupFilter)) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return [item.title, item.subtitle, item.status, item.group_names.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [groupFilter, items, kindFilter, query]);

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
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documents, instructions, maps"
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <select
            value={kindFilter}
            onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="all">All ({counts.all})</option>
            <option value="document">Documents ({counts.document})</option>
            <option value="instruction">Instructions ({counts.instruction})</option>
            <option value="map">Maps ({counts.map})</option>
          </select>
          <select
            value={groupFilter}
            onChange={(event) => setGroupFilter(event.target.value)}
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

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((item) => {
            const Icon = kindIcon(item.kind);
            return (
              <Link
                key={`${item.kind}:${item.id}`}
                href={item.href}
                className="grid gap-3 rounded-xl border border-slate-300/70 bg-white/75 p-4 transition hover:border-cyan-500/45 hover:bg-cyan-500/10 dark:border-slate-700 dark:bg-slate-900/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {kindLabel(item.kind)}
                    </p>
                    <h2 className="mt-1 line-clamp-2 font-extrabold text-slate-950 dark:text-slate-50">
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
                      item.status.toLowerCase().includes("approved")
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
              </Link>
            );
          })}
        </div>

        {filteredItems.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No matching controlled content is available.
          </p>
        ) : null}
      </section>
    </div>
  );
}
