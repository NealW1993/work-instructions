"use client";

import Link from "next/link";
import { ChevronDown, Clock3, LogOut, Settings, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isSystemAdmin } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  clearSessionStart,
  ensureSessionStartTime,
  formatElapsedHhMmSs,
  getSessionStartTime,
  setSessionStartTime,
} from "@/lib/session-timer";
import { useSynchronizedNowMs } from "@/lib/second-ticker";
import type { Profile } from "@/lib/types";
import { persistActiveThemePreference } from "@/lib/theme-client";
import { cn } from "@/lib/utils";

interface UserAccountMenuProps {
  profile: Profile;
}

const ICON_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const DEFAULT_ICON_COLOR = "#0EA5E9";
const ACCOUNT_MENU_ANIMATION_MS = 260;
const ACCOUNT_MENU_MIN_WIDTH_PX = 270;

function resolveIconColor(value: string | undefined) {
  if (!value) {
    return DEFAULT_ICON_COLOR;
  }

  const normalized = value.trim().toUpperCase();
  return ICON_COLOR_PATTERN.test(normalized) ? normalized : DEFAULT_ICON_COLOR;
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

export function UserAccountMenu({ profile }: UserAccountMenuProps) {
  const router = useRouter();
  const posthog = usePostHog();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [menuMounted, setMenuMounted] = useState(false);
  const [menuEntered, setMenuEntered] = useState(false);
  const [menuWidth, setMenuWidth] = useState(ACCOUNT_MENU_MIN_WIDTH_PX);
  const synchronizedNowMs = useSynchronizedNowMs();
  const serverSessionStartMs = useMemo(
    () => toTimestampMs(profile.active_session_started_at),
    [profile.active_session_started_at],
  );
  const localSessionStartMs = getSessionStartTime();
  const sessionStartedAtMs = serverSessionStartMs ?? localSessionStartMs;

  const initials = useMemo(() => getInitials(profile.full_name), [profile.full_name]);
  const iconColor = useMemo(() => resolveIconColor(profile.icon_color), [profile.icon_color]);
  const sessionElapsedLabel = useMemo(() => {
    if (sessionStartedAtMs === null) {
      return "00:00:00";
    }

    return formatElapsedHhMmSs(Math.max(0, synchronizedNowMs - sessionStartedAtMs));
  }, [sessionStartedAtMs, synchronizedNowMs]);

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
    posthog?.reset();
    persistActiveThemePreference();
    closeMenu();
    router.push("/login");
    router.refresh();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerButtonRef}
        type="button"
        onClick={() => (open ? closeMenu() : openMenu())}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full border border-slate-300/70 bg-white/80 px-3 py-1.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-100 dark:hover:bg-slate-900"
      >
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-extrabold text-white"
          style={{ backgroundColor: iconColor }}
        >
          {initials}
        </span>
        <span className="max-w-[150px] truncate">{profile.full_name}</span>
        <ChevronDown size={14} className={open ? "rotate-180 transition" : "transition"} />
      </button>

      {menuMounted ? (
        <div
          className={cn(
            "absolute right-0 z-[90] mt-2 grid gap-3 rounded-2xl border border-white/20 bg-slate-950/95 p-3 shadow-2xl backdrop-blur-xl transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform",
            menuEntered ? "pointer-events-auto" : "pointer-events-none",
          )}
          style={{
            width: `${menuWidth}px`,
            maxWidth: "92vw",
            opacity: menuEntered ? 1 : 0,
            filter: menuEntered ? "blur(0px)" : "blur(6px)",
            transform: menuEntered ? "translateY(0px) scale(1)" : "translateY(-8px) scale(0.98)",
            transformOrigin: "top right",
          }}
        >
          <div className="rounded-xl border border-cyan-500/35 bg-cyan-500/12 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200/90">
              Active Session
            </p>
            <p className="mt-1 inline-flex items-center gap-2 font-mono text-2xl font-bold text-cyan-100">
              <Clock3 size={16} />
              {sessionElapsedLabel}
            </p>
          </div>

          <Link
            href="/account"
            onClick={() => closeMenu()}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
          >
            <Settings size={15} />
            Account Settings
          </Link>

          {isSystemAdmin(profile.role) ? (
            <Link
              href="/admin/users"
              onClick={() => closeMenu()}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25"
            >
              <SlidersHorizontal size={15} />
              System Settings
            </Link>
          ) : null}

          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="inline-flex items-center gap-2 rounded-xl border border-rose-500/45 bg-rose-500/15 px-3 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/25"
          >
            <LogOut size={15} />
            Logout
          </button>
        </div>
      ) : null}
    </div>
  );
}
