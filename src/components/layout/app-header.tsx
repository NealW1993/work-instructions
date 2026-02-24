import Link from "next/link";

import { UserAccountMenu } from "@/components/layout/user-account-menu";
import { canEditInstructions, isSystemAdmin } from "@/lib/roles";
import type { Profile } from "@/lib/types";

export function AppHeader({ profile }: { profile: Profile }) {
  const navigationLinks = (
    <>
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
    </>
  );

  return (
    <header className="sticky top-0 z-20 border-b border-white/20 bg-white/75 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/70">
      <div className="mx-auto w-full max-w-7xl px-4 py-3 md:px-8">
        <div className="relative flex items-center justify-end">
          <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-3 md:flex">
            {navigationLinks}
          </nav>
          <UserAccountMenu profile={profile} />
        </div>
        <nav className="mt-2 flex flex-wrap items-center justify-center gap-2 md:hidden">
          {navigationLinks}
        </nav>
      </div>
    </header>
  );
}
