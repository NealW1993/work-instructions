"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { UserAccountMenu } from "@/components/layout/user-account-menu";
import { canEditInstructions, isSystemAdmin } from "@/lib/roles";
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

interface HeaderNavLink {
  href: string;
  label: string;
}

function isActivePath(pathname: string, href: string) {
  if (pathname === href) {
    return true;
  }

  return pathname.startsWith(`${href}/`);
}

export function AppHeader({ profile }: { profile: Profile }) {
  const pathname = usePathname();

  const navLinks: HeaderNavLink[] = [
    { href: "/dashboard", label: "Dashboard" },
    ...(canEditInstructions(profile.role)
      ? [{ href: "/instructions/new", label: "New Instruction" }]
      : []),
    ...(isSystemAdmin(profile.role)
      ? [{ href: "/instructions/archived", label: "Archived" }]
      : []),
    ...(isSystemAdmin(profile.role) ? [{ href: "/admin/users", label: "User Admin" }] : []),
  ];

  const renderNavLink = (link: HeaderNavLink) => {
    const active = isActivePath(pathname, link.href);

    return (
      <Link
        key={link.href}
        href={link.href}
        className={cn(
          "inline-flex items-center rounded-xl border px-4 py-2 text-sm font-semibold transition",
          active
            ? "border-cyan-500/55 bg-cyan-500/15 text-cyan-900 shadow-sm dark:text-cyan-100"
            : "border-slate-300/70 bg-white/70 text-slate-700 hover:border-cyan-400/60 hover:bg-cyan-500/10 dark:border-slate-700 dark:bg-slate-900/65 dark:text-slate-100 dark:hover:border-cyan-500/50 dark:hover:bg-cyan-500/10",
        )}
      >
        {link.label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-20 border-b border-white/20 bg-white/75 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/70">
      <div className="mx-auto w-full max-w-7xl px-4 py-3 md:px-8">
        <div className="relative flex items-center justify-end">
          <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-3 md:flex">
            {navLinks.map(renderNavLink)}
          </nav>
          <UserAccountMenu profile={profile} />
        </div>

        <nav className="mt-2 flex flex-wrap items-center justify-center gap-2 md:hidden">
          {navLinks.map(renderNavLink)}
        </nav>
      </div>
    </header>
  );
}
