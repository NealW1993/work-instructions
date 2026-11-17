"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  BookOpen,
  Calculator,
  ChartNetwork,
  ChevronDown,
  ClipboardList,
  FileClock,
  FileUp,
  LayoutGrid,
  type LucideIcon,
  Plus,
  UsersRound,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { HeaderBackgroundVideo } from "@/components/layout/header-background-video";
import { UserAccountMenu } from "@/components/layout/user-account-menu";
import {
  DASHBOARD_LAYOUT_DEFAULT_STATE,
  DASHBOARD_LAYOUT_STATE_EVENT,
  type DashboardLayoutStateEventDetail,
} from "@/lib/dashboard-controls";
import { canCreateInstructions, hasFullAccess } from "@/lib/roles";
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

const DASHBOARD_RETURN_STATE_KEY = "__dashboardInstructionReturnState";

interface Workspace {
  href: string;
  label: string;
  icon: LucideIcon;
}

const WORKSPACES: Workspace[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/doc-center", label: "Doc Center", icon: BookOpen },
  { href: "/process-documents", label: "Process Docs", icon: ClipboardList },
  { href: "/process-maps", label: "Process Maps", icon: ChartNetwork },
  { href: "/process-maps/formulas", label: "Formula Tools", icon: Calculator },
  { href: "/groups", label: "Groups", icon: UsersRound },
];

/** Fades the edge of the tab bar where more tabs are scrolled out of view. */
function tabFadeMask({ start, end }: { start: boolean; end: boolean }) {
  if (!start && !end) return undefined;
  const from = start ? "transparent 0, black 2rem" : "black 0";
  const to = end ? "black calc(100% - 2rem), transparent 100%" : "black 100%";
  return `linear-gradient(to right, ${from}, ${to})`;
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isWorkspaceActive(pathname: string, href: string) {
  // Formula tools live under process maps but have their own tab.
  if (href === "/process-maps") {
    return isActivePath(pathname, href) && !isActivePath(pathname, "/process-maps/formulas");
  }
  return isActivePath(pathname, href);
}

/* The clock ticks once a minute: tablets stay signed in across shifts and through midnight. */
function subscribeToClock(onTick: () => void) {
  const timerId = window.setInterval(onTick, 15_000);
  window.addEventListener("focus", onTick);
  return () => {
    window.clearInterval(timerId);
    window.removeEventListener("focus", onTick);
  };
}

function currentMinute() {
  return Math.floor(Date.now() / 60_000);
}

function HeaderClock() {
  const minute = useSyncExternalStore(subscribeToClock, currentMinute, () => null);
  if (minute === null) return null;
  const now = new Date(minute * 60_000);
  return (
    <p className="hidden shrink-0 items-center gap-2 whitespace-nowrap text-xs font-medium tabular-nums text-slate-500 lg:flex dark:text-slate-400">
      <time dateTime={now.toISOString()}>
        {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
      </time>
      <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">|</span>
      <span>{now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
    </p>
  );
}

/** The primary action, with the other ways to start or find an instruction. */
function InstructionMenu({ pathname, canViewArchived }: { pathname: string; canViewArchived: boolean }) {
  // The menu belongs to the page it was opened on, so navigating closes it.
  const [openOnPath, setOpenOnPath] = useState<string | null>(null);
  const open = openOnPath === pathname;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenOnPath(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenOnPath(null);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const items = [
    { href: "/instructions/import", label: "Import instruction", description: "From a Word, Excel, PDF or image file", icon: FileUp },
    { href: "/drafts", label: "My drafts", description: "Pick up unfinished work", icon: FileClock },
    ...(canViewArchived
      ? [{ href: "/instructions/archived", label: "Archived instructions", description: "Review or restore retired work", icon: Archive }]
      : []),
  ];
  const primaryActive = isActivePath(pathname, "/instructions/new");

  return (
    <div ref={rootRef} className="relative inline-flex shrink-0">
      <Link
        href="/instructions/new"
        aria-label="New Instruction"
        aria-current={primaryActive ? "page" : undefined}
        className="inline-flex h-10 items-center gap-2 rounded-l-md bg-cyan-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-800 focus-visible:z-10 sm:px-4 dark:bg-cyan-600 dark:hover:bg-cyan-500"
      >
        <Plus size={18} aria-hidden="true" />
        <span className="hidden sm:inline">New Instruction</span>
      </Link>
      <button
        ref={triggerRef}
        type="button"
        aria-label="More instruction options"
        aria-expanded={open}
        aria-controls="instruction-options"
        onClick={() => setOpenOnPath(open ? null : pathname)}
        className="inline-flex h-10 items-center rounded-r-md border-l border-white/25 bg-cyan-700 px-2 text-white shadow-sm transition hover:bg-cyan-800 focus-visible:z-10 dark:bg-cyan-600 dark:hover:bg-cyan-500"
      >
        <ChevronDown size={16} aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div
          id="instruction-options"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-[90] grid w-72 max-w-[calc(100vw-2rem)] gap-0.5 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpenOnPath(null)}
                className={cn(
                  "flex min-h-12 items-center gap-3 rounded-md px-2.5 py-2 transition",
                  active ? "bg-cyan-50 text-cyan-900 dark:bg-cyan-500/15 dark:text-cyan-100" : "text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800",
                )}
              >
                <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <Icon size={16} />
                </span>
                <span className="grid min-w-0">
                  <span className="text-sm font-semibold">{item.label}</span>
                  <span className="truncate text-xs text-slate-500 dark:text-slate-400">{item.description}</span>
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function AppHeader({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const tabsRef = useRef<HTMLDivElement>(null);
  const [tabsOverflow, setTabsOverflow] = useState({ start: false, end: false });
  const [dashboardLayoutState, setDashboardLayoutState] = useState(DASHBOARD_LAYOUT_DEFAULT_STATE);
  const userCanCreateInstructions = canCreateInstructions(profile.role);
  const isDashboard = isActivePath(pathname, "/dashboard");

  // The homepage reports its editor state so the header can offer a way back to unsaved layout changes.
  useEffect(() => {
    const handleDashboardLayoutState = (event: Event) => {
      const detail = (event as CustomEvent<DashboardLayoutStateEventDetail>).detail;
      if (!detail || typeof detail.available !== "boolean") return;
      setDashboardLayoutState({
        available: detail.available,
        customizeOpen: Boolean(detail.customizeOpen),
        layoutDirty: Boolean(detail.layoutDirty),
        layoutSaving: Boolean(detail.layoutSaving),
        layoutError: detail.layoutError ?? null,
        canUndoLayout: Boolean(detail.canUndoLayout),
        canRedoLayout: Boolean(detail.canRedoLayout),
        activeLayoutPresetId: typeof detail.activeLayoutPresetId === "string" ? detail.activeLayoutPresetId : null,
        layoutPresets: Array.isArray(detail.layoutPresets) ? detail.layoutPresets : [],
        studioWidgets: Array.isArray(detail.studioWidgets) ? detail.studioWidgets : [],
      });
    };
    window.addEventListener(DASHBOARD_LAYOUT_STATE_EVENT, handleDashboardLayoutState as EventListener);
    return () => window.removeEventListener(DASHBOARD_LAYOUT_STATE_EVENT, handleDashboardLayoutState as EventListener);
  }, []);

  // On narrow screens the tabs scroll sideways; keep the current one in view.
  useEffect(() => {
    const container = tabsRef.current;
    const active = container?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!container || !active) return;
    const start = active.offsetLeft - 16;
    const end = active.offsetLeft + active.offsetWidth + 16;
    if (start < container.scrollLeft) container.scrollLeft = start;
    else if (end > container.scrollLeft + container.clientWidth) container.scrollLeft = end - container.clientWidth;
  }, [pathname]);

  // Track whether tabs are hidden past either edge, to hint that the bar scrolls.
  useEffect(() => {
    const container = tabsRef.current;
    if (!container) return;
    function updateOverflow() {
      if (!container) return;
      const start = container.scrollLeft > 4;
      const end = container.scrollLeft + container.clientWidth < container.scrollWidth - 4;
      setTabsOverflow((current) => (current.start === start && current.end === end ? current : { start, end }));
    }
    updateOverflow();
    container.addEventListener("scroll", updateOverflow, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateOverflow);
    observer?.observe(container);
    return () => {
      container.removeEventListener("scroll", updateOverflow);
      observer?.disconnect();
    };
  }, []);

  const handleDashboardLinkClick = useCallback((event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    try {
      window.sessionStorage.removeItem(DASHBOARD_RETURN_STATE_KEY);
    } catch {
      // Session storage cleanup is best-effort.
    }
    if (pathname !== "/dashboard") return;
    // Already on the dashboard: return to the top instead of reloading.
    event.preventDefault();
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  const studioState = isDashboard ? dashboardLayoutState : DASHBOARD_LAYOUT_DEFAULT_STATE;
  const showStudioStatus = studioState.available && studioState.customizeOpen;
  const studioStatus = studioState.layoutSaving
    ? "Saving"
    : studioState.layoutError
      ? "Save failed"
      : studioState.layoutDirty
        ? "Unsaved"
        : "Saved";
  const studioNeedsAttention = studioState.layoutDirty || studioState.layoutSaving || Boolean(studioState.layoutError);

  return (
    <header className="sticky top-0 z-[80] print:hidden">
      <div className="relative border-b border-slate-900/10 dark:border-white/10">
        <div aria-hidden="true" className="absolute inset-0 overflow-hidden bg-white dark:bg-black">
          <HeaderBackgroundVideo />
          {/* A light veil keeps the loop clearly visible while the label stays readable over it. */}
          <div className="absolute inset-0 bg-white/40 dark:bg-black/35" />
        </div>
        <div className="relative mx-auto flex h-14 w-full max-w-[1600px] items-center gap-3 px-4 sm:h-16 md:px-8">
          <Link
            href="/dashboard"
            onClick={handleDashboardLinkClick}
            aria-label="Work Instructions dashboard"
            className="flex min-w-0 items-center gap-3 rounded-md py-1 pr-1"
          >
            <Image src="/delta-logo.svg" alt="" width={36} height={36} priority className="h-9 w-9 shrink-0" />
            <span className="hidden truncate text-base font-bold tracking-tight text-slate-950 sm:block dark:text-white">Work Instructions</span>
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
            {userCanCreateInstructions ? (
              <InstructionMenu pathname={pathname} canViewArchived={hasFullAccess(profile.role)} />
            ) : null}
            <UserAccountMenu profile={profile} />
          </div>
        </div>
      </div>

      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 pl-2 pr-4 md:pl-6 md:pr-8">
          <nav aria-label="Workspace navigation" className="min-w-0 flex-1">
            <div
              ref={tabsRef}
              style={{ maskImage: tabFadeMask(tabsOverflow), WebkitMaskImage: tabFadeMask(tabsOverflow) }}
              className="relative flex items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {WORKSPACES.map((workspace) => {
                const Icon = workspace.icon;
                const active = isWorkspaceActive(pathname, workspace.href);
                return (
                  <Link
                    key={workspace.href}
                    href={workspace.href}
                    aria-current={active ? "page" : undefined}
                    onClick={workspace.href === "/dashboard" ? handleDashboardLinkClick : undefined}
                    className={cn(
                      "relative inline-flex min-h-12 shrink-0 items-center gap-2 px-3 text-sm font-semibold transition-colors",
                      "after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-t-sm after:transition-colors",
                      active
                        ? "text-slate-950 after:bg-cyan-600 dark:text-white dark:after:bg-cyan-400"
                        : "text-slate-600 after:bg-transparent hover:text-slate-950 hover:after:bg-slate-300 dark:text-slate-400 dark:hover:text-white dark:hover:after:bg-slate-600",
                    )}
                  >
                    <Icon size={16} aria-hidden="true" className={active ? "text-cyan-700 dark:text-cyan-400" : "text-slate-400 dark:text-slate-500"} />
                    {workspace.label}
                  </Link>
                );
              })}
            </div>
          </nav>
          {showStudioStatus ? (
            <button
              type="button"
              aria-controls="homepage-editor"
              aria-label={`Go to homepage editor. ${studioStatus}.`}
              onClick={() => {
                const editor = document.getElementById("homepage-editor");
                editor?.scrollIntoView({
                  block: "start",
                  behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                });
                editor?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
              }}
              className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <LayoutGrid size={14} aria-hidden="true" />
              <span className="hidden sm:inline">Homepage editor</span>
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                  studioNeedsAttention
                    ? "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200"
                    : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200",
                )}
              >
                {studioStatus}
              </span>
            </button>
          ) : null}
          <HeaderClock />
        </div>
      </div>
    </header>
  );
}
