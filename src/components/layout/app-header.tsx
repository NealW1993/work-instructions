"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookmarkPlus,
  Download,
  CircleAlert,
  ChevronDown,
  LayoutGrid,
  RefreshCw,
  Save,
  Undo2,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { UserAccountMenu } from "@/components/layout/user-account-menu";
import {
  DASHBOARD_LAYOUT_COMMAND_EVENT,
  DASHBOARD_LAYOUT_DEFAULT_STATE,
  DASHBOARD_LAYOUT_MENU_INTENT_KEY,
  DASHBOARD_LAYOUT_MENU_INTENT_OPEN_CUSTOMIZE,
  DASHBOARD_LAYOUT_STATE_EVENT,
  type DashboardLayoutCommand,
  type DashboardLayoutCommandEventDetail,
  type DashboardLayoutStateEventDetail,
} from "@/lib/dashboard-controls";
import { canEditInstructions, isSystemAdmin } from "@/lib/roles";
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

const DASHBOARD_RETURN_STATE_KEY = "__dashboardInstructionReturnState";
const MENU_ANIMATION_MS = 260;

function isActivePath(pathname: string, href: string) {
  if (href === "/admin/users" && pathname.startsWith("/admin/")) {
    return true;
  }

  if (pathname === href) {
    return true;
  }

  return pathname.startsWith(`${href}/`);
}

export function AppHeader({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const router = useRouter();
  const [dashboardMenuOpen, setDashboardMenuOpen] = useState(false);
  const [dashboardMenuPathname, setDashboardMenuPathname] = useState(pathname);
  const [dashboardMenuMounted, setDashboardMenuMounted] = useState(false);
  const [dashboardMenuEntered, setDashboardMenuEntered] = useState(false);
  const [dashboardMenuWidth, setDashboardMenuWidth] = useState(300);
  const [instructionMenuOpen, setInstructionMenuOpen] = useState(false);
  const [instructionMenuPathname, setInstructionMenuPathname] = useState(pathname);
  const [instructionMenuMounted, setInstructionMenuMounted] = useState(false);
  const [instructionMenuEntered, setInstructionMenuEntered] = useState(false);
  const [dashboardLayoutState, setDashboardLayoutState] = useState(
    DASHBOARD_LAYOUT_DEFAULT_STATE,
  );
  const dashboardMenuCloseTimeoutRef = useRef<number | null>(null);
  const instructionMenuCloseTimeoutRef = useRef<number | null>(null);

  const canCreateInstructions = canEditInstructions(profile.role);
  const canViewArchivedInstructions = isSystemAdmin(profile.role);
  const isDashboardActive = isActivePath(pathname, "/dashboard");
  const isNewInstructionActive = isActivePath(pathname, "/instructions/new");
  const isArchivedInstructionActive = isActivePath(pathname, "/instructions/archived");
  const instructionControlActive = isNewInstructionActive || isArchivedInstructionActive;
  const activeDashboardLayoutState = isDashboardActive
    ? dashboardLayoutState
    : DASHBOARD_LAYOUT_DEFAULT_STATE;
  const dashboardMenuVisible =
    dashboardMenuOpen && dashboardMenuPathname === pathname;
  const instructionMenuVisible =
    canViewArchivedInstructions &&
    instructionMenuOpen &&
    instructionMenuPathname === pathname;
  const canSendDashboardLayoutActions =
    isDashboardActive && activeDashboardLayoutState.available;
  const showLayoutSaveActions =
    canSendDashboardLayoutActions && activeDashboardLayoutState.layoutDirty;
  const showSaveLayoutAsDefaultAction =
    canSendDashboardLayoutActions && activeDashboardLayoutState.customizeOpen;
  const canSaveLayout =
    showLayoutSaveActions &&
    activeDashboardLayoutState.layoutDirty &&
    !activeDashboardLayoutState.layoutSaving;
  const canSaveLayoutAsDefault =
    showSaveLayoutAsDefaultAction && !activeDashboardLayoutState.layoutSaving;
  const canDiscardLayout =
    showLayoutSaveActions &&
    activeDashboardLayoutState.layoutDirty &&
    !activeDashboardLayoutState.layoutSaving;
  const canLoadDefault =
    canSendDashboardLayoutActions && !activeDashboardLayoutState.layoutSaving;
  const canResetLayout =
    canSendDashboardLayoutActions && !activeDashboardLayoutState.layoutSaving;
  const dashboardNeedsAttention =
    canSendDashboardLayoutActions &&
    (activeDashboardLayoutState.layoutDirty ||
      activeDashboardLayoutState.layoutSaving ||
      Boolean(activeDashboardLayoutState.layoutError));
  const customizeLabel =
    canSendDashboardLayoutActions && activeDashboardLayoutState.customizeOpen
      ? "Close Customize Panel"
      : "Customize Dashboard";

  const syncDashboardMenuWidth = useCallback(() => {
    if (typeof document === "undefined") {
      return;
    }

    const visibleDashboardRoot = [...document.querySelectorAll<HTMLElement>('[data-dashboard-menu-root="true"]')]
      .find((element) => element.offsetParent !== null);
    if (!visibleDashboardRoot) {
      return;
    }

    const visibleInstructionRoot = [...document.querySelectorAll<HTMLElement>('[data-instruction-menu-root="true"]')]
      .find((element) => element.offsetParent !== null);
    const dashboardRect = visibleDashboardRoot.getBoundingClientRect();
    const instructionRect = visibleInstructionRoot?.getBoundingClientRect() ?? null;
    const targetWidth =
      instructionRect && instructionRect.right > dashboardRect.left
        ? Math.round(instructionRect.right - dashboardRect.left)
        : 300;

    setDashboardMenuWidth(Math.max(targetWidth, 300));
  }, []);

  const closeDashboardMenu = useCallback(() => {
    if (!dashboardMenuMounted && !dashboardMenuOpen) {
      return;
    }

    if (dashboardMenuCloseTimeoutRef.current !== null) {
      window.clearTimeout(dashboardMenuCloseTimeoutRef.current);
      dashboardMenuCloseTimeoutRef.current = null;
    }

    setDashboardMenuEntered(false);
    setDashboardMenuOpen(false);

    dashboardMenuCloseTimeoutRef.current = window.setTimeout(() => {
      setDashboardMenuMounted(false);
      dashboardMenuCloseTimeoutRef.current = null;
    }, MENU_ANIMATION_MS);
  }, [dashboardMenuMounted, dashboardMenuOpen]);

  const openDashboardMenu = useCallback(() => {
    if (dashboardMenuCloseTimeoutRef.current !== null) {
      window.clearTimeout(dashboardMenuCloseTimeoutRef.current);
      dashboardMenuCloseTimeoutRef.current = null;
    }

    syncDashboardMenuWidth();
    setDashboardMenuPathname(pathname);
    setDashboardMenuMounted(true);
    setDashboardMenuOpen(true);
    window.requestAnimationFrame(() => {
      setDashboardMenuEntered(true);
    });
  }, [pathname, syncDashboardMenuWidth]);

  const closeInstructionMenu = useCallback(() => {
    if (!instructionMenuMounted && !instructionMenuOpen) {
      return;
    }

    if (instructionMenuCloseTimeoutRef.current !== null) {
      window.clearTimeout(instructionMenuCloseTimeoutRef.current);
      instructionMenuCloseTimeoutRef.current = null;
    }

    setInstructionMenuEntered(false);
    setInstructionMenuOpen(false);

    instructionMenuCloseTimeoutRef.current = window.setTimeout(() => {
      setInstructionMenuMounted(false);
      instructionMenuCloseTimeoutRef.current = null;
    }, MENU_ANIMATION_MS);
  }, [instructionMenuMounted, instructionMenuOpen]);

  const openInstructionMenu = useCallback(() => {
    if (instructionMenuCloseTimeoutRef.current !== null) {
      window.clearTimeout(instructionMenuCloseTimeoutRef.current);
      instructionMenuCloseTimeoutRef.current = null;
    }

    setInstructionMenuPathname(pathname);
    setInstructionMenuMounted(true);
    setInstructionMenuOpen(true);
    window.requestAnimationFrame(() => {
      setInstructionMenuEntered(true);
    });
  }, [pathname]);

  useEffect(() => {
    if (!dashboardMenuOpen || dashboardMenuPathname === pathname) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      closeDashboardMenu();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [closeDashboardMenu, dashboardMenuOpen, dashboardMenuPathname, pathname]);

  useEffect(() => {
    if (!instructionMenuOpen || instructionMenuPathname === pathname) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      closeInstructionMenu();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [closeInstructionMenu, instructionMenuOpen, instructionMenuPathname, pathname]);

  useEffect(() => {
    if (!dashboardMenuMounted) {
      return;
    }

    const onWindowResize = () => {
      syncDashboardMenuWidth();
    };
    const frameId = window.requestAnimationFrame(syncDashboardMenuWidth);
    window.addEventListener("resize", onWindowResize);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onWindowResize);
    };
  }, [dashboardMenuMounted, syncDashboardMenuWidth]);

  useEffect(
    () => () => {
      if (dashboardMenuCloseTimeoutRef.current !== null) {
        window.clearTimeout(dashboardMenuCloseTimeoutRef.current);
      }
      if (instructionMenuCloseTimeoutRef.current !== null) {
        window.clearTimeout(instructionMenuCloseTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const handleDashboardLayoutState = (event: Event) => {
      const detail = (event as CustomEvent<DashboardLayoutStateEventDetail>).detail;
      if (!detail || typeof detail.available !== "boolean") {
        return;
      }

      setDashboardLayoutState({
        available: detail.available,
        customizeOpen: Boolean(detail.customizeOpen),
        layoutDirty: Boolean(detail.layoutDirty),
        layoutSaving: Boolean(detail.layoutSaving),
        layoutError: detail.layoutError ?? null,
      });
    };

    window.addEventListener(
      DASHBOARD_LAYOUT_STATE_EVENT,
      handleDashboardLayoutState as EventListener,
    );
    return () => {
      window.removeEventListener(
        DASHBOARD_LAYOUT_STATE_EVENT,
        handleDashboardLayoutState as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    if (!dashboardMenuVisible && !instructionMenuVisible) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest('[data-dashboard-menu-root="true"]') ||
        target?.closest('[data-instruction-menu-root="true"]')
      ) {
        return;
      }

      closeDashboardMenu();
      closeInstructionMenu();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDashboardMenu();
        closeInstructionMenu();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeDashboardMenu, closeInstructionMenu, dashboardMenuVisible, instructionMenuVisible]);

  const clearDashboardInstructionReturnState = useCallback(() => {
    try {
      window.sessionStorage.removeItem(DASHBOARD_RETURN_STATE_KEY);
    } catch {
      // Session storage cleanup is best-effort.
    }
  }, []);

  const handleDashboardLinkClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (event.defaultPrevented || event.button !== 0) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      clearDashboardInstructionReturnState();
      closeDashboardMenu();
      closeInstructionMenu();

      if (!isDashboardActive) {
        return;
      }

      event.preventDefault();
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: "auto",
      });
    },
    [clearDashboardInstructionReturnState, closeDashboardMenu, closeInstructionMenu, isDashboardActive],
  );

  const triggerDashboardAction = useCallback(
    (command: DashboardLayoutCommand) => {
      if (isDashboardActive) {
        if (command === "toggle-customize" && !dashboardLayoutState.available) {
          try {
            window.sessionStorage.setItem(
              DASHBOARD_LAYOUT_MENU_INTENT_KEY,
              DASHBOARD_LAYOUT_MENU_INTENT_OPEN_CUSTOMIZE,
            );
          } catch {
            // Menu intent persistence is best-effort.
          }
        }

        window.dispatchEvent(
          new CustomEvent<DashboardLayoutCommandEventDetail>(
            DASHBOARD_LAYOUT_COMMAND_EVENT,
            {
              detail: { command },
            },
          ),
        );
        return;
      }

      if (command === "toggle-customize") {
        try {
          window.sessionStorage.setItem(
            DASHBOARD_LAYOUT_MENU_INTENT_KEY,
            DASHBOARD_LAYOUT_MENU_INTENT_OPEN_CUSTOMIZE,
          );
        } catch {
          // Menu intent persistence is best-effort.
        }
      }

      clearDashboardInstructionReturnState();
      router.push("/dashboard");
    },
    [clearDashboardInstructionReturnState, dashboardLayoutState.available, isDashboardActive, router],
  );

  const handleDashboardAction = useCallback(
    (command: DashboardLayoutCommand) => {
      triggerDashboardAction(command);
      closeDashboardMenu();
      closeInstructionMenu();
    },
    [closeDashboardMenu, closeInstructionMenu, triggerDashboardAction],
  );

  const renderDashboardControl = (mobile: boolean) => (
    <div
      data-dashboard-menu-root="true"
      className={cn("relative inline-flex", mobile ? "max-w-full" : "")}
    >
      <Link
        href="/dashboard"
        onClick={handleDashboardLinkClick}
        className={cn(
          "inline-flex items-center rounded-l-xl border border-r-0 px-4 py-2 text-sm font-semibold transition",
          isDashboardActive
            ? "border-cyan-500/55 bg-cyan-500/15 text-cyan-900 shadow-sm dark:text-cyan-100"
            : "border-slate-300/70 bg-white/70 text-slate-700 hover:border-cyan-400/60 hover:bg-cyan-500/10 dark:border-slate-700 dark:bg-slate-900/65 dark:text-slate-100 dark:hover:border-cyan-500/50 dark:hover:bg-cyan-500/10",
        )}
      >
        Dashboard
      </Link>

      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={dashboardMenuVisible}
        aria-label={
          dashboardNeedsAttention
            ? "Open dashboard options. Action required."
            : "Open dashboard options"
        }
        onClick={() => {
          if (dashboardMenuVisible) {
            closeDashboardMenu();
            return;
          }

          closeInstructionMenu();
          openDashboardMenu();
        }}
        className={cn(
          "relative inline-flex items-center rounded-r-xl border px-2.5 py-2 transition",
          isDashboardActive
            ? "border-cyan-500/55 bg-cyan-500/15 text-cyan-900 hover:bg-cyan-500/25 dark:text-cyan-100 dark:hover:bg-cyan-500/25"
            : "border-slate-300/70 bg-white/70 text-slate-700 hover:border-cyan-400/60 hover:bg-cyan-500/10 dark:border-slate-700 dark:bg-slate-900/65 dark:text-slate-100 dark:hover:border-cyan-500/50 dark:hover:bg-cyan-500/10",
        )}
      >
        {dashboardNeedsAttention ? (
          <span className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-amber-200/40 bg-amber-500 text-amber-950 shadow-lg">
            <CircleAlert size={11} />
          </span>
        ) : null}
        <ChevronDown
          size={14}
          className={cn("transition", dashboardMenuVisible ? "rotate-180" : "")}
        />
      </button>

      {dashboardMenuMounted ? (
        <div
          className={cn(
            "absolute top-[calc(100%+0.5rem)] z-[90] grid gap-2 rounded-2xl border border-white/20 bg-slate-950/95 p-2 shadow-2xl backdrop-blur-xl transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform",
            mobile ? "left-1/2 -translate-x-1/2" : "left-0",
            dashboardMenuEntered ? "pointer-events-auto" : "pointer-events-none",
          )}
          style={{
            width: `${dashboardMenuWidth}px`,
            maxWidth: mobile ? "94vw" : undefined,
            opacity: dashboardMenuEntered ? 1 : 0,
            filter: dashboardMenuEntered ? "blur(0px)" : "blur(6px)",
            transform: dashboardMenuEntered
              ? mobile
                ? "translateX(-50%) translateY(0px) scale(1)"
                : "translateY(0px) scale(1)"
              : mobile
                ? "translateX(-50%) translateY(-8px) scale(0.98)"
                : "translateY(-8px) scale(0.98)",
            transformOrigin: mobile ? "top center" : "top left",
          }}
        >
          <button
            type="button"
            onClick={() => handleDashboardAction("toggle-customize")}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25"
          >
            <LayoutGrid size={14} />
            {customizeLabel}
          </button>

          <button
            type="button"
            disabled={!canLoadDefault}
            onClick={() => handleDashboardAction("load-default")}
            className="inline-flex items-center gap-2 rounded-xl border border-sky-500/45 bg-sky-500/15 px-3 py-2 text-sm font-semibold text-sky-100 transition hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Download size={14} />
            Load Default Dashboard
          </button>

          {showLayoutSaveActions ? (
            <>
              <button
                type="button"
                disabled={!canSaveLayout}
                onClick={() => handleDashboardAction("save-layout")}
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/45 bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Save size={14} />
                {activeDashboardLayoutState.layoutSaving ? "Saving..." : "Save Layout"}
              </button>

              <button
                type="button"
                disabled={!canDiscardLayout}
                onClick={() => handleDashboardAction("discard-changes")}
                className="inline-flex items-center gap-2 rounded-xl border border-amber-500/45 bg-amber-500/15 px-3 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Undo2 size={14} />
                Discard Changes
              </button>
            </>
          ) : null}

          {showSaveLayoutAsDefaultAction ? (
            <button
              type="button"
              disabled={!canSaveLayoutAsDefault}
              onClick={() => handleDashboardAction("save-layout-default")}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <BookmarkPlus size={14} />
              Save Layout as Default
            </button>
          ) : null}

          <button
            type="button"
            disabled={!canResetLayout}
            onClick={() => handleDashboardAction("reset-defaults")}
            className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <RefreshCw size={14} />
            Reset Dashboard
          </button>

          <div className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-[11px] text-slate-300">
            {!isDashboardActive
              ? "Choose Customize Dashboard to jump into dashboard studio."
              : !activeDashboardLayoutState.available
                ? "Dashboard studio is loading."
              : activeDashboardLayoutState.layoutDirty
                ? "You have unsaved layout changes."
              : !activeDashboardLayoutState.customizeOpen
                ? "Open Customize Dashboard to edit layout and manage defaults."
              : activeDashboardLayoutState.layoutSaving
                  ? "Saving your layout..."
                  : "Layout and default are saved. Load Default Dashboard applies your saved default, and Reset Dashboard only resets the current layout."}
          </div>

          {activeDashboardLayoutState.layoutError ? (
            <p className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-[11px] text-rose-100">
              {activeDashboardLayoutState.layoutError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const renderInstructionControl = (mobile: boolean) => {
    if (!canCreateInstructions) {
      return null;
    }

    if (!canViewArchivedInstructions) {
      return (
        <Link
          href="/instructions/new"
          onClick={() => {
            closeDashboardMenu();
            closeInstructionMenu();
          }}
          className={cn(
            "inline-flex items-center rounded-xl border px-4 py-2 text-sm font-semibold transition",
            isNewInstructionActive
              ? "border-cyan-500/55 bg-cyan-500/15 text-cyan-900 shadow-sm dark:text-cyan-100"
              : "border-slate-300/70 bg-white/70 text-slate-700 hover:border-cyan-400/60 hover:bg-cyan-500/10 dark:border-slate-700 dark:bg-slate-900/65 dark:text-slate-100 dark:hover:border-cyan-500/50 dark:hover:bg-cyan-500/10",
          )}
        >
          New Instruction
        </Link>
      );
    }

    return (
      <div
        data-instruction-menu-root="true"
        className={cn("relative inline-flex", mobile ? "max-w-full" : "")}
      >
        <Link
          href="/instructions/new"
          onClick={() => {
            closeDashboardMenu();
            closeInstructionMenu();
          }}
          className={cn(
            "inline-flex items-center rounded-l-xl border border-r-0 px-4 py-2 text-sm font-semibold transition",
            instructionControlActive
              ? "border-cyan-500/55 bg-cyan-500/15 text-cyan-900 shadow-sm dark:text-cyan-100"
              : "border-slate-300/70 bg-white/70 text-slate-700 hover:border-cyan-400/60 hover:bg-cyan-500/10 dark:border-slate-700 dark:bg-slate-900/65 dark:text-slate-100 dark:hover:border-cyan-500/50 dark:hover:bg-cyan-500/10",
          )}
        >
          New Instruction
        </Link>

        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={instructionMenuVisible}
          aria-label="Open instruction options"
          onClick={() => {
            if (instructionMenuVisible) {
              closeInstructionMenu();
              return;
            }

            closeDashboardMenu();
            openInstructionMenu();
          }}
          className={cn(
            "inline-flex items-center rounded-r-xl border px-2.5 py-2 transition",
            instructionControlActive
              ? "border-cyan-500/55 bg-cyan-500/15 text-cyan-900 hover:bg-cyan-500/25 dark:text-cyan-100 dark:hover:bg-cyan-500/25"
              : "border-slate-300/70 bg-white/70 text-slate-700 hover:border-cyan-400/60 hover:bg-cyan-500/10 dark:border-slate-700 dark:bg-slate-900/65 dark:text-slate-100 dark:hover:border-cyan-500/50 dark:hover:bg-cyan-500/10",
          )}
        >
          <ChevronDown
            size={14}
            className={cn("transition", instructionMenuVisible ? "rotate-180" : "")}
          />
        </button>

        {instructionMenuMounted ? (
          <div
            className={cn(
              "absolute top-[calc(100%+0.5rem)] z-[90] grid gap-2 rounded-2xl border border-white/20 bg-slate-950/95 p-2 shadow-2xl backdrop-blur-xl transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform",
              mobile ? "left-1/2 w-[min(94vw,280px)]" : "left-0 w-[220px]",
              instructionMenuEntered ? "pointer-events-auto" : "pointer-events-none",
            )}
            style={{
              opacity: instructionMenuEntered ? 1 : 0,
              filter: instructionMenuEntered ? "blur(0px)" : "blur(6px)",
              transform: instructionMenuEntered
                ? mobile
                  ? "translateX(-50%) translateY(0px) scale(1)"
                  : "translateY(0px) scale(1)"
                : mobile
                  ? "translateX(-50%) translateY(-8px) scale(0.98)"
                  : "translateY(-8px) scale(0.98)",
              transformOrigin: mobile ? "top center" : "top left",
            }}
          >
            <Link
              href="/instructions/archived"
              onClick={() => closeInstructionMenu()}
              className={cn(
                "inline-flex items-center rounded-xl border px-3 py-2 text-sm font-semibold transition",
                isArchivedInstructionActive
                  ? "border-cyan-500/45 bg-cyan-500/20 text-cyan-100"
                  : "border-white/20 bg-white/10 text-slate-100 hover:bg-white/20",
              )}
            >
              Archived
            </Link>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <header className="sticky top-0 z-[80] border-b border-white/20 bg-white/75 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/70">
      <div className="mx-auto w-full max-w-7xl px-4 py-3 md:px-8">
        <div className="relative flex items-center justify-center md:justify-end">
          <Link
            href="/dashboard"
            onClick={handleDashboardLinkClick}
            aria-label="OMNI Technologies Dashboard"
            className="absolute left-0 hidden items-center rounded-lg px-1 py-1 transition hover:opacity-90 md:inline-flex"
          >
            <Image
              src="/omni-technologies-logo.svg"
              alt="OMNI Technologies"
              width={280}
              height={68}
              priority
              className="h-7 w-auto md:h-8"
            />
          </Link>
          <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-3 md:flex">
            {renderDashboardControl(false)}
            {renderInstructionControl(false)}
          </nav>
          <UserAccountMenu profile={profile} />
        </div>

        <nav className="mt-2 flex flex-wrap items-center justify-center gap-2 md:hidden">
          {renderDashboardControl(true)}
          {renderInstructionControl(true)}
        </nav>
      </div>
    </header>
  );
}
