"use client";

import { useHydrated } from "@/lib/use-hydrated";

interface LocalDateTimeProps {
  value: string | Date;
  mode?: "date" | "dateTime";
  className?: string;
  fallback?: string;
}

function parseDate(value: string | Date): Date | null {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatLocalValue(value: string | Date, mode: "date" | "dateTime") {
  const parsed = parseDate(value);
  if (!parsed) {
    return "";
  }

  if (mode === "date") {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).format(parsed);
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(parsed);
}

export function LocalDateTime({
  value,
  mode = "dateTime",
  className,
  fallback = "--",
}: LocalDateTimeProps) {
  const hydrated = useHydrated();
  const formatted = hydrated ? formatLocalValue(value, mode) : "";

  const parsed = parseDate(value);
  const isoValue = parsed ? parsed.toISOString() : undefined;

  return (
    <time suppressHydrationWarning dateTime={isoValue} className={className}>
      {formatted || fallback}
    </time>
  );
}

