"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  GripVertical,
  Info,
  LayoutGrid,
  Plus,
  RefreshCw,
  Save,
  Search,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

interface DashboardWorkItemSummary {
  department_id: string;
  department_name: string;
  department_color: string;
  part_number: string;
  mold_number: string;
  item_title: string;
}

export interface DashboardInstructionCardData {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  creator_name: string;
  workItem: DashboardWorkItemSummary;
}

export interface DashboardPinnedInstructionCardData
  extends DashboardInstructionCardData {
  pinned_at: string;
}

export interface DashboardWorkItemInstructionData {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  creator_id: string;
  creator_name: string;
}

export interface DashboardWorkItemData extends DashboardWorkItemSummary {
  id: string;
  updated_at: string;
  work_instructions: DashboardWorkItemInstructionData[];
}

interface DashboardDepartmentOption {
  id: string;
  name: string;
  color_hex: string | null;
}

interface DepartmentInsight {
  id: string;
  name: string;
  color_hex: string;
  instructionCount: number;
}

type DashboardWidgetId =
  | "finder"
  | "pinned"
  | "newest"
  | "department_activity"
  | "recent_updates"
  | "my_impact";

type DashboardWidgetSize = "compact" | "standard" | "wide" | "full";

interface DashboardWidgetLayoutItem {
  id: DashboardWidgetId;
  visible: boolean;
  size: DashboardWidgetSize;
}

interface DashboardWidgetDefinition {
  id: DashboardWidgetId;
  title: string;
  description: string;
  defaultVisible: boolean;
  defaultSize: DashboardWidgetSize;
}

interface DashboardClientProps {
  canEdit: boolean;
  isSystemAdmin: boolean;
  initialQuery: string;
  searchError: string | null;
  newestError: string | null;
  pinnedError: string | null;
  pinnedInstructions: DashboardPinnedInstructionCardData[];
  newestInstructions: DashboardInstructionCardData[];
  items: DashboardWorkItemData[];
  departmentOptions: DashboardDepartmentOption[];
  currentUserId: string;
  initialDashboardLayout: unknown;
}

const DEFAULT_DEPARTMENT_COLOR = "#0EA5E9";

const WIDGET_DEFINITIONS: DashboardWidgetDefinition[] = [
  {
    id: "finder",
    title: "Find Work Instructions",
    description: "Search by part/mold and filter by department.",
    defaultVisible: true,
    defaultSize: "full",
  },
  {
    id: "pinned",
    title: "Your Pinned Instructions",
    description: "Quick access to instructions you pinned.",
    defaultVisible: true,
    defaultSize: "standard",
  },
  {
    id: "newest",
    title: "Newest Work Instructions",
    description: "Latest instructions across the system.",
    defaultVisible: true,
    defaultSize: "standard",
  },
  {
    id: "department_activity",
    title: "Department Activity",
    description: "Instruction volume by department.",
    defaultVisible: true,
    defaultSize: "standard",
  },
  {
    id: "recent_updates",
    title: "Recently Updated Work Items",
    description: "What changed most recently.",
    defaultVisible: true,
    defaultSize: "wide",
  },
  {
    id: "my_impact",
    title: "My Impact Snapshot",
    description: "Your authored and pinned stats.",
    defaultVisible: true,
    defaultSize: "compact",
  },
];

const DEFAULT_WIDGET_LAYOUT: DashboardWidgetLayoutItem[] = WIDGET_DEFINITIONS.map(
  (widget) => ({
    id: widget.id,
    visible: widget.defaultVisible,
    size: widget.defaultSize,
  }),
);

const WIDGET_SIZE_OPTIONS: Array<{ value: DashboardWidgetSize; label: string }> = [
  { value: "compact", label: "Compact" },
  { value: "standard", label: "Standard" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Full Width" },
];

function formatDateForSearch(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(parsed);
}

function normalizeDepartmentColor(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : DEFAULT_DEPARTMENT_COLOR;
}

function colorToRgb(colorHex: string) {
  const normalized = normalizeDepartmentColor(colorHex);
  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function colorWithAlpha(colorHex: string, alpha: number) {
  const { red, green, blue } = colorToRgb(colorHex);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function itemMatchesQuery(item: DashboardWorkItemData, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  const haystack =
    `${item.item_title} ${item.part_number} ${item.mold_number} ${item.department_name}`.toLowerCase();
  return haystack.includes(normalizedQuery);
}

function instructionMatchesQuery(
  instruction: DashboardWorkItemInstructionData,
  normalizedQuery: string,
) {
  if (!normalizedQuery) {
    return true;
  }

  const haystack =
    `revision ${instruction.revision} ${instruction.creator_name} ` +
    `${formatDateForSearch(instruction.created_at)}`;

  return haystack.toLowerCase().includes(normalizedQuery);
}

function getPrimaryPartOrMoldLabel(workItem: DashboardWorkItemSummary) {
  const mold = workItem.mold_number?.trim();
  if (mold) {
    return `Mold # ${mold}`;
  }

  const part = workItem.part_number?.trim();
  if (part) {
    return `Part # ${part}`;
  }

  return "Part # N/A";
}

function getLabelWithDepartment(workItem: DashboardWorkItemSummary) {
  return `${getPrimaryPartOrMoldLabel(workItem)} | ${workItem.department_name}`;
}

function isWidgetId(value: string): value is DashboardWidgetId {
  return WIDGET_DEFINITIONS.some((widget) => widget.id === value);
}

function isWidgetSize(value: string): value is DashboardWidgetSize {
  return WIDGET_SIZE_OPTIONS.some((option) => option.value === value);
}

function normalizeWidgetLayout(value: unknown): DashboardWidgetLayoutItem[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_WIDGET_LAYOUT];
  }

  const parsed: DashboardWidgetLayoutItem[] = [];
  const seenIds = new Set<DashboardWidgetId>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const visible = typeof candidate.visible === "boolean" ? candidate.visible : null;
    const size = typeof candidate.size === "string" ? candidate.size.trim() : "";

    if (!isWidgetId(id) || seenIds.has(id) || visible === null || !isWidgetSize(size)) {
      continue;
    }

    parsed.push({
      id,
      visible,
      size,
    });
    seenIds.add(id);
  }

  const missingDefaults = DEFAULT_WIDGET_LAYOUT.filter((entry) => !seenIds.has(entry.id));
  return parsed.length > 0 ? [...parsed, ...missingDefaults] : [...DEFAULT_WIDGET_LAYOUT];
}

function getWidgetSpanClass(size: DashboardWidgetSize) {
  switch (size) {
    case "compact":
      return "col-span-12 lg:col-span-4";
    case "wide":
      return "col-span-12 lg:col-span-8";
    case "full":
      return "col-span-12";
    case "standard":
    default:
      return "col-span-12 lg:col-span-6";
  }
}

interface ImpactKpiCardProps {
  label: string;
  value: ReactNode;
  tooltip: string;
}

function ImpactKpiCard({ label, value, tooltip }: ImpactKpiCardProps) {
  return (
    <div
      className="group relative rounded-xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50"
      title={tooltip}
    >
      <div className="mb-1 inline-flex items-center gap-1">
        <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {label}
        </p>
        <Info size={12} className="text-slate-400 dark:text-slate-500" />
      </div>
      <p className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">{value}</p>
      <div className="pointer-events-none absolute left-3 top-1 z-20 max-w-[230px] -translate-y-2 rounded-md border border-cyan-500/35 bg-slate-950/95 px-2 py-1 text-[11px] text-cyan-100 opacity-0 transition-all group-hover:-translate-y-1 group-hover:opacity-100">
        {tooltip}
      </div>
    </div>
  );
}

export function DashboardClient({
  canEdit,
  isSystemAdmin,
  initialQuery,
  searchError,
  newestError,
  pinnedError,
  pinnedInstructions,
  newestInstructions,
  items,
  departmentOptions,
  currentUserId,
  initialDashboardLayout,
}: DashboardClientProps) {
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const realtimeRefreshTimeoutRef = useRef<number | null>(null);
  const layoutDirtyRef = useRef(false);
  const customizeOpenRef = useRef(false);
  const [query, setQuery] = useState(initialQuery);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("all");
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [draggedWidgetId, setDraggedWidgetId] = useState<DashboardWidgetId | null>(null);
  const [dragOverWidgetId, setDragOverWidgetId] = useState<DashboardWidgetId | null>(null);
  const [widgetLayout, setWidgetLayout] = useState<DashboardWidgetLayoutItem[]>(() =>
    normalizeWidgetLayout(initialDashboardLayout),
  );
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  useEffect(() => {
    if (!searchInputRef.current || !initialQuery) {
      return;
    }

    searchInputRef.current.focus();
    const cursorPosition = searchInputRef.current.value.length;
    searchInputRef.current.setSelectionRange(cursorPosition, cursorPosition);
  }, [initialQuery]);

  useEffect(() => {
    layoutDirtyRef.current = layoutDirty;
  }, [layoutDirty]);

  useEffect(() => {
    customizeOpenRef.current = customizeOpen;
  }, [customizeOpen]);

  useEffect(() => {
    if (layoutDirtyRef.current) {
      return;
    }

    setWidgetLayout(normalizeWidgetLayout(initialDashboardLayout));
    setLayoutDirty(false);
  }, [initialDashboardLayout]);

  const scheduleRealtimeRefresh = useCallback(() => {
    if (
      typeof window === "undefined" ||
      layoutDirtyRef.current ||
      customizeOpenRef.current ||
      realtimeRefreshTimeoutRef.current !== null
    ) {
      return;
    }

    realtimeRefreshTimeoutRef.current = window.setTimeout(() => {
      realtimeRefreshTimeoutRef.current = null;
      router.refresh();
    }, 450);
  }, [router]);

  useEffect(() => {
    const channel = supabase
      .channel(`dashboard-live-${currentUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_items" },
        () => scheduleRealtimeRefresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_instructions" },
        () => scheduleRealtimeRefresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_pinned_instructions",
          filter: `user_id=eq.${currentUserId}`,
        },
        () => scheduleRealtimeRefresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "departments" },
        () => scheduleRealtimeRefresh(),
      )
      .subscribe();

    return () => {
      if (realtimeRefreshTimeoutRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimeoutRef.current);
        realtimeRefreshTimeoutRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [currentUserId, scheduleRealtimeRefresh, supabase]);

  const departmentInsights = useMemo(() => {
    const countsByDepartmentId = new Map<string, number>();
    const fallbackDepartmentMetadata = new Map<
      string,
      {
        name: string;
        colorHex: string;
      }
    >();

    for (const item of items) {
      countsByDepartmentId.set(
        item.department_id,
        (countsByDepartmentId.get(item.department_id) ?? 0) + item.work_instructions.length,
      );

      fallbackDepartmentMetadata.set(item.department_id, {
        name: item.department_name,
        colorHex: normalizeDepartmentColor(item.department_color),
      });
    }

    const orderedInsights: DepartmentInsight[] = departmentOptions.map((option) => ({
      id: option.id,
      name: option.name,
      color_hex: normalizeDepartmentColor(option.color_hex),
      instructionCount: countsByDepartmentId.get(option.id) ?? 0,
    }));

    const knownDepartmentIds = new Set(departmentOptions.map((option) => option.id));
    const orphanInsights = Array.from(countsByDepartmentId.keys())
      .filter((departmentId) => !knownDepartmentIds.has(departmentId))
      .map((departmentId) => ({
        id: departmentId,
        name: fallbackDepartmentMetadata.get(departmentId)?.name ?? "Unknown",
        color_hex:
          fallbackDepartmentMetadata.get(departmentId)?.colorHex ?? DEFAULT_DEPARTMENT_COLOR,
        instructionCount: countsByDepartmentId.get(departmentId) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return [...orderedInsights, ...orphanInsights];
  }, [departmentOptions, items]);

  const totalInstructionCount = useMemo(() => {
    return departmentInsights.reduce((sum, entry) => sum + entry.instructionCount, 0);
  }, [departmentInsights]);

  const selectedDepartmentName =
    selectedDepartmentId === "all"
      ? "All Departments"
      : departmentInsights.find((entry) => entry.id === selectedDepartmentId)?.name ??
        "Unknown Department";

  const departmentFilteredItems = useMemo(() => {
    if (selectedDepartmentId === "all") {
      return items;
    }

    return items.filter((item) => item.department_id === selectedDepartmentId);
  }, [items, selectedDepartmentId]);

  const filteredItems = useMemo(() => {
    if (!normalizedQuery) {
      return departmentFilteredItems;
    }

    return departmentFilteredItems
      .map((item) => {
        const includeAllInstructions = itemMatchesQuery(item, normalizedQuery);
        if (includeAllInstructions) {
          return item;
        }

        const matchingInstructions = item.work_instructions.filter((instruction) =>
          instructionMatchesQuery(instruction, normalizedQuery),
        );

        if (matchingInstructions.length === 0) {
          return null;
        }

        return {
          ...item,
          work_instructions: matchingInstructions,
        };
      })
      .filter((item): item is DashboardWorkItemData => item !== null);
  }, [departmentFilteredItems, normalizedQuery]);

  const filteredPinnedInstructions = useMemo(() => {
    if (selectedDepartmentId === "all") {
      return pinnedInstructions;
    }

    return pinnedInstructions.filter(
      (instruction) => instruction.workItem.department_id === selectedDepartmentId,
    );
  }, [pinnedInstructions, selectedDepartmentId]);

  const filteredNewestInstructions = useMemo(() => {
    if (selectedDepartmentId === "all") {
      return newestInstructions;
    }

    return newestInstructions.filter(
      (instruction) => instruction.workItem.department_id === selectedDepartmentId,
    );
  }, [newestInstructions, selectedDepartmentId]);

  const visibleWidgets = useMemo(
    () => widgetLayout.filter((widget) => widget.visible),
    [widgetLayout],
  );

  const sortedDepartmentActivity = useMemo(() => {
    return [...departmentInsights].sort((a, b) => b.instructionCount - a.instructionCount);
  }, [departmentInsights]);

  const recentUpdatedItems = useMemo(() => {
    return [...departmentFilteredItems]
      .sort((a, b) => {
        const aTime = new Date(a.updated_at).getTime();
        const bTime = new Date(b.updated_at).getTime();
        return bTime - aTime;
      })
      .slice(0, 8);
  }, [departmentFilteredItems]);

  const flattenedInstructionEntries = useMemo(
    () =>
      items.flatMap((item) =>
        item.work_instructions.map((instruction) => ({
          instruction,
          workItem: item,
        })),
      ),
    [items],
  );

  const myInstructionEntries = useMemo(
    () =>
      flattenedInstructionEntries.filter(
        (entry) => entry.instruction.creator_id === currentUserId,
      ),
    [currentUserId, flattenedInstructionEntries],
  );

  const myDepartmentCount = useMemo(
    () => new Set(myInstructionEntries.map((entry) => entry.workItem.department_id)).size,
    [myInstructionEntries],
  );

  const myLatestEntry = useMemo(() => {
    return [...myInstructionEntries].sort((a, b) => {
      const aTime = new Date(a.instruction.created_at).getTime();
      const bTime = new Date(b.instruction.created_at).getTime();
      return bTime - aTime;
    })[0] ?? null;
  }, [myInstructionEntries]);

  const myRecentEntries = useMemo(() => {
    return [...myInstructionEntries]
      .sort((a, b) => {
        const aTime = new Date(a.instruction.created_at).getTime();
        const bTime = new Date(b.instruction.created_at).getTime();
        return bTime - aTime;
      })
      .slice(0, 3);
  }, [myInstructionEntries]);

  const widgetDefinitionsById = useMemo(
    () => new Map(WIDGET_DEFINITIONS.map((widget) => [widget.id, widget])),
    [],
  );
  const widgetLayoutById = useMemo(
    () => new Map(widgetLayout.map((widget) => [widget.id, widget])),
    [widgetLayout],
  );

  const getAuthHeaders = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Missing session token. Please sign in again.");
    }

    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    };
  }, [supabase]);

  async function saveDashboardLayout() {
    setLayoutSaving(true);
    setLayoutError(null);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/dashboard/layout", {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          dashboardLayout: widgetLayout,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save dashboard layout.");
      }

      setLayoutDirty(false);
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save dashboard layout.";
      setLayoutError(normalizedMessage);
    } finally {
      setLayoutSaving(false);
    }
  }

  function updateWidgetLayout(
    updater: (current: DashboardWidgetLayoutItem[]) => DashboardWidgetLayoutItem[],
  ) {
    setWidgetLayout((current) => {
      const next = updater(current);
      if (next === current) {
        return current;
      }

      setLayoutDirty(true);
      setLayoutError(null);
      return next;
    });
  }

  function toggleWidget(widgetId: DashboardWidgetId) {
    updateWidgetLayout((current) =>
      current.map((widget) =>
        widget.id === widgetId ? { ...widget, visible: !widget.visible } : widget,
      ),
    );
  }

  function updateWidgetSize(widgetId: DashboardWidgetId, size: DashboardWidgetSize) {
    updateWidgetLayout((current) =>
      current.map((widget) => (widget.id === widgetId ? { ...widget, size } : widget)),
    );
  }

  function reorderWidgets(sourceId: DashboardWidgetId, targetId: DashboardWidgetId) {
    if (sourceId === targetId) {
      return;
    }

    updateWidgetLayout((current) => {
      const sourceIndex = current.findIndex((widget) => widget.id === sourceId);
      const targetIndex = current.findIndex((widget) => widget.id === targetId);

      if (sourceIndex < 0 || targetIndex < 0) {
        return current;
      }

      const next = [...current];
      const [movedWidget] = next.splice(sourceIndex, 1);
      if (!movedWidget) {
        return current;
      }

      next.splice(targetIndex, 0, movedWidget);
      return next;
    });
  }

  function resetDashboardLayout() {
    setWidgetLayout([...DEFAULT_WIDGET_LAYOUT]);
    setLayoutDirty(true);
    setLayoutError(null);
  }

  function getMostRecentInstructionForItem(item: DashboardWorkItemData) {
    return [...item.work_instructions].sort((a, b) => {
      const aTime = new Date(a.updated_at).getTime();
      const bTime = new Date(b.updated_at).getTime();
      return bTime - aTime;
    })[0] ?? null;
  }

  function renderWidgetContent(widgetId: DashboardWidgetId) {
    if (widgetId === "finder") {
      const finderSize = widgetLayoutById.get("finder")?.size ?? "full";
      const isFinderCompact = finderSize === "compact";

      return (
        <div className="grid gap-4">
          <div
            className={cn(
              "flex flex-wrap items-center gap-2",
              isFinderCompact ? "justify-start" : "justify-end",
            )}
          >
            {isSystemAdmin ? (
              <Link
                href="/instructions/archived"
                className="inline-flex items-center justify-center rounded-xl border border-slate-400/35 bg-slate-900/10 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-900/15 dark:text-slate-200 dark:hover:bg-white/10"
              >
                Archived Instructions
              </Link>
            ) : null}
            {canEdit ? (
              <Link
                href="/instructions/new"
                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
              >
                Create Instruction
              </Link>
            ) : null}
          </div>

          <div
            className={cn(
              "grid gap-3",
              isFinderCompact ? "grid-cols-1" : "md:grid-cols-[minmax(0,1fr)_260px]",
            )}
          >
            <label className="grid gap-1 text-sm">
              <span className="font-semibold">
                {isFinderCompact ? "Part Number or Mold" : "Part Number or Mold Number"}
              </span>
              <div className="relative">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  ref={searchInputRef}
                  value={query}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Start typing (example: P, PG, PN-4401, Mold-23B)"
                  onChange={(event) => setQuery(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </label>

            <label className="grid gap-1 text-sm">
              <span className="font-semibold">Department</span>
              <select
                value={selectedDepartmentId}
                onChange={(event) => setSelectedDepartmentId(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="all">All Departments</option>
                {departmentInsights.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-2">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Department Insight
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedDepartmentId("all")}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  selectedDepartmentId === "all"
                    ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-800 dark:text-cyan-200"
                    : "border-slate-400/30 bg-slate-900/10 dark:bg-white/10"
                }`}
              >
                All ({totalInstructionCount})
              </button>
              {departmentInsights.map((department) => (
                <button
                  key={department.id}
                  type="button"
                  onClick={() => setSelectedDepartmentId(department.id)}
                  style={{
                    borderColor: colorWithAlpha(
                      department.color_hex,
                      selectedDepartmentId === department.id ? 0.75 : 0.4,
                    ),
                    backgroundColor: colorWithAlpha(
                      department.color_hex,
                      selectedDepartmentId === department.id ? 0.22 : 0.11,
                    ),
                  }}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    selectedDepartmentId === department.id
                      ? "text-slate-900 dark:text-slate-100"
                      : "text-slate-700 dark:text-slate-200"
                  }`}
                >
                  {department.name} ({department.instructionCount})
                </button>
              ))}
            </div>
          </div>

          {searchError ? (
            <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
              {searchError}
            </p>
          ) : null}

          {isSearching ? (
            <div className="grid gap-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {filteredItems.length} matching work item
                {filteredItems.length === 1 ? "" : "s"} for &quot;{query.trim()}&quot; in{" "}
                {selectedDepartmentName}.
              </p>

              {filteredItems.length === 0 ? (
                <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                  No work instructions found.
                </p>
              ) : (
                filteredItems.map((item) => (
                  <article
                    key={item.id}
                    style={{
                      borderColor: colorWithAlpha(item.department_color, 0.45),
                      backgroundColor: colorWithAlpha(item.department_color, 0.12),
                      boxShadow: `inset 4px 0 0 ${colorWithAlpha(item.department_color, 0.9)}`,
                    }}
                    className="grid gap-3 rounded-2xl border p-4"
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="font-bold text-slate-900 dark:text-slate-100">
                          {getLabelWithDepartment(item)}
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-300">
                          {item.item_title}
                        </p>
                      </div>
                      <span
                        style={{
                          borderColor: colorWithAlpha(item.department_color, 0.45),
                          backgroundColor: colorWithAlpha(item.department_color, 0.2),
                        }}
                        className="rounded-full border px-3 py-1 text-xs font-semibold text-slate-900 dark:text-slate-100"
                      >
                        {item.work_instructions.length} instruction
                        {item.work_instructions.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      {item.work_instructions.map((instruction) => (
                        <Link
                          key={instruction.id}
                          href={`/instructions/${instruction.id}`}
                          style={{
                            borderColor: colorWithAlpha(item.department_color, 0.45),
                            backgroundColor: colorWithAlpha(item.department_color, 0.18),
                          }}
                          className="rounded-xl border p-3 transition hover:brightness-105"
                        >
                          <p className="font-semibold">Revision {instruction.revision}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Created <LocalDateTime value={instruction.created_at} mode="date" /> by{" "}
                            {instruction.creator_name}
                          </p>
                        </Link>
                      ))}
                    </div>
                  </article>
                ))
              )}
            </div>
          ) : (
            <p className="rounded-xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              Start typing above to search instructions instantly.
            </p>
          )}
        </div>
      );
    }

    if (widgetId === "pinned") {
      return pinnedError ? (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
          {pinnedError}
        </p>
      ) : filteredPinnedInstructions.length === 0 ? (
        <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          No pinned instructions for {selectedDepartmentName}.
        </p>
      ) : (
        <div className="grid gap-2">
          {filteredPinnedInstructions.map((instruction) => (
            <Link
              key={instruction.id}
              href={`/instructions/${instruction.id}`}
              style={{
                borderColor: colorWithAlpha(instruction.workItem.department_color, 0.45),
                backgroundColor: colorWithAlpha(instruction.workItem.department_color, 0.14),
                boxShadow: `inset 4px 0 0 ${colorWithAlpha(
                  instruction.workItem.department_color,
                  0.85,
                )}`,
              }}
              className="rounded-xl border p-3 transition hover:brightness-105"
            >
              <p className="font-semibold">{getLabelWithDepartment(instruction.workItem)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {instruction.workItem.item_title}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Revision {instruction.revision} | Created{" "}
                <LocalDateTime value={instruction.created_at} mode="date" /> by{" "}
                {instruction.creator_name} | Pinned{" "}
                <LocalDateTime value={instruction.pinned_at} mode="date" />
              </p>
            </Link>
          ))}
        </div>
      );
    }

    if (widgetId === "newest") {
      return newestError ? (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
          {newestError}
        </p>
      ) : filteredNewestInstructions.length === 0 ? (
        <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          No instructions available for {selectedDepartmentName}.
        </p>
      ) : (
        <div className="grid gap-2">
          {filteredNewestInstructions.map((instruction) => (
            <Link
              key={instruction.id}
              href={`/instructions/${instruction.id}`}
              style={{
                borderColor: colorWithAlpha(instruction.workItem.department_color, 0.45),
                backgroundColor: colorWithAlpha(instruction.workItem.department_color, 0.14),
                boxShadow: `inset 4px 0 0 ${colorWithAlpha(
                  instruction.workItem.department_color,
                  0.85,
                )}`,
              }}
              className="rounded-xl border p-3 transition hover:brightness-105"
            >
              <p className="font-semibold">{getLabelWithDepartment(instruction.workItem)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {instruction.workItem.item_title}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Revision {instruction.revision} | Created{" "}
                <LocalDateTime value={instruction.created_at} mode="date" /> by{" "}
                {instruction.creator_name}
              </p>
            </Link>
          ))}
        </div>
      );
    }

    if (widgetId === "department_activity") {
      const rows =
        selectedDepartmentId === "all"
          ? sortedDepartmentActivity
          : sortedDepartmentActivity.filter((entry) => entry.id === selectedDepartmentId);

      const maxInstructionCount = Math.max(
        1,
        ...rows.map((entry) => entry.instructionCount),
      );

      return rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          No department activity to display.
        </p>
      ) : (
        <div className="grid gap-2">
          {rows.map((entry) => {
            const widthPercent = (entry.instructionCount / maxInstructionCount) * 100;

            return (
              <div
                key={entry.id}
                className="rounded-xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {entry.name}
                  </p>
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {entry.instructionCount}
                  </p>
                </div>
                <div className="h-2 rounded-full bg-slate-300/40 dark:bg-slate-700/50">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: `${widthPercent}%`,
                      backgroundColor: colorWithAlpha(entry.color_hex, 0.85),
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (widgetId === "recent_updates") {
      return recentUpdatedItems.length === 0 ? (
        <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          No recent work item updates for {selectedDepartmentName}.
        </p>
      ) : (
        <div className="grid gap-2">
          {recentUpdatedItems.map((item) => {
            const mostRecentInstruction = getMostRecentInstructionForItem(item);

            return (
              <div
                key={item.id}
                style={{
                  borderColor: colorWithAlpha(item.department_color, 0.45),
                  backgroundColor: colorWithAlpha(item.department_color, 0.12),
                }}
                className="rounded-xl border p-3"
              >
                <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">
                      {getLabelWithDepartment(item)}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      {item.item_title}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Updated <LocalDateTime value={item.updated_at} mode="dateTime" />
                  </p>
                </div>

                {mostRecentInstruction ? (
                  <Link
                    href={`/instructions/${mostRecentInstruction.id}`}
                    className="mt-2 inline-flex items-center rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/20 dark:text-cyan-200"
                  >
                    Open latest revision ({mostRecentInstruction.revision})
                  </Link>
                ) : (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    No active instructions for this work item.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div className="grid gap-3">
        <div className="grid gap-2 md:grid-cols-2">
          <ImpactKpiCard
            label="Authored Instructions"
            value={myInstructionEntries.length}
            tooltip="Total active instructions authored by you."
          />
          <ImpactKpiCard
            label="Departments Touched"
            value={myDepartmentCount}
            tooltip="Number of unique departments where you authored at least one instruction."
          />
          <ImpactKpiCard
            label="Total Pins"
            value={pinnedInstructions.length}
            tooltip="Active instructions you pinned for quick access."
          />
          <ImpactKpiCard
            label="Most Recent Authored"
            value={
              myLatestEntry ? (
                <span className="text-xl font-bold">
                  <LocalDateTime value={myLatestEntry.instruction.created_at} mode="date" />
                </span>
              ) : (
                "N/A"
              )
            }
            tooltip="Date of the latest active instruction you authored."
          />
        </div>

        {myRecentEntries.length > 0 ? (
          <div className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Recently Authored
            </p>
            {myRecentEntries.map((entry) => (
              <Link
                key={entry.instruction.id}
                href={`/instructions/${entry.instruction.id}`}
                style={{
                  borderColor: colorWithAlpha(entry.workItem.department_color, 0.45),
                  backgroundColor: colorWithAlpha(entry.workItem.department_color, 0.12),
                }}
                className="rounded-xl border p-3 transition hover:brightness-105"
              >
                <p className="font-semibold">{getLabelWithDepartment(entry.workItem)}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Revision {entry.instruction.revision} | Created{" "}
                  <LocalDateTime value={entry.instruction.created_at} mode="date" />
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
            You have not authored any active instructions yet.
          </p>
        )}
      </div>
    );
  }

  const hiddenWidgets = widgetLayout.filter((widget) => !widget.visible);

  return (
    <div className="grid gap-5">
      <section className="rounded-3xl border border-white/30 bg-white/80 p-4 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
              <BarChart3 size={14} />
              Dashboard Studio
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
              Build Your Workspace
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Add, remove, resize, and drag widgets to match how you work.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCustomizeOpen((current) => !current)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300/70 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-900"
            >
              <LayoutGrid size={14} />
              {customizeOpen ? "Close Customize" : "Customize Widgets"}
            </button>

            <button
              type="button"
              disabled={layoutSaving || !layoutDirty}
              onClick={() => void saveDashboardLayout()}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <Save size={14} />
              {layoutSaving ? "Saving..." : "Save Layout"}
            </button>

            <button
              type="button"
              onClick={resetDashboardLayout}
              disabled={layoutSaving}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300/70 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-900"
            >
              <RefreshCw size={14} />
              Reset Defaults
            </button>
          </div>
        </div>

        {layoutDirty ? (
          <p className="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-200">
            You have unsaved layout changes.
          </p>
        ) : (
          <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">
            Layout is saved for this user account.
          </p>
        )}

        {layoutError ? (
          <p className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-200">
            {layoutError}
          </p>
        ) : null}

        {customizeOpen ? (
          <div className="mt-4 grid gap-2 rounded-2xl border border-slate-300/70 bg-white/65 p-3 dark:border-slate-700 dark:bg-slate-900/50">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Widget Library
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {widgetLayout.map((widget) => {
                const definition = widgetDefinitionsById.get(widget.id);
                if (!definition) {
                  return null;
                }

                return (
                  <article
                    key={widget.id}
                    className="grid gap-2 rounded-xl border border-slate-300/70 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/70"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {definition.title}
                        </p>
                        <p className="text-xs text-slate-600 dark:text-slate-300">
                          {definition.description}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          widget.visible
                            ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200"
                            : "bg-slate-500/20 text-slate-700 dark:text-slate-300"
                        }`}
                      >
                        {widget.visible ? "Visible" : "Hidden"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => toggleWidget(widget.id)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition",
                          widget.visible
                            ? "border-rose-500/40 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:text-rose-200"
                            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-200",
                        )}
                      >
                        {widget.visible ? <X size={12} /> : <Plus size={12} />}
                        {widget.visible ? "Remove" : "Add"}
                      </button>

                      <select
                        value={widget.size}
                        onChange={(event) =>
                          updateWidgetSize(
                            widget.id,
                            event.target.value as DashboardWidgetSize,
                          )
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                      >
                        {WIDGET_SIZE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </article>
                );
              })}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Tip: drag any visible widget card by its grip icon to reorder.
            </p>
          </div>
        ) : hiddenWidgets.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className="text-xs text-slate-600 dark:text-slate-300">Hidden widgets:</p>
            {hiddenWidgets.map((widget) => {
              const definition = widgetDefinitionsById.get(widget.id);
              if (!definition) {
                return null;
              }

              return (
                <button
                  key={widget.id}
                  type="button"
                  onClick={() => toggleWidget(widget.id)}
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-200"
                >
                  <Plus size={12} />
                  {definition.title}
                </button>
              );
            })}
          </div>
        ) : null}
      </section>

      {visibleWidgets.length === 0 ? (
        <section className="rounded-3xl border border-slate-300/70 bg-white/80 p-6 text-center shadow-xl backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/70">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            No widgets are visible right now.
          </p>
          <button
            type="button"
            onClick={() => setCustomizeOpen(true)}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
          >
            <LayoutGrid size={15} />
            Open Widget Library
          </button>
        </section>
      ) : (
        <div className="grid grid-cols-12 gap-4">
          {visibleWidgets.map((widget) => {
            const definition = widgetDefinitionsById.get(widget.id);
            if (!definition) {
              return null;
            }

            const isDragging = draggedWidgetId === widget.id;
            const isDragOverTarget =
              dragOverWidgetId === widget.id && draggedWidgetId !== widget.id;

            return (
              <section
                key={widget.id}
                draggable
                onDragStart={() => setDraggedWidgetId(widget.id)}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (dragOverWidgetId !== widget.id) {
                    setDragOverWidgetId(widget.id);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverWidgetId === widget.id) {
                    setDragOverWidgetId(null);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedWidgetId) {
                    reorderWidgets(draggedWidgetId, widget.id);
                  }
                  setDraggedWidgetId(null);
                  setDragOverWidgetId(null);
                }}
                onDragEnd={() => {
                  setDraggedWidgetId(null);
                  setDragOverWidgetId(null);
                }}
                className={cn(
                  getWidgetSpanClass(widget.size),
                  "rounded-3xl border border-white/30 bg-white/80 p-4 shadow-xl backdrop-blur-xl transition dark:border-white/10 dark:bg-slate-900/70 md:p-5",
                  isDragging ? "scale-[0.99] opacity-70" : "",
                  isDragOverTarget ? "ring-2 ring-cyan-400/80 ring-offset-2 ring-offset-transparent" : "",
                )}
              >
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      aria-label={`Drag to reorder ${definition.title}`}
                      className="mt-0.5 rounded-lg border border-slate-300/70 bg-white/60 p-1.5 text-slate-500 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-900"
                    >
                      <GripVertical size={14} />
                    </button>
                    <div>
                      <h2 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
                        {definition.title}
                      </h2>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        {definition.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                      <span>Size</span>
                      <select
                        value={widget.size}
                        onChange={(event) =>
                          updateWidgetSize(
                            widget.id,
                            event.target.value as DashboardWidgetSize,
                          )
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                      >
                        {WIDGET_SIZE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button
                      type="button"
                      onClick={() => toggleWidget(widget.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-500/20 dark:text-rose-200"
                    >
                      <X size={12} />
                      Remove
                    </button>
                  </div>
                </div>

                {renderWidgetContent(widget.id)}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
