"use client";

import { RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

const STORAGE_PREFIX = "work-instructions:checklist:";
const ITEM_SELECTOR = 'li[data-type="taskItem"]';
const BOX_SELECTOR = 'li[data-type="taskItem"] > label > input[type="checkbox"]';

function readTicks(key: string): boolean[] {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.map((value) => value === true) : [];
  } catch {
    return [];
  }
}

function saveTicks(key: string, ticks: boolean[]) {
  try {
    if (ticks.some(Boolean)) window.sessionStorage.setItem(key, JSON.stringify(ticks));
    else window.sessionStorage.removeItem(key);
  } catch {
    // Ticks are a convenience; a browser that refuses storage still lets you tick for this visit.
  }
}

/**
 * Lets the reader tick an instruction's checklist while working through it. The ticks belong to this
 * browser tab only: they are kept while the tab is open (also when coming back to the instruction) and
 * are never saved to the instruction. The instruction's text stays read-only.
 */
export function InstructionChecklistSession({
  storageKey,
  itemCount,
  children,
}: {
  /** Changes when the instruction's content changes, so old ticks never land on different items. */
  storageKey: string;
  itemCount: number;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [tickedCount, setTickedCount] = useState(0);
  const key = `${STORAGE_PREFIX}${storageKey}`;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // The instruction is rendered as read-only HTML with disabled boxes; switch them on here.
    const boxes = Array.from(container.querySelectorAll<HTMLInputElement>(BOX_SELECTOR));
    const saved = readTicks(key);
    boxes.forEach((box, index) => {
      box.disabled = false;
      box.checked = saved[index] === true;
      const item = box.closest<HTMLElement>(ITEM_SELECTOR);
      item?.setAttribute("data-checked", String(box.checked));
      item?.setAttribute("data-session-checklist", "");
      const text = item?.querySelector(":scope > div")?.textContent?.replace(/\s+/g, " ").trim();
      if (text) box.setAttribute("aria-label", text.slice(0, 160));
    });

    const record = () => {
      boxes.forEach((box) => box.closest(ITEM_SELECTOR)?.setAttribute("data-checked", String(box.checked)));
      const ticks = boxes.map((box) => box.checked);
      saveTicks(key, ticks);
      setTickedCount(ticks.filter(Boolean).length);
    };

    const handleChange = (event: Event) => {
      if (event.target instanceof HTMLInputElement && boxes.includes(event.target)) record();
    };

    // Tapping an item's text ticks it too, a bigger target on a tablet. Links, pictures and text being
    // selected are left alone.
    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest("a, button, input, label, img, video, figure, table")) return;
      const item = target.closest<HTMLElement>(ITEM_SELECTOR);
      if (!item || !container.contains(item) || window.getSelection()?.toString()) return;
      const box = item.querySelector<HTMLInputElement>(':scope > label > input[type="checkbox"]');
      if (!box || !boxes.includes(box)) return;
      box.checked = !box.checked;
      record();
    };

    container.addEventListener("change", handleChange);
    container.addEventListener("click", handleClick);
    const timer = window.setTimeout(() => setTickedCount(boxes.filter((box) => box.checked).length), 0);
    return () => {
      window.clearTimeout(timer);
      container.removeEventListener("change", handleChange);
      container.removeEventListener("click", handleClick);
    };
  }, [key]);

  function clearTicks() {
    containerRef.current?.querySelectorAll<HTMLInputElement>(BOX_SELECTOR).forEach((box) => {
      box.checked = false;
      box.closest(ITEM_SELECTOR)?.setAttribute("data-checked", "false");
    });
    saveTicks(key, []);
    setTickedCount(0);
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/60">
        <p className="text-slate-600 dark:text-slate-300">
          <span aria-live="polite" className="font-semibold text-slate-900 dark:text-slate-100">
            {tickedCount} of {itemCount} ticked.
          </span>{" "}
          Only you see these ticks; they clear when you close this tab.
        </p>
        <button
          type="button"
          onClick={clearTicks}
          disabled={tickedCount === 0}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RotateCcw aria-hidden="true" size={14} />
          Clear ticks
        </button>
      </div>
      <div ref={containerRef}>{children}</div>
    </div>
  );
}
