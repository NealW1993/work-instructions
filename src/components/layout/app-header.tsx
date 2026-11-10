"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  Calculator,
  ChartNetwork,
  CircleAlert,
  ChevronDown,
  ClipboardList,
  LayoutGrid,
  UsersRound,
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
import { accessLevelLabel, canCreateInstructions, hasFullAccess } from "@/lib/roles";
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

const DASHBOARD_RETURN_STATE_KEY = "__dashboardInstructionReturnState";

function HeaderDate() {
  const [label, setLabel] = useState("");

  useEffect(() => {
    function update() {
      const now = new Date();
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const day = days[now.getDay()];
      const dd = String(now.getDate()).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const yyyy = now.getFullYear();
      setLabel(`${day} ${mm}/${dd}/${yyyy}`);
    }

    update();

    // Tablets may remain signed in for multiple shifts or sleep through midnight.
    const timerId = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timerId);
      window.removeEventListener("focus", update);
    };
  }, []);

  if (!label) return null;

  return (
    <span className="hidden select-none text-xs text-slate-500 dark:text-slate-400 xl:block">
      {label}
    </span>
  );
}
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

  const userCanCreateInstructions = canCreateInstructions(profile.role);
  const userHasFullAccess = hasFullAccess(profile.role);
  const accessLabel = accessLevelLabel(profile.role);
  const canViewArchivedInstructions = userHasFullAccess;
  const isDashboardActive = isActivePath(pathname, "/dashboard");
  const isDocCenterActive = isActivePath(pathname, "/doc-center");
  const isGroupsActive = isActivePath(pathname, "/groups");
  const isProcessDocumentsActive = isActivePath(pathname, "/process-documents");
  const isFormulaToolsActive = isActivePath(pathname, "/process-maps/formulas");
  const isProcessMapsActive =
    isActivePath(pathname, "/process-maps") && !isFormulaToolsActive;
  const isDashboardWorkspaceActive =
    isDashboardActive ||
    isDocCenterActive ||
    isGroupsActive ||
    isProcessDocumentsActive ||
    isProcessMapsActive ||
    isFormulaToolsActive;
  const isNewInstructionActive = isActivePath(pathname, "/instructions/new");
  const isImportInstructionActive = isActivePath(pathname, "/instructions/import");
  const isArchivedInstructionActive = isActivePath(pathname, "/instructions/archived");
  const instructionControlActive =
    isNewInstructionActive || isImportInstructionActive || isArchivedInstructionActive;
  const dashboardControlHref = isDocCenterActive
    ? "/doc-center"
    : isGroupsActive
    ? "/groups"
    : isProcessDocumentsActive
    ? "/process-documents"
    : isFormulaToolsActive
      ? "/process-maps/formulas"
      : isProcessMapsActive
      ? "/process-maps"
      : "/dashboard";
  const dashboardControlLabel = isDocCenterActive
    ? "Doc Center"
    : isGroupsActive
    ? "Groups"
    : isProcessDocumentsActive
    ? "Process Docs"
    : isFormulaToolsActive
      ? "Formula Tools"
      : isProcessMapsActive
      ? "Process Maps"
      : "Dashboard";
  const activeDashboardLayoutState = isDashboardActive
    ? dashboardLayoutState
    : DASHBOARD_LAYOUT_DEFAULT_STATE;
  const dashboardMenuVisible =
    dashboardMenuOpen && dashboardMenuPathname === pathname;
  const instructionMenuVisible =
    instructionMenuOpen &&
    instructionMenuPathname === pathname;
  const canSendDashboardLayoutActions =
    isDashboardActive && activeDashboardLayoutState.available;
  const dashboardNeedsAttention =
    canSendDashboardLayoutActions &&
    (activeDashboardLayoutState.layoutDirty ||
      activeDashboardLayoutState.layoutSaving ||
      Boolean(activeDashboardLayoutState.layoutError));
  const showDashboardStudioButton =
    canSendDashboardLayoutActions && activeDashboardLayoutState.customizeOpen;
  const studioNeedsAttention =
    showDashboardStudioButton &&
    (activeDashboardLayoutState.layoutDirty ||
      activeDashboardLayoutState.layoutSaving ||
      Boolean(activeDashboardLayoutState.layoutError));
  const dashboardNavigationItems = [
    {
      href: "/dashboard",
      label: "Dashboard",
      icon: LayoutGrid,
      active: isDashboardActive,
    },
    {
      href: "/doc-center",
      label: "Doc Center",
      icon: BookOpen,
      active: isDocCenterActive,
    },
    {
      href: "/process-documents",
      label: "Process Docs",
      icon: ClipboardList,
      active: isProcessDocumentsActive,
    },
    {
      href: "/process-maps",
      label: "Process Maps",
      icon: ChartNetwork,
      active: isProcessMapsActive,
    },
    {
      href: "/process-maps/formulas",
      label: "Formula Tools",
      icon: Calculator,
      active: isFormulaToolsActive,
    },
    {
      href: "/groups",
      label: "Groups",
      icon: UsersRound,
      active: isGroupsActive,
    },
  ];
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
        canUndoLayout: Boolean(detail.canUndoLayout),
        canRedoLayout: Boolean(detail.canRedoLayout),
        activeLayoutPresetId:
          typeof detail.activeLayoutPresetId === "string"
            ? detail.activeLayoutPresetId
            : null,
        layoutPresets: Array.isArray(detail.layoutPresets)
          ? detail.layoutPresets
          : [],
        studioWidgets: Array.isArray(detail.studioWidgets)
          ? detail.studioWidgets
          : [],
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
        const panel = document.activeElement?.closest<HTMLElement>("[data-header-panel]");
        const trigger = panel?.parentElement?.querySelector<HTMLButtonElement>("[data-menu-trigger]");
        closeDashboardMenu();
        closeInstructionMenu();
        trigger?.focus();
      }
    };

    document.addEventListener("pointerdown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [
    closeDashboardMenu,
    closeInstructionMenu,
    dashboardMenuVisible,
    instructionMenuVisible,
  ]);

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

      let targetPathname = "/dashboard";
      try {
        targetPathname = new URL(event.currentTarget.href, window.location.href).pathname;
      } catch {
        targetPathname = "/dashboard";
      }

      if (pathname !== targetPathname) {
        return;
      }

      event.preventDefault();
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: "auto",
      });
    },
    [
      clearDashboardInstructionReturnState,
      closeDashboardMenu,
      closeInstructionMenu,
      pathname,
    ],
  );

  const triggerDashboardAction = useCallback(
    (detail: DashboardLayoutCommandEventDetail) => {
      const command = detail.command;
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
              detail,
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
      triggerDashboardAction({ command });
      closeDashboardMenu();
      closeInstructionMenu();
    },
    [closeDashboardMenu, closeInstructionMenu, triggerDashboardAction],
  );

  const renderDashboardControl = (mobile: boolean) => {
    return (
      <div
        data-dashboard-menu-root="true"
        className={cn(mobile ? "inline-flex max-w-full" : "relative inline-flex")}
      >
        <Link
          href={dashboardControlHref}
          onClick={handleDashboardLinkClick}
          className={cn(
            "inline-flex items-center rounded-l-xl border border-r-0 px-4 py-2 text-sm font-semibold transition",
            isDashboardWorkspaceActive
              ? "border-cyan-700 bg-cyan-600 text-white shadow-sm dark:border-slate-200/70 dark:bg-slate-100 dark:text-slate-900"
              : "border-slate-300/70 bg-white/80 text-slate-700 hover:border-slate-400 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800",
          )}
        >
          {dashboardControlLabel}
        </Link>

        <button
          type="button"
          data-menu-trigger="true"
          aria-controls={`workspace-options-${mobile ? "mobile" : "desktop"}`}
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
            isDashboardWorkspaceActive
              ? "border-cyan-700 bg-cyan-600 text-white hover:bg-cyan-700 dark:border-slate-200/70 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
              : "border-slate-300/70 bg-white/80 text-slate-700 hover:border-slate-400 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800",
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
            id={`workspace-options-${mobile ? "mobile" : "desktop"}`}
            data-header-panel="true"
            inert={!dashboardMenuVisible}
            className={cn(
              "absolute top-[calc(100%+0.5rem)] z-[90] grid max-h-[72dvh] gap-2 overflow-y-auto overscroll-contain rounded-xl border border-white/20 bg-slate-950 p-2 shadow-xl transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              mobile ? "left-2 right-2" : "left-0",
              dashboardMenuEntered ? "pointer-events-auto" : "pointer-events-none",
            )}
            style={{
              ...(mobile ? {} : { width: `${dashboardMenuWidth}px` }),
              opacity: dashboardMenuEntered ? 1 : 0,
              filter: dashboardMenuEntered ? "blur(0px)" : "blur(6px)",
              transform: dashboardMenuEntered
                ? "translateY(0px) scale(1)"
                : "translateY(-8px) scale(0.98)",
              transformOrigin: mobile ? "top center" : "top left",
            }}
          >
            <section className="grid gap-1 rounded-xl border border-white/15 bg-white/5 p-2">
              <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Workspaces
              </p>
              {dashboardNavigationItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => {
                      closeDashboardMenu();
                      closeInstructionMenu();
                    }}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition",
                      item.active
                        ? "border-cyan-500/45 bg-cyan-500/20 text-cyan-100"
                        : "border-white/10 bg-white/5 text-slate-100 hover:bg-white/15",
                    )}
                    aria-current={item.active ? "page" : undefined}
                  >
                    <Icon size={14} />
                    {item.label}
                  </Link>
                );
              })}
            </section>

            <button
              type="button"
              onClick={() => handleDashboardAction("toggle-customize")}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25"
            >
              <LayoutGrid size={14} />
              {customizeLabel}
            </button>

            {activeDashboardLayoutState.layoutError ? (
              <p className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-[11px] text-rose-100">
                {activeDashboardLayoutState.layoutError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const renderDashboardStudioControl = () => {
    if (!showDashboardStudioButton) return null;

    const editorStatus = activeDashboardLayoutState.layoutSaving
      ? "Saving"
      : activeDashboardLayoutState.layoutError
        ? "Save failed"
        : activeDashboardLayoutState.layoutDirty
          ? "Unsaved"
          : "Saved";

    return (
      <button
        type="button"
        aria-controls="homepage-editor"
        aria-label={`Go to homepage editor. ${editorStatus}.`}
        onClick={() => {
          closeDashboardMenu();
          closeInstructionMenu();
          const editor = document.getElementById("homepage-editor");
          editor?.scrollIntoView({
            block: "start",
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          });
          editor?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
        }}
        className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border border-cyan-600 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-900 transition hover:bg-cyan-100 dark:border-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-100 dark:hover:bg-cyan-950/70"
      >
        <LayoutGrid size={15} aria-hidden="true" />
        <span>Homepage editor</span>
        <span className={cn(
          "rounded-full px-2 py-0.5 text-[10px] font-bold",
          studioNeedsAttention ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" : "bg-white text-cyan-800 dark:bg-slate-900 dark:text-cyan-300",
        )}>{editorStatus}</span>
      </button>
    );
  };

  const renderInstructionControl = (mobile: boolean) => {
    if (!userCanCreateInstructions) {
      return null;
    }

    return (
      <div
        data-instruction-menu-root="true"
        className={cn(mobile ? "inline-flex max-w-full" : "relative inline-flex")}
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
              ? "border-cyan-700 bg-cyan-600 text-white shadow-sm dark:border-slate-200/70 dark:bg-slate-100 dark:text-slate-900"
              : "border-slate-300/70 bg-white/80 text-slate-700 hover:border-slate-400 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800",
          )}
        >
          New Instruction
        </Link>

        <button
          type="button"
          data-menu-trigger="true"
          aria-controls={`instruction-options-${mobile ? "mobile" : "desktop"}`}
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
              ? "border-cyan-700 bg-cyan-600 text-white hover:bg-cyan-700 dark:border-slate-200/70 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
              : "border-slate-300/70 bg-white/80 text-slate-700 hover:border-slate-400 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800",
          )}
        >
          <ChevronDown
            size={14}
            className={cn("transition", instructionMenuVisible ? "rotate-180" : "")}
          />
        </button>

        {instructionMenuMounted ? (
          <div
            id={`instruction-options-${mobile ? "mobile" : "desktop"}`}
            data-header-panel="true"
            inert={!instructionMenuVisible}
            className={cn(
              "absolute top-[calc(100%+0.5rem)] z-[90] grid gap-2 rounded-2xl border border-white/20 bg-slate-950/95 p-2 shadow-2xl backdrop-blur-xl transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform",
              mobile ? "left-2 right-2" : "left-0 w-[220px]",
              instructionMenuEntered ? "pointer-events-auto" : "pointer-events-none",
            )}
            style={{
              opacity: instructionMenuEntered ? 1 : 0,
              filter: instructionMenuEntered ? "blur(0px)" : "blur(6px)",
              transform: instructionMenuEntered ? "translateY(0px) scale(1)" : "translateY(-8px) scale(0.98)",
              transformOrigin: mobile ? "top center" : "top left",
            }}
          >
            <Link
              href="/instructions/import"
              onClick={() => {
                closeDashboardMenu();
                closeInstructionMenu();
              }}
              className={cn(
                "inline-flex items-center rounded-xl border px-3 py-2 text-sm font-semibold transition",
                isImportInstructionActive
                  ? "border-cyan-500/45 bg-cyan-500/20 text-cyan-100"
                  : "border-white/20 bg-white/10 text-slate-100 hover:bg-white/20",
              )}
            >
              Import
            </Link>
            {canViewArchivedInstructions ? (
              <Link
                href="/instructions/archived"
                onClick={() => {
                  closeDashboardMenu();
                  closeInstructionMenu();
                }}
                className={cn(
                  "inline-flex items-center rounded-xl border px-3 py-2 text-sm font-semibold transition",
                  isArchivedInstructionActive
                    ? "border-cyan-500/45 bg-cyan-500/20 text-cyan-100"
                    : "border-white/20 bg-white/10 text-slate-100 hover:bg-white/20",
                )}
              >
                Archived
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <header className="sticky top-0 z-[80] border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur-sm print:hidden dark:border-slate-800 dark:bg-slate-950/95">
      <div className="relative z-10 mx-auto w-full max-w-[1600px] px-4 py-3 md:px-8">
        <div className="flex items-center justify-end gap-3">
          <div className="mr-auto flex items-center gap-3">
            <Link
              href="/dashboard"
              onClick={handleDashboardLinkClick}
              aria-label="Delta Dashboard"
              className="inline-flex items-center rounded-lg px-1 py-1 transition hover:opacity-90"
            >
              <Image
                src="/delta-logo.svg"
                alt="Delta"
                width={36}
                height={36}
                priority
                className="h-9 w-9"
              />
            </Link>
            <HeaderDate />
          </div>
          <nav aria-label="Workspace navigation" className="hidden items-center gap-2 xl:flex">
            {renderDashboardStudioControl()}
            {renderDashboardControl(false)}
            {renderInstructionControl(false)}
          </nav>
          <span
            className={cn(
              "hidden rounded-full border px-3 py-1 text-xs font-extrabold uppercase tracking-wide xl:inline-flex",
              userHasFullAccess
                ? "border-emerald-500/35 bg-emerald-500/15 text-emerald-800 dark:text-emerald-100"
                : "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-100",
            )}
          >
            {accessLabel}
          </span>
          <UserAccountMenu profile={profile} />
        </div>

        <nav aria-label="Mobile workspace navigation" className="relative mt-2 flex flex-wrap items-center justify-center gap-2 xl:hidden">
          {renderDashboardStudioControl()}
          {renderDashboardControl(true)}
          {renderInstructionControl(true)}
          <span
            className={cn(
              "inline-flex rounded-full border px-3 py-1 text-xs font-extrabold uppercase tracking-wide",
              userHasFullAccess
                ? "border-emerald-500/35 bg-emerald-500/15 text-emerald-800 dark:text-emerald-100"
                : "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-100",
            )}
          >
            {accessLabel}
          </span>
        </nav>
      </div>
    </header>
  );
}
