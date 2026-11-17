"use client";

import Link from "next/link";
import {
  BarChart3,
  Bell,
  CircleHelp,
  ChevronDown,
  Clapperboard,
  Clock3,
  FileText,
  Inbox,
  LogOut,
  Moon,
  Settings,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { usePostHog } from "posthog-js/react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { FloatingStatusNotices } from "@/components/ui/floating-status-notices";
import { setHeaderAnimationEnabled, useHeaderAnimationEnabled } from "@/lib/header-animation";
import { accessLevelLabel, canViewKpis, hasFullAccess, roleLabel } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { prepareIntentionalSignOut } from "@/lib/session-exit";
import {
  clearSessionStart,
  ensureSessionStartTime,
  formatElapsedHhMmSs,
  getSessionStartTime,
  setSessionStartTime,
} from "@/lib/session-timer";
import { useSynchronizedNowMs } from "@/lib/second-ticker";
import type { Profile, ThemePreference } from "@/lib/types";
import { persistActiveThemePreference } from "@/lib/theme-client";
import { cn, drainResponse } from "@/lib/utils";

interface UserAccountMenuProps {
  profile: Profile;
}

interface UserNotification {
  id: string;
  eventType: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
  actorName: string;
}

interface NotificationsResponse {
  notifications?: UserNotification[];
  unreadCount?: number;
  error?: string;
}

const ICON_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const DEFAULT_ICON_COLOR = "#0EA5E9";
const FONT_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const DEFAULT_FONT_COLOR = "#FFFFFF";
const ACCOUNT_MENU_ANIMATION_MS = 260;
const ACCOUNT_MENU_MIN_WIDTH_PX = 360;

function resolveIconColor(value: string | undefined) {
  if (!value) {
    return DEFAULT_ICON_COLOR;
  }

  const normalized = value.trim().toUpperCase();
  return ICON_COLOR_PATTERN.test(normalized) ? normalized : DEFAULT_ICON_COLOR;
}

function resolveFontColor(value: string | undefined) {
  if (!value) {
    return DEFAULT_FONT_COLOR;
  }

  const normalized = value.trim().toUpperCase();
  return FONT_COLOR_PATTERN.test(normalized) ? normalized : DEFAULT_FONT_COLOR;
}

function getInitials(value: string) {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "U";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function toTimestampMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNotificationTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function UserAccountMenu({ profile }: UserAccountMenuProps) {
  const posthog = usePostHog();
  const { setTheme } = useTheme();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const themeUpdateRequestIdRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [menuMounted, setMenuMounted] = useState(false);
  const [menuEntered, setMenuEntered] = useState(false);
  const [menuWidth, setMenuWidth] = useState(ACCOUNT_MENU_MIN_WIDTH_PX);
  const [localThemePreference, setThemePreference] = useState<ThemePreference | null>(null);
  const themePreference = localThemePreference ?? profile.theme_preference ?? "dark";
  const [themeSaving, setThemeSaving] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpMessage, setHelpMessage] = useState("");
  const [helpBusy, setHelpBusy] = useState(false);
  const [helpStatus, setHelpStatus] = useState<string | null>(null);
  const [helpError, setHelpError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const synchronizedNowMs = useSynchronizedNowMs();
  const serverSessionStartMs = useMemo(
    () => toTimestampMs(profile.active_session_started_at),
    [profile.active_session_started_at],
  );
  const localSessionStartMs = getSessionStartTime();
  const sessionStartedAtMs = serverSessionStartMs ?? localSessionStartMs;

  const initials = useMemo(() => getInitials(profile.full_name), [profile.full_name]);
  const iconColor = useMemo(() => resolveIconColor(profile.icon_color), [profile.icon_color]);
  const fontColor = useMemo(() => resolveFontColor(profile.font_color), [profile.font_color]);
  const isDarkTheme = themePreference === "dark";
  const headerAnimationOn = useHeaderAnimationEnabled() ?? true;
  // Administrators see their role; everyone else sees what they can do.
  const roleText = hasFullAccess(profile.role) ? roleLabel(profile.role) : accessLevelLabel(profile.role);
  const menuRowClass = "flex min-h-11 w-full items-center gap-3 rounded-md px-2.5 text-left text-sm font-medium transition hover:bg-slate-100 dark:hover:bg-slate-800";
  const canUsePortal = typeof document !== "undefined";
  const unreadNotificationLabel =
    unreadNotificationCount > 99 ? "99+" : String(unreadNotificationCount);
  const sessionElapsedLabel = useMemo(() => {
    if (sessionStartedAtMs === null) {
      return "00:00:00";
    }

    return formatElapsedHhMmSs(Math.max(0, synchronizedNowMs - sessionStartedAtMs));
  }, [sessionStartedAtMs, synchronizedNowMs]);

  const loadNotifications = useCallback(async () => {



    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setNotificationsBusy(true);
      setNotificationsError(null);
      if (!session?.access_token) {
        return;
      }

      const response = await fetch("/api/notifications?limit=40", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const payload = (await response.json().catch(() => ({}))) as NotificationsResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load notifications.");
      }

      setNotifications(payload.notifications ?? []);
      setUnreadNotificationCount(payload.unreadCount ?? 0);
    } catch (caughtError) {
      setNotificationsError(
        caughtError instanceof Error ? caughtError.message : "Unable to load notifications.",
      );
    } finally {
      setNotificationsBusy(false);
    }
  }, [supabase]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void loadNotifications(); }, 0);
    const intervalId = window.setInterval(() => {
      void loadNotifications();
    }, 45_000);

    return () => { window.clearTimeout(initialLoad); window.clearInterval(intervalId); };
  }, [loadNotifications]);

  async function markNotificationsRead(notificationIds?: string[]) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        return;
      }

      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(
          notificationIds ? { notificationIds } : { markAllRead: true },
        ),
      });
      if (!response.ok) {
        return;
      }

      setNotifications((current) =>
        current.map((notification) =>
          !notificationIds || notificationIds.includes(notification.id)
            ? { ...notification, readAt: notification.readAt ?? new Date().toISOString() }
            : notification,
        ),
      );
      setUnreadNotificationCount((current) =>
        notificationIds ? Math.max(0, current - notificationIds.length) : 0,
      );
    } catch {
      // Marking read is best-effort from the menu.
    }
  }

  const syncMenuWidth = useCallback(() => {
    const triggerWidth = triggerButtonRef.current?.getBoundingClientRect().width ?? 0;
    setMenuWidth(Math.max(Math.round(triggerWidth), ACCOUNT_MENU_MIN_WIDTH_PX));
  }, []);

  const closeMenu = useCallback(() => {
    if (!menuMounted && !open) {
      return;
    }

    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    setMenuEntered(false);
    setOpen(false);
    closeTimeoutRef.current = window.setTimeout(() => {
      setMenuMounted(false);
      closeTimeoutRef.current = null;
    }, ACCOUNT_MENU_ANIMATION_MS);
  }, [menuMounted, open]);

  const openMenu = useCallback(() => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    syncMenuWidth();
    setMenuMounted(true);
    setOpen(true);
    window.requestAnimationFrame(() => {
      setMenuEntered(true);
    });
  }, [syncMenuWidth]);

  const touchServerSession = useCallback(
    async (endSession: boolean) => {
      const { error: touchError } = await supabase.rpc("touch_user_session", {
        end_session: endSession,
      });

      if (touchError) {
        throw touchError;
      }
    },
    [supabase],
  );

  const finalizeServerSession = useCallback(async () => {
    const sessionStartedAtMs = getSessionStartTime();
    const clientElapsedSeconds =
      sessionStartedAtMs !== null
        ? Math.max(0, Math.floor((Date.now() - sessionStartedAtMs) / 1000))
        : null;

    const response = await fetch("/api/auth/session/end", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({
        sessionStartedAtMs,
        clientElapsedSeconds,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "Unable to finalize session telemetry.");
    }
  }, []);

  useEffect(() => {
    if (serverSessionStartMs !== null) {
      setSessionStartTime(serverSessionStartMs);
      return;
    }

    ensureSessionStartTime();
  }, [serverSessionStartMs]);

  useEffect(() => {
    let cancelled = false;

    const syncSessionStart = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (cancelled) {
          return;
        }

        try {
          await touchServerSession(false);
          return;
        } catch {
          if (attempt < 2) {
            await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
          }
        }
      }
    };

    void syncSessionStart();

    return () => {
      cancelled = true;
    };
  }, [touchServerSession]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!rootRef.current || !target || rootRef.current.contains(target)) {
        return;
      }

      closeMenu();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeMenu, open]);

  useEffect(() => {
    if (!helpOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHelpOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [helpOpen]);

  useEffect(() => {
    if (!menuMounted) {
      return;
    }

    const observer = new ResizeObserver(() => syncMenuWidth());
    if (triggerButtonRef.current) {
      observer.observe(triggerButtonRef.current);
    }

    const onWindowResize = () => syncMenuWidth();
    window.addEventListener("resize", onWindowResize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, [menuMounted, syncMenuWidth]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      syncMenuWidth();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [syncMenuWidth, profile.full_name]);

  useEffect(
    () => () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    },
    [],
  );

  async function handleSignOut() {
    await finalizeServerSession().catch(async () => {
      await touchServerSession(true).catch(() => {
        // Do not block sign-out if a session telemetry call fails.
      });
    });

    await supabase.auth.signOut();
    clearSessionStart();
    prepareIntentionalSignOut(profile.id);
    posthog?.reset();
    persistActiveThemePreference();
    closeMenu();
    // A full page load: it drops pages the client router fetched while signed in, which would
    // otherwise be reused after the next sign-in and bounce between the dashboard and this page.
    window.location.replace("/login");
  }

  async function persistThemePreferenceToProfile(nextThemePreference: ThemePreference) {
    const requestId = themeUpdateRequestIdRef.current + 1;
    themeUpdateRequestIdRef.current = requestId;
    setThemeSaving(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        return;
      }

      await drainResponse(await fetch("/api/auth/account", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          themePreference: nextThemePreference,
        }),
      }));
    } catch {
      // Theme save is silent by design in this menu.
    } finally {
      if (themeUpdateRequestIdRef.current === requestId) {
        setThemeSaving(false);
      }
    }
  }

  function handleThemeToggle() {
    const nextThemePreference: ThemePreference = themePreference === "dark" ? "light" : "dark";
    setThemePreference(nextThemePreference);
    setTheme(nextThemePreference);
    void persistThemePreferenceToProfile(nextThemePreference);
  }

  async function handleSubmitHelpRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedMessage = helpMessage.trim();
    if (!normalizedMessage) {
      setHelpError("Please enter a help request message.");
      setHelpStatus(null);
      return;
    }

    setHelpBusy(true);
    setHelpError(null);
    setHelpStatus(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("Missing session token. Please sign in again.");
      }

      const response = await fetch("/api/auth/help", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          message: normalizedMessage,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to send help request.");
      }

      setHelpStatus("Message sent to system admin.");
      setHelpMessage("");
      setHelpOpen(false);
    } catch (caughtError) {
      setHelpError(
        caughtError instanceof Error ? caughtError.message : "Unable to send help request.",
      );
    } finally {
      setHelpBusy(false);
    }
  }

  const helpModal = helpOpen ? (
    <div
      className={cn(
        "app-modal-shell fixed inset-0 z-[210] grid place-items-center overflow-y-auto p-4 sm:p-6 backdrop-blur-sm",
        isDarkTheme ? "bg-slate-950/75" : "bg-slate-900/35",
      )}
      role="presentation"
      onClick={() => setHelpOpen(false)}
    >
      <article
        role="dialog"
        aria-modal="true"
        aria-label="Help Chat"
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "my-auto grid w-full max-w-lg gap-3 overflow-y-auto rounded-2xl border p-4 shadow-2xl",
          isDarkTheme
            ? "border-white/15 bg-slate-950/95 text-slate-100"
            : "border-slate-300/80 bg-white text-slate-900",
        )}
        style={{ maxHeight: "min(92dvh, 760px)" }}
      >
        <div className="grid gap-1">
          <h3 className="text-lg font-bold">Help Chat</h3>
          <p
            className={cn(
              "text-sm",
              isDarkTheme ? "text-slate-300" : "text-slate-600",
            )}
          >
            Send a direct help request to system admin. Replies will go to your account email.
          </p>
        </div>

        <form className="grid min-h-0 gap-3" onSubmit={handleSubmitHelpRequest}>
          <div className="grid gap-1">
            <span
              className={cn(
                "text-xs font-semibold uppercase tracking-wide",
                isDarkTheme ? "text-slate-300" : "text-slate-500",
              )}
            >
              Sending as
            </span>
            <p className="text-sm font-semibold">{profile.full_name}</p>
            <p
              className={cn(
                "text-xs",
                isDarkTheme ? "text-slate-400" : "text-slate-600",
              )}
            >
              {profile.email}
            </p>
          </div>

          <label
            className={cn(
              "grid min-h-0 gap-1 text-sm",
              isDarkTheme ? "text-slate-200" : "text-slate-700",
            )}
          >
            <span>Message</span>
            <textarea
              value={helpMessage}
              onChange={(event) => setHelpMessage(event.target.value)}
              rows={6}
              maxLength={4000}
              placeholder="How can we help?"
              className={cn(
                "min-h-[10rem] rounded-xl border px-3 py-2 outline-none transition",
                isDarkTheme
                  ? "border-white/15 bg-black/45 text-slate-100 focus:border-slate-300"
                  : "border-slate-300 bg-white text-slate-900 focus:border-cyan-500",
              )}
            />
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setHelpOpen(false)}
              className={cn(
                "rounded-xl border px-3 py-2 text-sm font-semibold transition",
                isDarkTheme
                  ? "border-white/20 bg-black/45 text-slate-100 hover:bg-white/10"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
              )}
            >
              Close
            </button>
            <button
              type="submit"
              disabled={helpBusy}
              className={cn(
                "rounded-xl px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-70",
                isDarkTheme
                  ? "bg-cyan-500/35 text-cyan-100 hover:bg-cyan-500/45"
                  : "bg-cyan-600 text-white hover:bg-cyan-500",
              )}
            >
              {helpBusy ? "Sending..." : "Send Help Request"}
            </button>
          </div>
        </form>
      </article>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="relative">
      <FloatingStatusNotices
        notices={[
          helpStatus && {
            id: "account-menu-help-status",
            tone: "success",
            message: helpStatus,
            onDismiss: () => setHelpStatus(null),
          },
          helpError && {
            id: "account-menu-help-error",
            tone: "error",
            message: helpError,
            onDismiss: () => setHelpError(null),
          },
        ]}
      />
      <button
        ref={triggerButtonRef}
        type="button"
        onClick={() => (open ? closeMenu() : openMenu())}
        aria-expanded={open}
        aria-label={`Account: ${profile.full_name}, ${roleText}${unreadNotificationCount > 0 ? `, ${unreadNotificationLabel} unread notifications` : ""}`}
        className="inline-flex h-10 max-w-[16rem] items-center gap-2 rounded-md border border-slate-300 bg-white/90 pl-1 pr-2 text-left shadow-sm transition hover:bg-white dark:border-white/15 dark:bg-black/55 dark:hover:bg-black/75"
      >
        <span
          aria-hidden="true"
          className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-extrabold"
          style={{ backgroundColor: iconColor, color: fontColor }}
        >
          {initials}
          {unreadNotificationCount > 0 ? (
            <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-rose-600 px-1 text-center text-[10px] font-bold leading-4 text-white ring-2 ring-white dark:ring-black">
              {unreadNotificationLabel}
            </span>
          ) : null}
        </span>
        <span aria-hidden="true" className="hidden min-w-0 leading-tight md:grid">
          <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">{profile.full_name}</span>
          <span className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">{roleText}</span>
        </span>
        <ChevronDown size={14} aria-hidden="true" className={cn("shrink-0 text-slate-500 transition-transform dark:text-slate-400", open && "rotate-180")} />
      </button>

      {menuMounted ? (
        <div
          className={cn(
            "absolute right-0 z-[90] mt-2 grid gap-0.5 rounded-lg border border-slate-200 bg-white p-1.5 text-slate-800 shadow-xl transition-[opacity,transform] duration-200 ease-out dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
            menuEntered ? "pointer-events-auto" : "pointer-events-none",
          )}
          style={{
            width: `${menuWidth}px`,
            maxWidth: "92vw",
            opacity: menuEntered ? 1 : 0,
            transform: menuEntered ? "translateY(0px)" : "translateY(-6px)",
            transformOrigin: "top right",
          }}
        >
          <div className="flex items-center gap-3 px-2.5 py-2.5">
            <span
              aria-hidden="true"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-extrabold"
              style={{ backgroundColor: iconColor, color: fontColor }}
            >
              {initials}
            </span>
            <span className="grid min-w-0">
              <span className="truncate font-semibold">{profile.full_name}</span>
              <span className="truncate text-xs text-slate-500 dark:text-slate-400">{roleText}</span>
            </span>
            <span className="ml-auto grid shrink-0 justify-items-end text-right">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Session</span>
              <span className="inline-flex items-center gap-1 font-mono text-sm font-semibold tabular-nums">
                <Clock3 size={13} aria-hidden="true" />
                {sessionElapsedLabel}
              </span>
            </span>
          </div>

          <div aria-hidden="true" className="my-1 h-px bg-slate-200 dark:bg-slate-700" />

          <button
            type="button"
            onClick={handleThemeToggle}
            aria-label={`Switch to ${isDarkTheme ? "light" : "dark"} mode`}
            aria-pressed={isDarkTheme}
            aria-busy={themeSaving}
            className={cn(menuRowClass, "justify-between")}
          >
            <span className="inline-flex items-center gap-3">
              {isDarkTheme ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
              Dark mode
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors",
                isDarkTheme ? "bg-cyan-600" : "bg-slate-300 dark:bg-slate-600",
              )}
            >
              <span
                className={cn(
                  "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                  isDarkTheme ? "translate-x-4" : "translate-x-0",
                )}
              />
            </span>
          </button>

          <button
            type="button"
            role="switch"
            aria-checked={headerAnimationOn}
            onClick={() => setHeaderAnimationEnabled(!headerAnimationOn)}
            className={cn(menuRowClass, "justify-between")}
          >
            <span className="inline-flex items-center gap-3">
              <Clapperboard size={16} aria-hidden="true" />
              Header animation
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors",
                headerAnimationOn ? "bg-cyan-600" : "bg-slate-300 dark:bg-slate-600",
              )}
            >
              <span
                className={cn(
                  "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                  headerAnimationOn ? "translate-x-4" : "translate-x-0",
                )}
              />
            </span>
          </button>

          <section className="relative">
            <button
              type="button"
              aria-expanded={notificationsOpen}
              onClick={() => {
                setNotificationsOpen((current) => !current);
                if (!notificationsOpen) {
                  void loadNotifications();
                }
              }}
              className={cn(menuRowClass, "justify-between", notificationsOpen && "bg-slate-100 dark:bg-slate-800")}
            >
              <span className="inline-flex min-w-0 items-center gap-3">
                <Bell size={16} aria-hidden="true" />
                <span>Notifications</span>
              </span>
              <span className="inline-flex items-center gap-2">
                {unreadNotificationCount > 0 ? (
                  <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold leading-none text-white">
                    {unreadNotificationLabel}
                  </span>
                ) : null}
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  className={cn("text-slate-400 transition-transform", notificationsOpen && "rotate-180")}
                />
              </span>
            </button>
            {notificationsOpen ? (
              <div className="absolute right-0 top-full z-[95] mt-2 grid w-[28rem] max-w-[calc(100vw-2rem)] gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-xl lg:right-full lg:top-0 lg:mr-3 lg:mt-0 dark:border-slate-700 dark:bg-slate-900">
                <div className="flex items-center justify-between gap-2 px-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Recent activity
                  </span>
                  <button
                    type="button"
                    onClick={() => void markNotificationsRead()}
                    disabled={unreadNotificationCount === 0}
                    className="text-xs font-semibold text-cyan-700 transition hover:text-cyan-900 disabled:cursor-not-allowed disabled:text-slate-400 dark:text-cyan-300 dark:hover:text-cyan-100 dark:disabled:text-slate-600"
                  >
                    Mark all read
                  </button>
                </div>
                {notificationsError ? (
                  <p className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
                    {notificationsError}
                  </p>
                ) : null}
                <div className="grid max-h-[28rem] gap-2 overflow-y-auto pr-1">
                  {notifications.length === 0 && !notificationsBusy ? (
                    <div className="grid place-items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-5 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      <Inbox size={18} aria-hidden="true" />
                      No notifications yet.
                    </div>
                  ) : null}
                  {notifications.map((notification) => {
                    const isUnread = !notification.readAt;
                    const content = (
                      <div
                        className={cn(
                          "grid gap-1 rounded-md border px-3 py-2 text-left transition",
                          isUnread
                            ? "border-cyan-200 bg-cyan-50 dark:border-cyan-500/30 dark:bg-cyan-500/10"
                            : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 text-xs font-bold text-slate-900 dark:text-slate-100">
                            {notification.title}
                          </p>
                          {isUnread ? (
                            <span aria-label="Unread" className="mt-1 h-2 w-2 shrink-0 rounded-full bg-cyan-600 dark:bg-cyan-300" />
                          ) : null}
                        </div>
                        <p className="text-xs leading-snug text-slate-600 dark:text-slate-300">
                          {notification.body}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {notification.actorName} | {formatNotificationTime(notification.createdAt)}
                        </p>
                      </div>
                    );

                    if (notification.href) {
                      return (
                        <Link
                          key={notification.id}
                          href={notification.href}
                          onClick={() => {
                            void markNotificationsRead([notification.id]);
                            closeMenu();
                          }}
                          className="block"
                        >
                          {content}
                        </Link>
                      );
                    }

                    return (
                      <button
                        key={notification.id}
                        type="button"
                        onClick={() => void markNotificationsRead([notification.id])}
                      >
                        {content}
                      </button>
                    );
                  })}
                  {notificationsBusy ? (
                    <p className="rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      Loading notifications...
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          <div aria-hidden="true" className="my-1 h-px bg-slate-200 dark:bg-slate-700" />

          <Link href="/account" onClick={() => closeMenu()} className={menuRowClass}>
            <Settings size={16} aria-hidden="true" />
            Account settings
          </Link>

          <Link href="/drafts" onClick={() => closeMenu()} className={menuRowClass}>
            <FileText size={16} aria-hidden="true" />
            My drafts
          </Link>

          {hasFullAccess(profile.role) ? (
            <Link href="/admin/users" onClick={() => closeMenu()} className={menuRowClass}>
              <SlidersHorizontal size={16} aria-hidden="true" />
              System settings
            </Link>
          ) : null}

          {canViewKpis(profile.role) ? (
            <Link href="/admin/kpis" onClick={() => closeMenu()} className={menuRowClass}>
              <BarChart3 size={16} aria-hidden="true" />
              KPI dashboard
            </Link>
          ) : null}

          <button
            type="button"
            onClick={() => {
              closeMenu();
              setHelpOpen(true);
              setHelpError(null);
              setHelpStatus(null);
            }}
            className={menuRowClass}
          >
            <CircleHelp size={16} aria-hidden="true" />
            Help chat
          </button>

          <div aria-hidden="true" className="my-1 h-px bg-slate-200 dark:bg-slate-700" />

          <button
            type="button"
            onClick={() => void handleSignOut()}
            className={cn(menuRowClass, "font-semibold text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10")}
          >
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}

      {helpModal ? (canUsePortal ? createPortal(helpModal, document.body) : helpModal) : null}
    </div>
  );
}
