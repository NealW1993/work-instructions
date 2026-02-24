import Link from "next/link";

import { SignOutButton } from "@/components/layout/sign-out-button";
import { canEditInstructions, isSystemAdmin, roleLabel } from "@/lib/roles";
import type { Profile } from "@/lib/types";

export function AppHeader({ profile }: { profile: Profile }) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/20 bg-white/75 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/70">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-cyan-400 via-sky-500 to-blue-700" />
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-wide text-slate-500 dark:text-slate-300">
              Internal Work Instructions
            </p>
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">
              {profile.full_name}
              <span className="ml-2 rounded-full bg-slate-900 px-2 py-0.5 text-xs text-white dark:bg-slate-200 dark:text-slate-900">
                {roleLabel(profile.role)}
              </span>
            </p>
          </div>
        </div>
        <nav className="flex w-full flex-wrap items-center justify-end gap-2 md:w-auto md:gap-3">
          <Link
            href="/dashboard"
            className="rounded-full px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-900/10 dark:text-slate-100 dark:hover:bg-white/10"
          >
            Dashboard
          </Link>
          {canEditInstructions(profile.role) ? (
            <Link
              href="/instructions/new"
              className="rounded-full px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-900/10 dark:text-slate-100 dark:hover:bg-white/10"
            >
              New Instruction
            </Link>
          ) : null}
          <Link
            href="/account"
            className="rounded-full px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-900/10 dark:text-slate-100 dark:hover:bg-white/10"
          >
            Account Settings
          </Link>
          {isSystemAdmin(profile.role) ? (
            <Link
              href="/instructions/archived"
              className="rounded-full px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-900/10 dark:text-slate-100 dark:hover:bg-white/10"
            >
              Archived
            </Link>
          ) : null}
          {isSystemAdmin(profile.role) ? (
            <Link
              href="/admin/users"
              className="rounded-full px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-900/10 dark:text-slate-100 dark:hover:bg-white/10"
            >
              User Admin
            </Link>
          ) : null}
          <SignOutButton />
        </nav>
      </div>
    </header>
  );
}
