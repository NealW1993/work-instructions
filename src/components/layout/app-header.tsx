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
  Redo2,
  RefreshCw,
  Save,
  Undo2,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
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
import {
  DASHBOARD_LAYOUT_PRESETS,
  type DashboardWidgetLayoutItem,
  type DashboardWidgetSize,
} from "@/lib/dashboard-layout";
import { canEditInstructions, isSystemAdmin } from "@/lib/roles";
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
      setLabel(`${day} ${dd}/${mm}/${yyyy}`);
    }

    update();

    // Refresh the label at midnight so it stays accurate.
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const timerId = setTimeout(update, tomorrow.getTime() - now.getTime());
    return () => clearTimeout(timerId);
  }, []);

  if (!label) return null;

  return (
    <span className="hidden select-none text-sm font-medium text-slate-900 dark:text-white/75 md:block">
      {label}
    </span>
  );
}
const MENU_ANIMATION_MS = 260;
const HEADER_BACKGROUND_PLAYBACK_RATE = 0.45;
function applyHeaderVideoPlaybackRate(video: HTMLVideoElement) {
  video.defaultPlaybackRate = HEADER_BACKGROUND_PLAYBACK_RATE;
  video.playbackRate = HEADER_BACKGROUND_PLAYBACK_RATE;
}

function isActivePath(pathname: string, href: string) {
  if (href === "/admin/users" && pathname.startsWith("/admin/")) {
    return true;
  }

  if (pathname === href) {
    return true;
  }

  return pathname.startsWith(`${href}/`);
}

function getPresetPreviewSpanValue(size: DashboardWidgetSize) {
  switch (size) {
    case "compact":
      return 2;
    case "standard":
      return 3;
    case "wide":
      return 4;
    case "full":
    default:
      return 6;
  }
}

function buildPresetPreviewRows(
  presetId: string,
  layout: DashboardWidgetLayoutItem[],
) {
  const rows: Array<Array<{ key: string; span: number }>> = [];
  let currentRow: Array<{ key: string; span: number }> = [];
  let consumedColumns = 0;

  layout
    .filter((entry) => entry.visible)
    .forEach((entry, index) => {
      const span = getPresetPreviewSpanValue(entry.size);
      if (consumedColumns > 0 && consumedColumns + span > 6) {
        const remaining = 6 - consumedColumns;
        if (remaining > 0 && currentRow.length > 0) {
          const lastCell = currentRow[currentRow.length - 1];
          if (lastCell) {
            lastCell.span += remaining;
          }
        }
        rows.push(currentRow);
        currentRow = [];
        consumedColumns = 0;
      }

      currentRow.push({
        key: `${presetId}-${entry.id}-${index}`,
        span,
      });
      consumedColumns += span;

      if (consumedColumns === 6) {
        rows.push(currentRow);
        currentRow = [];
        consumedColumns = 0;
      }
    });

  if (currentRow.length > 0) {
    const remaining = 6 - consumedColumns;
    if (remaining > 0) {
      const lastCell = currentRow[currentRow.length - 1];
      if (lastCell) {
        lastCell.span += remaining;
      }
    }
    rows.push(currentRow);
  }

  return rows;
}

export function AppHeader({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const router = useRouter();
  const [dashboardMenuOpen, setDashboardMenuOpen] = useState(false);
  const [dashboardMenuPathname, setDashboardMenuPathname] = useState(pathname);
  const [dashboardMenuMounted, setDashboardMenuMounted] = useState(false);
  const [dashboardMenuEntered, setDashboardMenuEntered] = useState(false);
  const [dashboardMenuWidth, setDashboardMenuWidth] = useState(300);
  const [studioMenuOpen, setStudioMenuOpen] = useState(false);
  const [studioMenuPathname, setStudioMenuPathname] = useState(pathname);
  const [studioMenuMounted, setStudioMenuMounted] = useState(false);
  const [studioMenuEntered, setStudioMenuEntered] = useState(false);
  const [studioMenuWidth, setStudioMenuWidth] = useState(620);
  const [studioLayoutPresetsCollapsed, setStudioLayoutPresetsCollapsed] =
    useState(true);
  const [studioWidgetLibraryCollapsed, setStudioWidgetLibraryCollapsed] =
    useState(true);
  const [studioKpiWidgetsCollapsed, setStudioKpiWidgetsCollapsed] =
    useState(true);
  const [studioExpandedPresetId, setStudioExpandedPresetId] = useState<string | null>(
    null,
  );
  const [instructionMenuOpen, setInstructionMenuOpen] = useState(false);
  const [instructionMenuPathname, setInstructionMenuPathname] = useState(pathname);
  const [instructionMenuMounted, setInstructionMenuMounted] = useState(false);
  const [instructionMenuEntered, setInstructionMenuEntered] = useState(false);
  const [dashboardLayoutState, setDashboardLayoutState] = useState(
    DASHBOARD_LAYOUT_DEFAULT_STATE,
  );
  const dashboardMenuCloseTimeoutRef = useRef<number | null>(null);
  const studioMenuCloseTimeoutRef = useRef<number | null>(null);
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
  const studioMenuVisible = studioMenuOpen && studioMenuPathname === pathname;
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
  const canUndoLayout =
    canSendDashboardLayoutActions &&
    activeDashboardLayoutState.canUndoLayout &&
    !activeDashboardLayoutState.layoutSaving;
  const canRedoLayout =
    canSendDashboardLayoutActions &&
    activeDashboardLayoutState.canRedoLayout &&
    !activeDashboardLayoutState.layoutSaving;
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
  const studioCoreWidgets = activeDashboardLayoutState.studioWidgets.filter(
    (widget) => widget.category === "core",
  );
  const studioKpiWidgets = activeDashboardLayoutState.studioWidgets.filter(
    (widget) => widget.category === "kpi",
  );
  const dashboardLayoutPresetsById = useMemo(
    () => new Map(DASHBOARD_LAYOUT_PRESETS.map((preset) => [preset.id, preset])),
    [],
  );
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

  const syncStudioMenuWidth = useCallback(() => {
    if (typeof document === "undefined") {
      return;
    }

    const visibleStudioRoot = [
      ...document.querySelectorAll<HTMLElement>('[data-dashboard-studio-root="true"]'),
    ].find((element) => element.offsetParent !== null);
    if (!visibleStudioRoot) {
      return;
    }

    const visibleInstructionRoot = [
      ...document.querySelectorAll<HTMLElement>('[data-instruction-menu-root="true"]'),
    ].find((element) => element.offsetParent !== null);
    const studioRect = visibleStudioRoot.getBoundingClientRect();
    const instructionRect = visibleInstructionRoot?.getBoundingClientRect() ?? null;
    const targetWidth =
      instructionRect && instructionRect.right > studioRect.left
        ? Math.round(instructionRect.right - studioRect.left)
        : 620;
    const viewportMaxWidth = Math.max(320, Math.round(window.innerWidth - 24));
    const normalizedWidth = Math.min(Math.max(targetWidth, 600), viewportMaxWidth);

    setStudioMenuWidth(normalizedWidth);
  }, []);

  const scrollStudioMenuToBottom = useCallback(() => {
    if (typeof document === "undefined") {
      return;
    }

    const scrollVisibleStudioMenu = () => {
      const visibleStudioMenu = [
        ...document.querySelectorAll<HTMLElement>('[data-dashboard-studio-menu="true"]'),
      ].find((element) => element.offsetParent !== null);
      if (!visibleStudioMenu) {
        return;
      }

      visibleStudioMenu.scrollTo({
        top: visibleStudioMenu.scrollHeight,
        behavior: "smooth",
      });
    };

    window.requestAnimationFrame(() => {
      scrollVisibleStudioMenu();
      window.setTimeout(scrollVisibleStudioMenu, 90);
    });
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

  const closeStudioMenu = useCallback(() => {
    if (!studioMenuMounted && !studioMenuOpen) {
      return;
    }

    if (studioMenuCloseTimeoutRef.current !== null) {
      window.clearTimeout(studioMenuCloseTimeoutRef.current);
      studioMenuCloseTimeoutRef.current = null;
    }

    setStudioMenuEntered(false);
    setStudioMenuOpen(false);

    studioMenuCloseTimeoutRef.current = window.setTimeout(() => {
      setStudioMenuMounted(false);
      studioMenuCloseTimeoutRef.current = null;
    }, MENU_ANIMATION_MS);
  }, [studioMenuMounted, studioMenuOpen]);

  const openStudioMenu = useCallback(() => {
    if (studioMenuCloseTimeoutRef.current !== null) {
      window.clearTimeout(studioMenuCloseTimeoutRef.current);
      studioMenuCloseTimeoutRef.current = null;
    }

    syncStudioMenuWidth();
    setStudioLayoutPresetsCollapsed(true);
    setStudioWidgetLibraryCollapsed(true);
    setStudioKpiWidgetsCollapsed(true);
    setStudioExpandedPresetId(null);
    setStudioMenuPathname(pathname);
    setStudioMenuMounted(true);
    setStudioMenuOpen(true);
    window.requestAnimationFrame(() => {
      setStudioMenuEntered(true);
    });
  }, [pathname, syncStudioMenuWidth]);

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
    if (!studioMenuOpen || studioMenuPathname === pathname) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      closeStudioMenu();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [closeStudioMenu, pathname, studioMenuOpen, studioMenuPathname]);

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

  useEffect(() => {
    if (!studioMenuMounted) {
      return;
    }

    const onWindowResize = () => {
      syncStudioMenuWidth();
    };
    const frameId = window.requestAnimationFrame(syncStudioMenuWidth);
    window.addEventListener("resize", onWindowResize);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onWindowResize);
    };
  }, [studioMenuMounted, syncStudioMenuWidth]);

  useEffect(
    () => () => {
      if (dashboardMenuCloseTimeoutRef.current !== null) {
        window.clearTimeout(dashboardMenuCloseTimeoutRef.current);
      }
      if (studioMenuCloseTimeoutRef.current !== null) {
        window.clearTimeout(studioMenuCloseTimeoutRef.current);
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
    if (!dashboardMenuVisible && !instructionMenuVisible && !studioMenuVisible) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest('[data-dashboard-menu-root="true"]') ||
        target?.closest('[data-dashboard-studio-root="true"]') ||
        target?.closest('[data-instruction-menu-root="true"]')
      ) {
        return;
      }

      closeDashboardMenu();
      closeStudioMenu();
      closeInstructionMenu();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDashboardMenu();
        closeStudioMenu();
        closeInstructionMenu();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [
    closeDashboardMenu,
    closeInstructionMenu,
    closeStudioMenu,
    dashboardMenuVisible,
    instructionMenuVisible,
    studioMenuVisible,
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
      closeStudioMenu();
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
    [
      clearDashboardInstructionReturnState,
      closeDashboardMenu,
      closeInstructionMenu,
      closeStudioMenu,
      isDashboardActive,
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
      closeStudioMenu();
      closeInstructionMenu();
    },
    [closeDashboardMenu, closeInstructionMenu, closeStudioMenu, triggerDashboardAction],
  );

  const handleDashboardStudioAction = useCallback(
    (
      detail: DashboardLayoutCommandEventDetail,
      options?: { closeStudioMenuAfterAction?: boolean },
    ) => {
      triggerDashboardAction(detail);
      closeDashboardMenu();
      closeInstructionMenu();
      if (options?.closeStudioMenuAfterAction ?? false) {
        closeStudioMenu();
      }
    },
    [
      closeDashboardMenu,
      closeInstructionMenu,
      closeStudioMenu,
      triggerDashboardAction,
    ],
  );

  const renderDashboardControl = (mobile: boolean) => {
    if (showDashboardStudioButton) {
      return null;
    }

    return (
      <div
        data-dashboard-menu-root="true"
        className={cn(mobile ? "inline-flex max-w-full" : "relative inline-flex")}
      >
        <Link
          href="/dashboard"
          onClick={handleDashboardLinkClick}
          className={cn(
            "inline-flex items-center rounded-l-xl border border-r-0 px-4 py-2 text-sm font-semibold transition",
            isDashboardActive
              ? "border-cyan-700 bg-cyan-600 text-white shadow-sm dark:border-slate-200/70 dark:bg-slate-100 dark:text-slate-900"
              : "border-slate-300/70 bg-white/80 text-slate-700 hover:border-slate-400 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800",
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

            closeStudioMenu();
            closeInstructionMenu();
            openDashboardMenu();
          }}
          className={cn(
            "relative inline-flex items-center rounded-r-xl border px-2.5 py-2 transition",
            isDashboardActive
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
            className={cn(
              "absolute top-[calc(100%+0.5rem)] z-[90] grid gap-2 rounded-2xl border border-white/20 bg-slate-950/95 p-2 shadow-2xl backdrop-blur-xl transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform",
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

  const renderDashboardStudioControl = (mobile: boolean) => {
    if (!showDashboardStudioButton) {
      return null;
    }

    return (
      <div
        data-dashboard-studio-root="true"
        className={cn(mobile ? "inline-flex max-w-full" : "relative inline-flex")}
      >
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={studioMenuVisible}
          aria-label={
            studioNeedsAttention
              ? "Open dashboard studio options. Action required."
              : "Open dashboard studio options"
          }
          onClick={() => {
            if (studioMenuVisible) {
              closeStudioMenu();
              return;
            }

            closeDashboardMenu();
            closeInstructionMenu();
            openStudioMenu();
          }}
          className="relative inline-flex items-center gap-2 rounded-xl border border-cyan-700 bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-700 dark:border-slate-200/70 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
        >
          {studioNeedsAttention ? (
            <span className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-amber-200/40 bg-amber-500 text-amber-950 shadow-lg">
              <CircleAlert size={11} />
            </span>
          ) : null}
          <LayoutGrid size={14} />
          <span>Dashboard Studio</span>
          <ChevronDown
            size={14}
            className={cn("transition", studioMenuVisible ? "rotate-180" : "")}
          />
        </button>

        {studioMenuMounted ? (
          <div
            data-dashboard-studio-menu="true"
            className={cn(
              "absolute top-[calc(100%+0.5rem)] z-[90] grid max-h-[74vh] gap-2 overflow-y-auto rounded-2xl border border-white/20 bg-slate-950/95 p-2 shadow-2xl backdrop-blur-xl transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform",
              mobile ? "left-2 right-2" : "right-0",
              studioMenuEntered ? "pointer-events-auto" : "pointer-events-none",
            )}
            style={{
              ...(mobile
                ? {}
                : { width: `${studioMenuWidth}px`, maxWidth: "calc(100vw - 16px)" }),
              opacity: studioMenuEntered ? 1 : 0,
              filter: studioMenuEntered ? "blur(0px)" : "blur(6px)",
              transform: studioMenuEntered
                ? "translateY(0px) scale(1)"
                : "translateY(-8px) scale(0.98)",
              transformOrigin: mobile ? "top center" : "top right",
            }}
          >
            <section className="order-2 grid gap-2 rounded-xl border border-white/15 bg-white/5 p-2">
              <button
                type="button"
                onClick={() => {
                  const nextCollapsed = !studioLayoutPresetsCollapsed;
                  setStudioLayoutPresetsCollapsed(nextCollapsed);
                }}
                className="inline-flex items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-left transition hover:bg-cyan-500/10"
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-200">
                  Layout Presets
                </span>
                <ChevronDown
                  size={13}
                  className={cn(
                    "text-slate-300 transition",
                    studioLayoutPresetsCollapsed ? "" : "rotate-180",
                  )}
                />
              </button>
              {studioLayoutPresetsCollapsed ? null : (
                <div className="grid gap-2">
                  {activeDashboardLayoutState.layoutPresets.map((preset) => {
                    const isExpanded = studioExpandedPresetId === preset.id;
                    const presetDefinition = dashboardLayoutPresetsById.get(preset.id);
                    const previewRows = presetDefinition
                      ? buildPresetPreviewRows(preset.id, presetDefinition.layout)
                      : [];

                    return (
                      <article
                        key={preset.id}
                        className="grid gap-2 rounded-lg border border-white/20 bg-white/10 p-2"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            const nextExpandedPresetId =
                              studioExpandedPresetId === preset.id ? null : preset.id;
                            setStudioExpandedPresetId(nextExpandedPresetId);
                          }}
                          className="inline-flex items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-left transition hover:bg-white/10"
                        >
                          <span className="text-xs font-semibold text-slate-100">
                            {preset.label}
                          </span>
                          <div className="inline-flex items-center gap-2">
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                                activeDashboardLayoutState.activeLayoutPresetId === preset.id
                                  ? "bg-cyan-500/20 text-cyan-100"
                                  : "bg-slate-500/20 text-slate-200",
                              )}
                            >
                              {activeDashboardLayoutState.activeLayoutPresetId === preset.id
                                ? "Active"
                                : "Preset"}
                            </span>
                            <ChevronDown
                              size={13}
                              className={cn(
                                "text-slate-300 transition",
                                isExpanded ? "rotate-180" : "",
                              )}
                            />
                          </div>
                        </button>

                        {isExpanded ? (
                          <div className="grid gap-2 border-t border-white/10 pt-2">
                            {previewRows.length === 0 ? (
                              <p className="rounded-lg border border-white/15 bg-white/5 px-2 py-2 text-[11px] text-slate-300">
                                Preview unavailable for this preset.
                              </p>
                            ) : (
                              <div className="grid gap-1 rounded-lg border border-white/20 bg-slate-900/75 p-2">
                                {previewRows.map((row, rowIndex) => (
                                  <div
                                    key={`${preset.id}-row-${rowIndex}`}
                                    className="grid grid-cols-6 gap-1"
                                  >
                                    {row.map((cell) => (
                                      <span
                                        key={cell.key}
                                        className="h-2 rounded-sm bg-cyan-400/80"
                                        style={{
                                          gridColumn: `span ${cell.span} / span ${cell.span}`,
                                        }}
                                      />
                                    ))}
                                  </div>
                                ))}
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                handleDashboardStudioAction(
                                  {
                                    command: "apply-layout-preset",
                                    presetId: preset.id,
                                  },
                                  { closeStudioMenuAfterAction: false },
                                )
                              }
                              className="inline-flex items-center justify-center rounded-lg border border-cyan-500/45 bg-cyan-500/20 px-2.5 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/30"
                            >
                              Load Layout
                            </button>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="order-3 grid gap-2 rounded-xl border border-white/15 bg-white/5 p-2">
              <button
                type="button"
                onClick={() => {
                  const nextCollapsed = !studioWidgetLibraryCollapsed;
                  setStudioWidgetLibraryCollapsed(nextCollapsed);
                  if (!nextCollapsed) {
                    scrollStudioMenuToBottom();
                  }
                }}
                className="inline-flex items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-left transition hover:bg-cyan-500/10"
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-200">
                  Widget Library
                </span>
                <ChevronDown
                  size={13}
                  className={cn(
                    "text-slate-300 transition",
                    studioWidgetLibraryCollapsed ? "" : "rotate-180",
                  )}
                />
              </button>
              {studioWidgetLibraryCollapsed ? null : (
                <div className="grid max-h-52 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {studioCoreWidgets.map((widget) => (
                    <article
                      key={widget.id}
                      className="grid gap-2 rounded-lg border border-white/20 bg-white/10 p-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-slate-100">{widget.title}</p>
                          <p className="text-[11px] text-slate-300">{widget.description}</p>
                        </div>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            widget.visible
                              ? "bg-emerald-500/20 text-emerald-200"
                              : "bg-slate-500/20 text-slate-300",
                          )}
                        >
                          {widget.visible ? "Visible" : "Hidden"}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleDashboardStudioAction(
                              {
                                command: "set-widget-visibility",
                                widgetId: widget.id,
                                visible: !widget.visible,
                              },
                              { closeStudioMenuAfterAction: false },
                            )
                          }
                          className={cn(
                            "rounded-lg border px-2 py-1 text-xs font-semibold transition",
                            widget.visible
                              ? "border-rose-500/40 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25"
                              : "border-emerald-500/40 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25",
                          )}
                        >
                          {widget.visible ? "Remove" : "Add"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="order-4 grid gap-2 rounded-xl border border-white/15 bg-white/5 p-2">
              <button
                type="button"
                onClick={() => {
                  const nextCollapsed = !studioKpiWidgetsCollapsed;
                  setStudioKpiWidgetsCollapsed(nextCollapsed);
                  if (!nextCollapsed) {
                    scrollStudioMenuToBottom();
                  }
                }}
                className="inline-flex items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-left transition hover:bg-cyan-500/10"
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-200">
                  KPI Widgets
                </span>
                <ChevronDown
                  size={13}
                  className={cn(
                    "text-slate-300 transition",
                    studioKpiWidgetsCollapsed ? "" : "rotate-180",
                  )}
                />
              </button>
              {studioKpiWidgetsCollapsed ? null : (
                <div className="grid max-h-52 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {studioKpiWidgets.map((widget) => (
                    <article
                      key={widget.id}
                      className="grid gap-2 rounded-lg border border-white/20 bg-white/10 p-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-slate-100">{widget.title}</p>
                          <p className="text-[11px] text-slate-300">{widget.description}</p>
                        </div>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            widget.visible
                              ? "bg-emerald-500/20 text-emerald-200"
                              : "bg-slate-500/20 text-slate-300",
                          )}
                        >
                          {widget.visible ? "Visible" : "Hidden"}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleDashboardStudioAction(
                              {
                                command: "set-widget-visibility",
                                widgetId: widget.id,
                                visible: !widget.visible,
                              },
                              { closeStudioMenuAfterAction: false },
                            )
                          }
                          className={cn(
                            "rounded-lg border px-2 py-1 text-xs font-semibold transition",
                            widget.visible
                              ? "border-rose-500/40 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25"
                              : "border-emerald-500/40 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25",
                          )}
                        >
                          {widget.visible ? "Remove" : "Add"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="order-1 grid gap-2 rounded-xl border border-white/15 bg-white/5 p-2">
              <button
                type="button"
                onClick={() => handleDashboardStudioAction({ command: "toggle-customize" })}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25"
              >
                <LayoutGrid size={14} />
                Close Customize Panel
              </button>

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={!canSaveLayout}
                  onClick={() => handleDashboardStudioAction({ command: "save-layout" })}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/45 bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Save size={14} />
                  {activeDashboardLayoutState.layoutSaving ? "Saving..." : "Save Layout"}
                </button>
                <button
                  type="button"
                  disabled={!canDiscardLayout}
                  onClick={() => handleDashboardStudioAction({ command: "discard-changes" })}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-500/45 bg-amber-500/15 px-3 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Undo2 size={14} />
                  Discard Changes
                </button>
              </div>

              <button
                type="button"
                disabled={!canSaveLayoutAsDefault}
                onClick={() =>
                  handleDashboardStudioAction({ command: "save-layout-default" })
                }
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <BookmarkPlus size={14} />
                Save Layout as Default
              </button>

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={!canUndoLayout}
                  onClick={() => handleDashboardStudioAction({ command: "undo-layout-change" })}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Undo2 size={14} />
                  Undo Change
                </button>
                <button
                  type="button"
                  disabled={!canRedoLayout}
                  onClick={() => handleDashboardStudioAction({ command: "redo-layout-change" })}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-500/45 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Redo2 size={14} />
                  Redo Change
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={!canLoadDefault}
                  onClick={() => handleDashboardStudioAction({ command: "load-default" })}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-500/45 bg-sky-500/15 px-3 py-2 text-sm font-semibold text-sky-100 transition hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Download size={14} />
                  Load Default
                </button>
                <button
                  type="button"
                  disabled={!canResetLayout}
                  onClick={() => handleDashboardStudioAction({ command: "reset-defaults" })}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <RefreshCw size={14} />
                  Reset Dashboard
                </button>
              </div>

              {activeDashboardLayoutState.layoutError ? (
                <p className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-2 text-[11px] text-rose-100">
                  {activeDashboardLayoutState.layoutError}
                </p>
              ) : null}
            </section>
          </div>
        ) : null}
      </div>
    );
  };

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
            closeStudioMenu();
            closeInstructionMenu();
          }}
          className={cn(
            "inline-flex items-center rounded-xl border px-4 py-2 text-sm font-semibold transition",
            isNewInstructionActive
              ? "border-cyan-700 bg-cyan-600 text-white shadow-sm dark:border-slate-200/70 dark:bg-slate-100 dark:text-slate-900"
              : "border-slate-300/70 bg-white/80 text-slate-700 hover:border-slate-400 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800",
          )}
        >
          New Instruction
        </Link>
      );
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
            closeStudioMenu();
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
          aria-haspopup="menu"
          aria-expanded={instructionMenuVisible}
          aria-label="Open instruction options"
          onClick={() => {
            if (instructionMenuVisible) {
              closeInstructionMenu();
              return;
            }

            closeDashboardMenu();
            closeStudioMenu();
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
              href="/instructions/archived"
              onClick={() => {
                closeDashboardMenu();
                closeStudioMenu();
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
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <header className="sticky top-0 z-[80] border-b border-white/20 print:hidden dark:border-white/10">
      <div aria-hidden="true" className="absolute inset-0">
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={(event) => applyHeaderVideoPlaybackRate(event.currentTarget)}
          className="h-full w-full object-cover dark:hidden"
        >
          <source src="/header-light.mp4" type="video/mp4" />
        </video>
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={(event) => applyHeaderVideoPlaybackRate(event.currentTarget)}
          className="hidden h-full w-full object-cover dark:block"
        >
          <source src="/header-dark.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-white/35 dark:bg-slate-950/35" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 py-3 md:px-8">
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
          <nav className="hidden items-center gap-3 md:flex">
            {renderDashboardStudioControl(false)}
            {renderDashboardControl(false)}
            {renderInstructionControl(false)}
          </nav>
          <UserAccountMenu profile={profile} />
        </div>

        <nav className="relative mt-2 flex flex-wrap items-center justify-center gap-2 md:hidden">
          {renderDashboardStudioControl(true)}
          {renderDashboardControl(true)}
          {renderInstructionControl(true)}
        </nav>
      </div>
    </header>
  );
}
