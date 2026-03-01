"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  GripVertical,
  Info,
  Search,
  TriangleAlert,
  ThumbsUp,
  X,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { LocalDateTime } from "@/components/ui/local-date-time";
import {
  DASHBOARD_LAYOUT_PRESETS,
  DASHBOARD_WIDGET_IDS,
  type DashboardWidgetId,
  type DashboardWidgetLayoutItem,
  type DashboardWidgetSize,
  findMatchingDashboardLayoutPreset,
  normalizeDashboardLayout,
} from "@/lib/dashboard-layout";
import {
  DASHBOARD_LAYOUT_COMMAND_EVENT,
  DASHBOARD_LAYOUT_MENU_INTENT_KEY,
  DASHBOARD_LAYOUT_MENU_INTENT_OPEN_CUSTOMIZE,
  DASHBOARD_LAYOUT_STATE_EVENT,
  type DashboardLayoutCommandEventDetail,
  type DashboardLayoutStateEventDetail,
} from "@/lib/dashboard-controls";
import { getUserSettingAtPath } from "@/lib/user-settings";
import {
  fetchCurrentUserSettings,
  patchCurrentUserSetting,
} from "@/lib/user-settings-client";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

interface DashboardWorkItemSummary {
  department_id: string;
  department_name: string;
  department_color: string;
  part_id: string;
  item_title: string;
}

export interface DashboardInstructionCardData {
  id: string;
  revision: number;
  fork_root_instruction_id: string | null;
  fork_number: number | null;
  created_at: string;
  updated_at: string;
  creator_name: string;
  workItem: DashboardWorkItemSummary;
}

export interface DashboardPinnedInstructionCardData
  extends DashboardInstructionCardData {
  pinned_at: string;
}

export interface DashboardLikedInstructionCardData
  extends DashboardInstructionCardData {
  likes_count: number;
  latest_liked_at: string;
}

export interface DashboardLikeCelebrationHighlight {
  instructionId: string;
  label: string;
  newLikesCount: number;
  revision: number;
}

export interface DashboardLikeCelebrationData {
  newLikesCount: number;
  latestNewLikeAt: string;
  highlights: DashboardLikeCelebrationHighlight[];
}

export interface DashboardWorkItemInstructionData {
  id: string;
  revision: number;
  fork_root_instruction_id: string | null;
  fork_number: number | null;
  created_at: string;
  updated_at: string;
  creator_id: string;
  creator_name: string;
  updater_id: string;
  updater_name: string;
}

export interface DashboardWorkItemData extends DashboardWorkItemSummary {
  id: string;
  updated_at: string;
  work_instructions: DashboardWorkItemInstructionData[];
}

export interface DashboardInstructionReviewStatusData {
  instruction_id: string;
  status: "up_to_date" | "needs_review";
  last_calibrated_at: string;
  flagged_at: string | null;
  updated_at: string;
}

interface DashboardDepartmentOption {
  id: string;
  name: string;
  color_hex: string | null;
}

export interface DashboardSystemHistoryEventData {
  id: string;
  occurred_at: string;
  action_label: string;
  actor_name: string;
  detail: string;
  instruction_id: string;
  event_type: "created" | "updated";
  revision: number | null;
  workItem: DashboardWorkItemSummary;
}

interface SystemHistoryChangeCallout {
  id: string;
  label: string;
  actorName: string;
  occurredAt: string;
}

interface SelectedSystemHistoryVersionDetails {
  selectedEvent: DashboardSystemHistoryEventData;
  baselineEvent: DashboardSystemHistoryEventData | null;
  previousEvent: DashboardSystemHistoryEventData | null;
  changesInEvent: SystemHistoryChangeCallout[];
  cumulativeChanges: SystemHistoryChangeCallout[];
}

interface DepartmentInsight {
  id: string;
  name: string;
  color_hex: string;
  instructionCount: number;
}

interface ReviewQueueEntry {
  instruction: DashboardWorkItemInstructionData;
  workItem: DashboardWorkItemData;
  reviewStatus: DashboardInstructionReviewStatusData | null;
  daysSinceUpdate: number | null;
  daysSinceCalibration: number | null;
  isFlagged: boolean;
  isOutOfRange: boolean;
}

interface DashboardWidgetDefinition {
  id: DashboardWidgetId;
  title: string;
  description: string;
  category: "core" | "kpi";
}

interface DashboardClientProps {
  canEdit: boolean;
  isSystemAdmin: boolean;
  initialQuery: string;
  searchError: string | null;
  newestError: string | null;
  pinnedError: string | null;
  pinnedInstructions: DashboardPinnedInstructionCardData[];
  likedInstructions: DashboardLikedInstructionCardData[];
  likeCelebration: DashboardLikeCelebrationData | null;
  newestInstructions: DashboardInstructionCardData[];
  items: DashboardWorkItemData[];
  systemHistoryEvents: DashboardSystemHistoryEventData[];
  departmentOptions: DashboardDepartmentOption[];
  currentUserId: string;
  initialDashboardLayout: unknown;
  initialDashboardDefaultLayout: unknown;
  instructionReviewWindowDays: number;
  instructionReviewStatusByInstructionId: Record<
    string,
    DashboardInstructionReviewStatusData
  >;
}

const DEFAULT_DEPARTMENT_COLOR = "#0EA5E9";
const DASHBOARD_HISTORY_GUARD_STATE_KEY = "__dashboardLayoutUnsavedGuard";
const DASHBOARD_RETURN_STATE_KEY = "__dashboardInstructionReturnState";
const DASHBOARD_RETURN_STATE_MAX_AGE_MS = 1000 * 60 * 30;
const DASHBOARD_LAYOUT_SNAPSHOT_KEY = "__dashboardSavedLayoutSnapshot";
const DASHBOARD_LAYOUT_SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 60 * 4;
const ONE_DAY_MS = 1000 * 60 * 60 * 24;
const CELEBRATION_CONFETTI_COLORS = [
  "#22D3EE",
  "#60A5FA",
  "#34D399",
  "#F59E0B",
  "#FB7185",
];
const DEFAULT_SYSTEM_HISTORY_ROW_LIMIT = 15;
const SYSTEM_HISTORY_ROW_LIMIT_OPTIONS = [5, 15, 30, 45, 60] as const;
const SYSTEM_HISTORY_ROW_LIMIT_SETTING_PATH = [
  "dashboard",
  "systemHistory",
  "rowLimit",
] as const;
const FINDER_DEPARTMENT_INSIGHT_VISIBILITY_SETTING_PATH = [
  "dashboard",
  "finder",
  "departmentInsightVisible",
] as const;
const FINDER_SELECTED_DEPARTMENT_SETTING_PATH = [
  "dashboard",
  "finder",
  "selectedDepartmentId",
] as const;
const RECENT_UPDATES_EVENT_LIMIT = 20;
const DEFAULT_REVIEW_WINDOW_DAYS = 30;

interface DashboardInstructionReturnState {
  query: string;
  selectedDepartmentId: string;
  scrollX: number;
  scrollY: number;
  savedAt: number;
}

interface DashboardSavedLayoutSnapshot {
  userId: string;
  savedAt: number;
  layout: DashboardWidgetLayoutItem[];
}

const WIDGET_DEFINITIONS: DashboardWidgetDefinition[] = [
  {
    id: "finder",
    title: "Find Work Instructions",
    description: "Search and filter active work instructions across departments.",
    category: "core",
  },
  {
    id: "pinned",
    title: "Your Pinned Instructions",
    description: "Quick access to your pinned work instructions.",
    category: "core",
  },
  {
    id: "newest",
    title: "Newest Work Instructions",
    description: "Recently created instructions ordered by newest first.",
    category: "core",
  },
  {
    id: "department_activity",
    title: "Department Activity",
    description: "Instruction volume and activity split by department.",
    category: "core",
  },
  {
    id: "review_queue",
    title: "Needs Review Queue",
    description: "Instructions flagged or out of calibration window.",
    category: "core",
  },
  {
    id: "recent_updates",
    title: "Recently Updated Work Items",
    description: "Most recent system updates with direct links to instructions.",
    category: "core",
  },
  {
    id: "my_impact",
    title: "My Impact Snapshot",
    description: "Your authored activity and engagement summary.",
    category: "core",
  },
  {
    id: "system_history",
    title: "System History",
    description: "Chronological event history with version-check context.",
    category: "core",
  },
  {
    id: "kpi_throughput",
    title: "KPI: Throughput Trend",
    description: "Line graph of daily dashboard event throughput.",
    category: "kpi",
  },
  {
    id: "kpi_creation_velocity",
    title: "KPI: Creation Velocity",
    description: "Area graph of new instruction creation over time.",
    category: "kpi",
  },
  {
    id: "kpi_department_workload",
    title: "KPI: Department Workload",
    description: "Bar graph of event load by department.",
    category: "kpi",
  },
  {
    id: "kpi_review_health",
    title: "KPI: Review Health",
    description: "Stacked graph of healthy versus attention-needed updates.",
    category: "kpi",
  },
  {
    id: "kpi_revision_cycle_time",
    title: "KPI: Revision Cycle Time",
    description: "Scatter graph of days since update versus revision depth.",
    category: "kpi",
  },
  {
    id: "kpi_event_mix",
    title: "KPI: Event Mix",
    description: "Donut graph of created, updated, and review actions.",
    category: "kpi",
  },
];

const WIDGET_SIZE_OPTIONS: Array<{ value: DashboardWidgetSize; label: string }> = [
  { value: "compact", label: "Compact" },
  { value: "standard", label: "Standard" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Full Width" },
];

const RESET_DEFAULT_WIDGET_SIZE_BY_ID: Record<DashboardWidgetId, DashboardWidgetSize> = {
  finder: "full",
  pinned: "standard",
  newest: "standard",
  department_activity: "standard",
  review_queue: "standard",
  recent_updates: "wide",
  my_impact: "standard",
  system_history: "full",
  kpi_throughput: "wide",
  kpi_creation_velocity: "wide",
  kpi_department_workload: "standard",
  kpi_review_health: "wide",
  kpi_revision_cycle_time: "wide",
  kpi_event_mix: "standard",
};

function isDashboardWidgetId(value: string): value is DashboardWidgetId {
  return WIDGET_DEFINITIONS.some((entry) => entry.id === value);
}

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

function toSortableTimestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeReviewWindowDays(value: number) {
  if (!Number.isInteger(value)) {
    return DEFAULT_REVIEW_WINDOW_DAYS;
  }

  if (value < 1 || value > 365) {
    return DEFAULT_REVIEW_WINDOW_DAYS;
  }

  return value;
}

function toElapsedCalendarDays(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const today = new Date();
  const dayStart = new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
  ).getTime();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const elapsed = todayStart - dayStart;
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return null;
  }

  return Math.round(elapsed / (1000 * 60 * 60 * 24));
}

function formatElapsedDaysLabel(daysElapsed: number | null) {
  if (daysElapsed === null) {
    return "Update age unavailable";
  }

  if (daysElapsed === 0) {
    return "Updated today";
  }

  if (daysElapsed === 1) {
    return "Updated 1 day ago";
  }

  return `Updated ${daysElapsed} days ago`;
}

function classifyKpiEventType(
  event: DashboardSystemHistoryEventData,
): "created" | "updated" | "needs_review" | "up_to_date" {
  const normalizedDetail = event.detail.trim().toLowerCase();
  if (normalizedDetail.includes("needs review")) {
    return "needs_review";
  }
  if (normalizedDetail.includes("up to date")) {
    return "up_to_date";
  }
  if (event.event_type === "created") {
    return "created";
  }

  return "updated";
}

function parseSystemHistoryDetailSegments(detail: string) {
  const normalized = detail.trim();
  if (!normalized) {
    return [];
  }

  const segments = normalized
    .split(";")
    .map((segment) => segment.trim().replace(/\.+$/, ""))
    .filter((segment) => segment.length > 0);

  return segments.length > 0
    ? segments
    : [normalized.replace(/\.+$/, "")];
}

function formatSystemHistoryTooltip(actorName: string, occurredAt: string) {
  const parsed = new Date(occurredAt);
  const formattedOccurredAt = Number.isNaN(parsed.getTime())
    ? occurredAt
    : parsed.toLocaleString();
  return `Updated by ${actorName} on ${formattedOccurredAt}`;
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

function pseudoRandom(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function itemMatchesQuery(item: DashboardWorkItemData, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  const haystack =
    `${item.item_title} ${item.part_id} ${item.department_name}`.toLowerCase();
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
    `revision ${instruction.revision} ${instruction.creator_name} ${instruction.updater_name} ` +
    `${formatDateForSearch(instruction.created_at)}`;

  return haystack.toLowerCase().includes(normalizedQuery);
}

function systemHistoryMatchesQuery(
  event: DashboardSystemHistoryEventData,
  normalizedQuery: string,
) {
  if (!normalizedQuery) {
    return true;
  }

  const haystack =
    `${event.action_label} ${event.actor_name} ${event.detail} ` +
    `${event.workItem.item_title} ${event.workItem.part_id} ` +
    `${event.workItem.department_name} ${getPartIdLabel(event.workItem)} ` +
    `${formatDateForSearch(event.occurred_at)}`;

  return haystack.toLowerCase().includes(normalizedQuery);
}

function getPartIdLabel(workItem: DashboardWorkItemSummary) {
  const partId = workItem.part_id?.trim();
  if (partId) {
    return partId;
  }

  return "N/A";
}

function getLabelWithDepartment(workItem: DashboardWorkItemSummary) {
  return `${getPartIdLabel(workItem)} | ${workItem.department_name}`;
}

function getForkLabel(
  forkNumber: number | null | undefined,
  forkRootInstructionId: string | null | undefined,
) {
  if (!forkRootInstructionId || !Number.isInteger(forkNumber) || Number(forkNumber) < 1) {
    return null;
  }

  return `Fork ${forkNumber}`;
}

function PartDepartmentHeading({ workItem }: { workItem: DashboardWorkItemSummary }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
        {getPartIdLabel(workItem)}
      </span>
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
        | {workItem.department_name}
      </span>
    </span>
  );
}

function cloneWidgetLayout(layout: DashboardWidgetLayoutItem[]) {
  return layout.map((entry) => ({ ...entry }));
}

function areWidgetLayoutsEqual(
  first: DashboardWidgetLayoutItem[],
  second: DashboardWidgetLayoutItem[],
) {
  if (first.length !== second.length) {
    return false;
  }

  return first.every((entry, index) => {
    const candidate = second[index];
    return (
      candidate &&
      entry.id === candidate.id &&
      entry.visible === candidate.visible &&
      entry.size === candidate.size
    );
  });
}

function readSavedLayoutSnapshot(userId: string): DashboardWidgetLayoutItem[] | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawSnapshot = window.sessionStorage.getItem(DASHBOARD_LAYOUT_SNAPSHOT_KEY);
    if (!rawSnapshot) {
      return null;
    }

    const parsedSnapshot = JSON.parse(rawSnapshot) as Partial<DashboardSavedLayoutSnapshot>;
    if (
      parsedSnapshot.userId !== userId ||
      typeof parsedSnapshot.savedAt !== "number" ||
      !Array.isArray(parsedSnapshot.layout)
    ) {
      return null;
    }

    if (Date.now() - parsedSnapshot.savedAt > DASHBOARD_LAYOUT_SNAPSHOT_MAX_AGE_MS) {
      window.sessionStorage.removeItem(DASHBOARD_LAYOUT_SNAPSHOT_KEY);
      return null;
    }

    return cloneWidgetLayout(normalizeDashboardLayout(parsedSnapshot.layout));
  } catch {
    return null;
  }
}

function persistSavedLayoutSnapshot(userId: string, layout: DashboardWidgetLayoutItem[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const snapshot: DashboardSavedLayoutSnapshot = {
      userId,
      savedAt: Date.now(),
      layout: cloneWidgetLayout(layout),
    };
    window.sessionStorage.setItem(DASHBOARD_LAYOUT_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Persisting layout snapshot is best-effort.
  }
}

function clearSavedLayoutSnapshot(userId: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const rawSnapshot = window.sessionStorage.getItem(DASHBOARD_LAYOUT_SNAPSHOT_KEY);
    if (!rawSnapshot) {
      return;
    }

    const parsedSnapshot = JSON.parse(rawSnapshot) as Partial<DashboardSavedLayoutSnapshot>;
    if (parsedSnapshot.userId === userId) {
      window.sessionStorage.removeItem(DASHBOARD_LAYOUT_SNAPSHOT_KEY);
    }
  } catch {
    // Snapshot cleanup is best-effort.
  }
}

function shouldCaptureInstructionReturnState(pathname: string) {
  if (!pathname.startsWith("/instructions/")) {
    return false;
  }

  return !pathname.startsWith("/instructions/new") && !pathname.startsWith("/instructions/archived");
}

function getWidgetSpanClass(size: DashboardWidgetSize) {
  switch (size) {
    case "compact":
      return "col-span-12 md:col-span-6 lg:col-span-4";
    case "wide":
      return "col-span-12 lg:col-span-8";
    case "full":
      return "col-span-12";
    case "standard":
    default:
      return "col-span-12 md:col-span-6 lg:col-span-6";
  }
}

function getResetDefaultDashboardLayout() {
  return DASHBOARD_WIDGET_IDS.map((id) => ({
    id,
    visible: true,
    size: RESET_DEFAULT_WIDGET_SIZE_BY_ID[id],
  }));
}

type DashboardPendingNavigation =
  | {
      kind: "history-back";
    }
  | {
      kind: "internal-link";
      href: string;
    }
  | {
      kind: "external-link";
      href: string;
    };

type ImpactDrilldownKey = "authored" | "departments" | "likes" | "recent";

interface ImpactDrilldownEntry {
  id: string;
  href: string;
  label: string;
  detail: string;
  color: string;
}

interface DrilldownPanelData {
  title: string;
  description: string;
  entries: ImpactDrilldownEntry[];
  emptyMessage: string;
}

interface ImpactKpiCardProps {
  label: string;
  value: ReactNode;
  onOpen: () => void;
  compact?: boolean;
}

function ImpactKpiCard({ label, value, onOpen, compact = false }: ImpactKpiCardProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group grid min-w-0 w-full gap-1 rounded-xl border border-slate-300/70 bg-white/70 p-3 text-left transition hover:border-cyan-400/60 hover:bg-cyan-500/10 dark:border-slate-700 dark:bg-slate-900/50 dark:hover:border-cyan-500/50 dark:hover:bg-cyan-500/10"
    >
      <div className="mb-1 flex min-w-0 flex-wrap items-start justify-between gap-1.5">
        <p className="min-w-0 break-words text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {label}
        </p>
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-cyan-700 dark:text-cyan-300">
          {compact ? "Details" : "Drill down"}
          {!compact ? <Info size={12} className="text-cyan-600 dark:text-cyan-300" /> : null}
        </span>
      </div>
      <p className="min-w-0 break-words text-2xl font-extrabold text-slate-900 dark:text-slate-100">
        {value}
      </p>
    </button>
  );
}

type KpiTimeRangeDays = 7 | 30 | 90;

const KPI_TIME_RANGE_OPTIONS: Array<{ value: KpiTimeRangeDays; label: string }> = [
  { value: 7, label: "7D" },
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
];

interface KpiTimeSeriesPoint {
  id: string;
  shortLabel: string;
  fullLabel: string;
  value: number;
}

interface KpiBarPoint {
  id: string;
  label: string;
  value: number;
  color: string;
}

interface KpiStackedPoint {
  id: string;
  shortLabel: string;
  fullLabel: string;
  healthy: number;
  attention: number;
}

interface KpiScatterPoint {
  id: string;
  label: string;
  xValue: number;
  yValue: number;
  color: string;
}

interface KpiDonutSegment {
  id: string;
  label: string;
  value: number;
  color: string;
}

interface KpiDrilldownRow {
  id: string;
  label: string;
  detail: string;
  value: number;
  href?: string;
}

interface KpiDrilldownPanelData {
  title: string;
  subtitle: string;
  yAxisLabel: string;
  rows: KpiDrilldownRow[];
}

function toDayStartTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
}

function formatKpiShortDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

function formatKpiLongDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(timestamp);
}

function formatKpiNumber(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }

  return `${Math.round(value)}`;
}

function getKpiTicks(maxValue: number, steps = 4) {
  const safeMax = Math.max(1, maxValue);
  return Array.from({ length: steps + 1 }, (_, index) => {
    const ratio = (steps - index) / steps;
    return Math.round((safeMax * ratio + Number.EPSILON) * 10) / 10;
  });
}

function KpiTimeRangePicker({
  value,
  onChange,
}: {
  value: KpiTimeRangeDays;
  onChange: (nextValue: KpiTimeRangeDays) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-slate-300/70 bg-white/80 p-1 dark:border-slate-700 dark:bg-slate-900/70">
      {KPI_TIME_RANGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-lg px-2 py-1 text-[11px] font-semibold transition",
            value === option.value
              ? "bg-cyan-500/20 text-cyan-800 dark:text-cyan-100"
              : "text-slate-600 hover:bg-cyan-500/10 dark:text-slate-300 dark:hover:bg-cyan-500/15",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function KpiLineChart({
  points,
  yAxisLabel,
  lineColor = "#06B6D4",
  showArea = false,
  onSelectPoint,
}: {
  points: KpiTimeSeriesPoint[];
  yAxisLabel: string;
  lineColor?: string;
  showArea?: boolean;
  onSelectPoint?: (point: KpiTimeSeriesPoint) => void;
}) {
  const width = 640;
  const height = 220;
  const padding = { top: 16, right: 12, bottom: 34, left: 44 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...points.map((point) => point.value));
  const ticks = getKpiTicks(maxValue);
  const xStep = points.length > 1 ? plotWidth / (points.length - 1) : 0;

  const toX = (index: number) =>
    points.length > 1 ? padding.left + xStep * index : padding.left + plotWidth / 2;
  const toY = (value: number) =>
    padding.top + ((maxValue - value) / maxValue) * plotHeight;

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${toX(index)} ${toY(point.value)}`)
    .join(" ");
  const areaPath =
    points.length > 0
      ? `${linePath} L ${toX(points.length - 1)} ${padding.top + plotHeight} L ${toX(0)} ${
          padding.top + plotHeight
        } Z`
      : "";

  return (
    <div className="grid gap-2">
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-48 min-w-[560px] w-full text-slate-500 dark:text-slate-300"
        >
          <text
            x={12}
            y={padding.top + 8}
            className="fill-current text-[11px] font-semibold"
            transform={`rotate(-90 ${12} ${padding.top + 8})`}
          >
            {yAxisLabel}
          </text>
          {ticks.map((tick) => {
            const y = toY(tick);
            return (
              <g key={`tick-${tick}`}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={padding.left + plotWidth}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity={0.18}
                  strokeWidth={1}
                />
                <text
                  x={padding.left - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-current text-[10px]"
                >
                  {formatKpiNumber(tick)}
                </text>
              </g>
            );
          })}
          {showArea ? (
            <path d={areaPath} fill={lineColor} fillOpacity={0.16} stroke="none" />
          ) : null}
          <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2.5} />
          {points.map((point, index) => (
            <g key={point.id}>
              <circle
                cx={toX(index)}
                cy={toY(point.value)}
                r={4}
                fill={lineColor}
                className={onSelectPoint ? "cursor-pointer" : ""}
                onClick={() => onSelectPoint?.(point)}
              />
              <text
                x={toX(index)}
                y={height - 12}
                textAnchor="middle"
                className="fill-current text-[10px]"
              >
                {point.shortLabel}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Click a point to drill down into the underlying records.
      </p>
    </div>
  );
}

function KpiBarChart({
  bars,
  yAxisLabel,
  onSelectBar,
}: {
  bars: KpiBarPoint[];
  yAxisLabel: string;
  onSelectBar?: (bar: KpiBarPoint) => void;
}) {
  const width = 640;
  const height = 220;
  const padding = { top: 16, right: 12, bottom: 42, left: 44 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...bars.map((bar) => bar.value));
  const ticks = getKpiTicks(maxValue);
  const barSlotWidth = bars.length > 0 ? plotWidth / bars.length : plotWidth;
  const barWidth = Math.max(14, Math.min(42, barSlotWidth - 8));
  const toY = (value: number) => padding.top + ((maxValue - value) / maxValue) * plotHeight;

  return (
    <div className="grid gap-2">
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-48 min-w-[560px] w-full text-slate-500 dark:text-slate-300"
        >
          <text
            x={12}
            y={padding.top + 8}
            className="fill-current text-[11px] font-semibold"
            transform={`rotate(-90 ${12} ${padding.top + 8})`}
          >
            {yAxisLabel}
          </text>
          {ticks.map((tick) => {
            const y = toY(tick);
            return (
              <g key={`bar-tick-${tick}`}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={padding.left + plotWidth}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity={0.18}
                  strokeWidth={1}
                />
                <text
                  x={padding.left - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-current text-[10px]"
                >
                  {formatKpiNumber(tick)}
                </text>
              </g>
            );
          })}
          {bars.map((bar, index) => {
            const x = padding.left + index * barSlotWidth + (barSlotWidth - barWidth) / 2;
            const y = toY(bar.value);
            const barHeight = padding.top + plotHeight - y;

            return (
              <g key={bar.id}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(2, barHeight)}
                  rx={4}
                  fill={bar.color}
                  className={onSelectBar ? "cursor-pointer" : ""}
                  onClick={() => onSelectBar?.(bar)}
                />
                <text
                  x={x + barWidth / 2}
                  y={height - 18}
                  textAnchor="middle"
                  className="fill-current text-[10px]"
                >
                  {bar.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Click a bar to open department-level details.
      </p>
    </div>
  );
}

function KpiStackedBarChart({
  points,
  yAxisLabel,
  onSelectPoint,
}: {
  points: KpiStackedPoint[];
  yAxisLabel: string;
  onSelectPoint?: (point: KpiStackedPoint) => void;
}) {
  const width = 640;
  const height = 220;
  const padding = { top: 16, right: 12, bottom: 34, left: 44 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(
    1,
    ...points.map((point) => point.healthy + point.attention),
  );
  const ticks = getKpiTicks(maxValue);
  const barSlotWidth = points.length > 0 ? plotWidth / points.length : plotWidth;
  const barWidth = Math.max(8, Math.min(24, barSlotWidth - 6));
  const toY = (value: number) => padding.top + ((maxValue - value) / maxValue) * plotHeight;

  return (
    <div className="grid gap-2">
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-48 min-w-[560px] w-full text-slate-500 dark:text-slate-300"
        >
          <text
            x={12}
            y={padding.top + 8}
            className="fill-current text-[11px] font-semibold"
            transform={`rotate(-90 ${12} ${padding.top + 8})`}
          >
            {yAxisLabel}
          </text>
          {ticks.map((tick) => {
            const y = toY(tick);
            return (
              <g key={`stacked-tick-${tick}`}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={padding.left + plotWidth}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity={0.18}
                  strokeWidth={1}
                />
                <text
                  x={padding.left - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-current text-[10px]"
                >
                  {formatKpiNumber(tick)}
                </text>
              </g>
            );
          })}
          {points.map((point, index) => {
            const x = padding.left + index * barSlotWidth + (barSlotWidth - barWidth) / 2;
            const total = point.healthy + point.attention;
            const totalTopY = toY(total);
            const healthyTopY = toY(point.healthy);
            const healthyHeight = padding.top + plotHeight - healthyTopY;
            const attentionHeight = total > 0 ? healthyTopY - totalTopY : 0;

            return (
              <g key={point.id}>
                <rect
                  x={x}
                  y={healthyTopY}
                  width={barWidth}
                  height={Math.max(1, healthyHeight)}
                  rx={3}
                  fill="#22C55E"
                  className={onSelectPoint ? "cursor-pointer" : ""}
                  onClick={() => onSelectPoint?.(point)}
                />
                <rect
                  x={x}
                  y={totalTopY}
                  width={barWidth}
                  height={Math.max(1, attentionHeight)}
                  rx={3}
                  fill="#F59E0B"
                  className={onSelectPoint ? "cursor-pointer" : ""}
                  onClick={() => onSelectPoint?.(point)}
                />
                <text
                  x={x + barWidth / 2}
                  y={height - 12}
                  textAnchor="middle"
                  className="fill-current text-[10px]"
                >
                  {point.shortLabel}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
          Healthy
        </span>
        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
          Needs Attention
        </span>
      </div>
    </div>
  );
}

function KpiScatterChart({
  points,
  xAxisLabel,
  yAxisLabel,
  onSelectPoint,
}: {
  points: KpiScatterPoint[];
  xAxisLabel: string;
  yAxisLabel: string;
  onSelectPoint?: (point: KpiScatterPoint) => void;
}) {
  const width = 640;
  const height = 220;
  const padding = { top: 16, right: 12, bottom: 34, left: 44 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxX = Math.max(1, ...points.map((point) => point.xValue));
  const maxY = Math.max(1, ...points.map((point) => point.yValue));
  const xTicks = getKpiTicks(maxX);
  const yTicks = getKpiTicks(maxY);
  const toX = (value: number) => padding.left + (value / maxX) * plotWidth;
  const toY = (value: number) => padding.top + ((maxY - value) / maxY) * plotHeight;

  return (
    <div className="grid gap-2">
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-48 min-w-[560px] w-full text-slate-500 dark:text-slate-300"
        >
          <text
            x={12}
            y={padding.top + 8}
            className="fill-current text-[11px] font-semibold"
            transform={`rotate(-90 ${12} ${padding.top + 8})`}
          >
            {yAxisLabel}
          </text>
          {yTicks.map((tick) => {
            const y = toY(tick);
            return (
              <g key={`scatter-y-${tick}`}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={padding.left + plotWidth}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity={0.18}
                  strokeWidth={1}
                />
                <text
                  x={padding.left - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-current text-[10px]"
                >
                  {formatKpiNumber(tick)}
                </text>
              </g>
            );
          })}
          {xTicks.map((tick) => {
            const x = toX(tick);
            return (
              <text
                key={`scatter-x-${tick}`}
                x={x}
                y={height - 12}
                textAnchor="middle"
                className="fill-current text-[10px]"
              >
                {formatKpiNumber(tick)}
              </text>
            );
          })}
          {points.map((point) => (
            <circle
              key={point.id}
              cx={toX(point.xValue)}
              cy={toY(point.yValue)}
              r={4}
              fill={point.color}
              fillOpacity={0.85}
              className={onSelectPoint ? "cursor-pointer" : ""}
              onClick={() => onSelectPoint?.(point)}
            />
          ))}
        </svg>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        X-axis {xAxisLabel}. Click any point for instruction-level details.
      </p>
    </div>
  );
}

function KpiDonutChart({
  segments,
  onSelectSegment,
}: {
  segments: KpiDonutSegment[];
  onSelectSegment?: (segment: KpiDonutSegment) => void;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let cumulative = 0;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <svg viewBox="0 0 140 140" className="h-36 w-36">
          <circle cx="70" cy="70" r={radius} fill="none" stroke="#CBD5E1" strokeWidth={18} />
          {total > 0
            ? segments.map((segment) => {
                const segmentLength = (segment.value / total) * circumference;
                const dashOffset = -cumulative;
                cumulative += segmentLength;

                return (
                  <circle
                    key={segment.id}
                    cx="70"
                    cy="70"
                    r={radius}
                    fill="none"
                    stroke={segment.color}
                    strokeWidth={18}
                    strokeDasharray={`${segmentLength} ${circumference - segmentLength}`}
                    strokeDashoffset={dashOffset}
                    transform="rotate(-90 70 70)"
                    className={onSelectSegment ? "cursor-pointer" : ""}
                    onClick={() => onSelectSegment?.(segment)}
                  />
                );
              })
            : null}
          <text
            x="70"
            y="68"
            textAnchor="middle"
            className="fill-slate-700 text-[11px] font-semibold dark:fill-slate-300"
          >
            Total
          </text>
          <text
            x="70"
            y="84"
            textAnchor="middle"
            className="fill-slate-900 text-lg font-extrabold dark:fill-slate-100"
          >
            {total}
          </text>
        </svg>

        <div className="grid gap-1.5">
          {segments.map((segment) => (
            <button
              key={segment.id}
              type="button"
              onClick={() => onSelectSegment?.(segment)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300/70 bg-white/70 px-2.5 py-1 text-left text-xs font-semibold text-slate-700 transition hover:bg-cyan-500/10 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-cyan-500/15"
            >
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: segment.color }}
              />
              <span>{segment.label}</span>
              <span className="ml-auto text-slate-500 dark:text-slate-400">
                {segment.value}
              </span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Click a segment or legend row to open the event drill down.
      </p>
    </div>
  );
}

export function DashboardClient({
  initialQuery,
  searchError,
  newestError,
  pinnedError,
  pinnedInstructions,
  likedInstructions,
  likeCelebration,
  newestInstructions,
  items,
  systemHistoryEvents,
  departmentOptions,
  currentUserId,
  initialDashboardLayout,
  initialDashboardDefaultLayout,
  instructionReviewWindowDays,
  instructionReviewStatusByInstructionId,
}: DashboardClientProps) {
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const realtimeRefreshTimeoutRef = useRef<number | null>(null);
  const layoutDirtyRef = useRef(false);
  const layoutSavingRef = useRef(false);
  const customizeOpenRef = useRef(false);
  const saveLayoutActionRef = useRef<(() => Promise<void>) | null>(null);
  const saveLayoutAsDefaultActionRef = useRef<(() => Promise<void>) | null>(null);
  const loadDefaultLayoutActionRef = useRef<(() => Promise<void>) | null>(null);
  const resetDefaultsActionRef = useRef<(() => Promise<void>) | null>(null);
  const discardLayoutActionRef = useRef<(() => void) | null>(null);
  const applyLayoutPresetActionRef = useRef<((presetId: string) => void) | null>(null);
  const toggleWidgetActionRef = useRef<((widgetId: DashboardWidgetId) => void) | null>(
    null,
  );
  const setWidgetVisibilityActionRef = useRef<
    ((widgetId: DashboardWidgetId, visible: boolean) => void) | null
  >(null);
  const updateWidgetSizeActionRef = useRef<
    ((widgetId: DashboardWidgetId, size: DashboardWidgetSize) => void) | null
  >(null);
  const pointerDragStateRef = useRef<{
    pointerId: number;
    sourceWidgetId: DashboardWidgetId;
  } | null>(null);
  const pendingNavigationRef = useRef<DashboardPendingNavigation | null>(null);
  const navigationModalOpenRef = useRef(false);
  const historyGuardActiveRef = useRef(false);
  const guardScrollRestoreRef = useRef<{
    x: number;
    y: number;
    scrollRestoration: ScrollRestoration;
  } | null>(null);
  const suppressNextPopStateRef = useRef(false);
  const navigationBypassRef = useRef(false);
  const returnStateAppliedRef = useRef(false);
  const finderPreferencesHydratedRef = useRef(false);
  const [query, setQuery] = useState(initialQuery);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("all");
  const [departmentInsightExpanded, setDepartmentInsightExpanded] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [draggedWidgetId, setDraggedWidgetId] = useState<DashboardWidgetId | null>(null);
  const [dragOverWidgetId, setDragOverWidgetId] = useState<DashboardWidgetId | null>(null);
  const [savedWidgetLayout, setSavedWidgetLayout] = useState<DashboardWidgetLayoutItem[]>(() => {
    const snapshotLayout = readSavedLayoutSnapshot(currentUserId);
    return snapshotLayout ?? normalizeDashboardLayout(initialDashboardLayout);
  });
  const [widgetLayout, setWidgetLayout] = useState<DashboardWidgetLayoutItem[]>(() => {
    const snapshotLayout = readSavedLayoutSnapshot(currentUserId);
    return snapshotLayout ?? normalizeDashboardLayout(initialDashboardLayout);
  });
  const [defaultWidgetLayout, setDefaultWidgetLayout] = useState<DashboardWidgetLayoutItem[]>(
    () => normalizeDashboardLayout(initialDashboardDefaultLayout),
  );
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [kpiTimeRangeDays, setKpiTimeRangeDays] = useState<KpiTimeRangeDays>(30);
  const [activeKpiDrilldown, setActiveKpiDrilldown] =
    useState<KpiDrilldownPanelData | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [navigationModalOpen, setNavigationModalOpen] = useState(false);
  const [resetDefaultsModalOpen, setResetDefaultsModalOpen] = useState(false);
  const [layoutNotice, setLayoutNotice] = useState<string | null>(null);
  const [impactDrilldownKey, setImpactDrilldownKey] = useState<ImpactDrilldownKey | null>(null);
  const [departmentDrilldownDepartmentId, setDepartmentDrilldownDepartmentId] =
    useState<string | null>(null);
  const [systemHistoryRowLimit, setSystemHistoryRowLimit] = useState<number>(
    DEFAULT_SYSTEM_HISTORY_ROW_LIMIT,
  );
  const [selectedSystemHistoryEventId, setSelectedSystemHistoryEventId] =
    useState<string | null>(null);
  const [activeLikeCelebration, setActiveLikeCelebration] =
    useState<DashboardLikeCelebrationData | null>(() =>
      (likeCelebration?.newLikesCount ?? 0) > 0 ? likeCelebration : null,
    );
  const [likeCelebrationOpen, setLikeCelebrationOpen] = useState(
    (activeLikeCelebration?.newLikesCount ?? 0) > 0,
  );
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const celebrationConfettiPieces = useMemo(
    () =>
      Array.from({ length: 72 }, (_, index) => ({
        id: index,
        left: pseudoRandom(index + 1) * 100,
        delay: pseudoRandom(index + 41) * 1.4,
        duration: 2.8 + pseudoRandom(index + 97) * 1.9,
        rotation: pseudoRandom(index + 173) * 360,
      })),
    [],
  );
  const normalizedReviewWindowDays = normalizeReviewWindowDays(instructionReviewWindowDays);

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;
  const dispatchLayoutStateToHeader = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const activeLayoutPresetId = findMatchingDashboardLayoutPreset(widgetLayout)?.id ?? null;
    const widgetDefinitionById = new Map(
      WIDGET_DEFINITIONS.map((widgetDefinition) => [
        widgetDefinition.id,
        widgetDefinition,
      ]),
    );
    const studioWidgets = widgetLayout.map((widget) => {
      const definition = widgetDefinitionById.get(widget.id);
      return {
        id: widget.id,
        title: definition?.title ?? widget.id,
        description: definition?.description ?? "",
        visible: widget.visible,
        size: widget.size,
        category: definition?.category ?? "core",
      };
    });

    window.dispatchEvent(
      new CustomEvent<DashboardLayoutStateEventDetail>(DASHBOARD_LAYOUT_STATE_EVENT, {
        detail: {
          available: true,
          customizeOpen,
          layoutDirty,
          layoutSaving,
          layoutError,
          activeLayoutPresetId,
          layoutPresets: DASHBOARD_LAYOUT_PRESETS.map((preset) => ({
            id: preset.id,
            label: preset.label,
          })),
          studioWidgets,
        },
      }),
    );
  }, [customizeOpen, layoutDirty, layoutError, layoutSaving, widgetLayout]);

  const persistInstructionReturnState = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const payload: DashboardInstructionReturnState = {
      query,
      selectedDepartmentId,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      savedAt: Date.now(),
    };

    try {
      window.sessionStorage.setItem(DASHBOARD_RETURN_STATE_KEY, JSON.stringify(payload));
    } catch {
      // Persisting this hint is best-effort and should not block navigation.
    }
  }, [query, selectedDepartmentId]);

  useEffect(() => {
    if (!searchInputRef.current || !initialQuery) {
      return;
    }

    searchInputRef.current.focus();
    const cursorPosition = searchInputRef.current.value.length;
    searchInputRef.current.setSelectionRange(cursorPosition, cursorPosition);
  }, [initialQuery]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    let isActive = true;

    void (async () => {
      const settings = await fetchCurrentUserSettings(supabase);
      if (!settings || !isActive) {
        return;
      }

      const storedDepartmentInsightVisibility = getUserSettingAtPath(
        settings,
        FINDER_DEPARTMENT_INSIGHT_VISIBILITY_SETTING_PATH,
      );
      if (typeof storedDepartmentInsightVisibility === "boolean") {
        setDepartmentInsightExpanded(storedDepartmentInsightVisibility);
      }

      const storedDepartmentId = getUserSettingAtPath(
        settings,
        FINDER_SELECTED_DEPARTMENT_SETTING_PATH,
      );
      if (typeof storedDepartmentId === "string" && storedDepartmentId.trim().length > 0) {
        setSelectedDepartmentId(storedDepartmentId.trim());
      }

      const rawSystemHistoryRowLimit = getUserSettingAtPath(
        settings,
        SYSTEM_HISTORY_ROW_LIMIT_SETTING_PATH,
      );
      const parsedSystemHistoryRowLimit =
        typeof rawSystemHistoryRowLimit === "number"
          ? rawSystemHistoryRowLimit
          : typeof rawSystemHistoryRowLimit === "string"
            ? Number.parseInt(rawSystemHistoryRowLimit, 10)
            : Number.NaN;
      if (
        SYSTEM_HISTORY_ROW_LIMIT_OPTIONS.includes(
          parsedSystemHistoryRowLimit as (typeof SYSTEM_HISTORY_ROW_LIMIT_OPTIONS)[number],
        )
      ) {
        setSystemHistoryRowLimit(parsedSystemHistoryRowLimit);
      }
    })().finally(() => {
      if (isActive) {
        finderPreferencesHydratedRef.current = true;
      }
    });

    return () => {
      isActive = false;
    };
  }, [supabase]);

  useEffect(() => {
    if (!layoutNotice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setLayoutNotice(null);
    }, 2600);

    return () => {
      window.clearTimeout(timer);
    };
  }, [layoutNotice]);

  useEffect(() => {
    if (returnStateAppliedRef.current) {
      return;
    }

    returnStateAppliedRef.current = true;

    let parsed: DashboardInstructionReturnState | null = null;
    try {
      const rawState = window.sessionStorage.getItem(DASHBOARD_RETURN_STATE_KEY);
      if (!rawState) {
        return;
      }

      const candidate = JSON.parse(rawState) as Partial<DashboardInstructionReturnState>;
      if (
        typeof candidate.query === "string" &&
        typeof candidate.selectedDepartmentId === "string" &&
        typeof candidate.scrollX === "number" &&
        typeof candidate.scrollY === "number" &&
        typeof candidate.savedAt === "number"
      ) {
        parsed = {
          query: candidate.query,
          selectedDepartmentId: candidate.selectedDepartmentId,
          scrollX: candidate.scrollX,
          scrollY: candidate.scrollY,
          savedAt: candidate.savedAt,
        };
      }
    } catch {
      window.sessionStorage.removeItem(DASHBOARD_RETURN_STATE_KEY);
      return;
    }

    if (!parsed) {
      window.sessionStorage.removeItem(DASHBOARD_RETURN_STATE_KEY);
      return;
    }

    if (Date.now() - parsed.savedAt > DASHBOARD_RETURN_STATE_MAX_AGE_MS) {
      window.sessionStorage.removeItem(DASHBOARD_RETURN_STATE_KEY);
      return;
    }

    setQuery(parsed.query);
    setSelectedDepartmentId(parsed.selectedDepartmentId || "all");
    window.sessionStorage.removeItem(DASHBOARD_RETURN_STATE_KEY);

    const applyScroll = () => {
      window.scrollTo({
        left: parsed.scrollX,
        top: parsed.scrollY,
        behavior: "auto",
      });
    };

    applyScroll();
    window.requestAnimationFrame(() => {
      applyScroll();
      window.requestAnimationFrame(() => {
        applyScroll();
      });
    });
  }, []);

  useEffect(() => {
    if ((activeLikeCelebration?.newLikesCount ?? 0) <= 0) {
      setLikeCelebrationOpen(false);
      return;
    }

    setLikeCelebrationOpen(true);
    const timer = window.setTimeout(() => {
      setLikeCelebrationOpen(false);
    }, 7000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeLikeCelebration?.latestNewLikeAt, activeLikeCelebration?.newLikesCount]);

  useEffect(() => {
    if (!finderPreferencesHydratedRef.current) {
      return;
    }

    void patchCurrentUserSetting({
      supabase,
      path: SYSTEM_HISTORY_ROW_LIMIT_SETTING_PATH.join("."),
      value: systemHistoryRowLimit,
    });
  }, [supabase, systemHistoryRowLimit]);

  useEffect(() => {
    if (!finderPreferencesHydratedRef.current) {
      return;
    }

    void patchCurrentUserSetting({
      supabase,
      path: FINDER_DEPARTMENT_INSIGHT_VISIBILITY_SETTING_PATH.join("."),
      value: departmentInsightExpanded,
    });
  }, [departmentInsightExpanded, supabase]);

  useEffect(() => {
    if (!finderPreferencesHydratedRef.current) {
      return;
    }

    void patchCurrentUserSetting({
      supabase,
      path: FINDER_SELECTED_DEPARTMENT_SETTING_PATH.join("."),
      value: selectedDepartmentId,
    });
  }, [selectedDepartmentId, supabase]);

  useEffect(() => {
    try {
      const menuIntent = window.sessionStorage.getItem(DASHBOARD_LAYOUT_MENU_INTENT_KEY);
      if (menuIntent === DASHBOARD_LAYOUT_MENU_INTENT_OPEN_CUSTOMIZE) {
        setCustomizeOpen(true);
      }
    } catch {
      // Session menu intent is best-effort.
    } finally {
      try {
        window.sessionStorage.removeItem(DASHBOARD_LAYOUT_MENU_INTENT_KEY);
      } catch {
        // Session menu intent cleanup is best-effort.
      }
    }
  }, []);

  useEffect(() => {
    layoutDirtyRef.current = layoutDirty;
  }, [layoutDirty]);

  useEffect(() => {
    layoutSavingRef.current = layoutSaving;
  }, [layoutSaving]);

  useEffect(() => {
    customizeOpenRef.current = customizeOpen;
    if (!customizeOpen) {
      clearWidgetPointerDragState();
      setActiveKpiDrilldown(null);
    }
  }, [customizeOpen]);

  useEffect(() => {
    return () => {
      pointerDragStateRef.current = null;
    };
  }, []);

  useEffect(() => {
    dispatchLayoutStateToHeader();
  }, [dispatchLayoutStateToHeader]);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") {
        return;
      }

      window.dispatchEvent(
        new CustomEvent<DashboardLayoutStateEventDetail>(DASHBOARD_LAYOUT_STATE_EVENT, {
          detail: {
            available: false,
            customizeOpen: false,
            layoutDirty: false,
            layoutSaving: false,
            layoutError: null,
            activeLayoutPresetId: null,
            layoutPresets: [],
            studioWidgets: [],
          },
        }),
      );
    };
  }, []);

  useEffect(() => {
    const serverDefaultLayout = normalizeDashboardLayout(initialDashboardDefaultLayout);
    setDefaultWidgetLayout(cloneWidgetLayout(serverDefaultLayout));

    if (layoutDirtyRef.current) {
      return;
    }

    const serverLayout = normalizeDashboardLayout(initialDashboardLayout);
    const snapshotLayout = readSavedLayoutSnapshot(currentUserId);
    const nextLayout = snapshotLayout ?? serverLayout;

    setSavedWidgetLayout(cloneWidgetLayout(nextLayout));
    setWidgetLayout(cloneWidgetLayout(nextLayout));
    setLayoutDirty(false);

    if (snapshotLayout && areWidgetLayoutsEqual(snapshotLayout, serverLayout)) {
      clearSavedLayoutSnapshot(currentUserId);
    }
  }, [currentUserId, initialDashboardDefaultLayout, initialDashboardLayout]);

  useEffect(() => {
    navigationModalOpenRef.current = navigationModalOpen;
  }, [navigationModalOpen]);

  const restoreGuardScrollPosition = useCallback(() => {
    const pendingRestore = guardScrollRestoreRef.current;
    if (!pendingRestore) {
      return;
    }

    const applyScroll = () => {
      window.scrollTo({
        left: pendingRestore.x,
        top: pendingRestore.y,
        behavior: "auto",
      });
    };

    applyScroll();
    window.requestAnimationFrame(() => {
      applyScroll();
      window.requestAnimationFrame(() => {
        applyScroll();
        window.history.scrollRestoration = pendingRestore.scrollRestoration;
        guardScrollRestoreRef.current = null;
      });
    });
  }, []);

  const releaseHistoryGuard = useCallback(() => {
    if (!historyGuardActiveRef.current) {
      return;
    }

    guardScrollRestoreRef.current = {
      x: window.scrollX,
      y: window.scrollY,
      scrollRestoration: window.history.scrollRestoration,
    };
    window.history.scrollRestoration = "manual";
    suppressNextPopStateRef.current = true;
    historyGuardActiveRef.current = false;
    window.history.back();
    window.setTimeout(() => {
      restoreGuardScrollPosition();
    }, 0);
  }, [restoreGuardScrollPosition]);

  const navigateWithGuardReleased = useCallback(
    (navigate: () => void) => {
      if (historyGuardActiveRef.current) {
        releaseHistoryGuard();
        window.setTimeout(() => {
          navigate();
        }, 0);
        return;
      }

      navigate();
    },
    [releaseHistoryGuard],
  );

  useEffect(() => {
    if (!layoutDirty) {
      if (historyGuardActiveRef.current) {
        releaseHistoryGuard();
      }

      pendingNavigationRef.current = null;
      setNavigationModalOpen(false);
      navigationBypassRef.current = false;
      return;
    }

    if (!historyGuardActiveRef.current) {
      window.history.pushState(
        { [DASHBOARD_HISTORY_GUARD_STATE_KEY]: true },
        "",
        window.location.href,
      );
      historyGuardActiveRef.current = true;
    }
  }, [layoutDirty, releaseHistoryGuard]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!layoutDirtyRef.current || navigationBypassRef.current) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      if (suppressNextPopStateRef.current) {
        suppressNextPopStateRef.current = false;
        restoreGuardScrollPosition();
        return;
      }

      if (!layoutDirtyRef.current || navigationBypassRef.current) {
        historyGuardActiveRef.current = false;
        return;
      }

      if (navigationModalOpenRef.current) {
        window.history.pushState(
          { [DASHBOARD_HISTORY_GUARD_STATE_KEY]: true },
          "",
          window.location.href,
        );
        historyGuardActiveRef.current = true;
        return;
      }

      window.history.pushState(
        { [DASHBOARD_HISTORY_GUARD_STATE_KEY]: true },
        "",
        window.location.href,
      );
      historyGuardActiveRef.current = true;
      openNavigationModal({ kind: "history-back" });
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [restoreGuardScrollPosition]);

  useEffect(() => {
    const handleDocumentNavigation = (event: MouseEvent) => {
      if (!layoutDirtyRef.current || navigationBypassRef.current) {
        return;
      }

      if (event.defaultPrevented || event.button !== 0) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const target = event.target as Element | null;
      const anchor = target?.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      if (anchor.target && anchor.target !== "_self") {
        return;
      }

      if (anchor.hasAttribute("download")) {
        return;
      }

      let destination: URL;
      try {
        destination = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      if (destination.href === window.location.href) {
        return;
      }

      event.preventDefault();
      if (destination.origin === window.location.origin) {
        openNavigationModal({ kind: "internal-link", href: destination.href });
      } else {
        openNavigationModal({ kind: "external-link", href: destination.href });
      }
    };

    document.addEventListener("click", handleDocumentNavigation, true);
    return () => {
      document.removeEventListener("click", handleDocumentNavigation, true);
    };
  }, []);

  useEffect(() => {
    const handleInstructionNavigationCapture = (event: MouseEvent) => {
      if (layoutDirtyRef.current || event.defaultPrevented || event.button !== 0) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const target = event.target as Element | null;
      const anchor = target?.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      if (anchor.target && anchor.target !== "_self") {
        return;
      }

      if (anchor.hasAttribute("download")) {
        return;
      }

      let destination: URL;
      try {
        destination = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      if (destination.origin !== window.location.origin) {
        return;
      }

      if (!shouldCaptureInstructionReturnState(destination.pathname)) {
        return;
      }

      persistInstructionReturnState();
    };

    document.addEventListener("click", handleInstructionNavigationCapture, true);
    return () => {
      document.removeEventListener("click", handleInstructionNavigationCapture, true);
    };
  }, [persistInstructionReturnState]);

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
        { event: "*", schema: "public", table: "instruction_likes" },
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

  useEffect(() => {
    if (selectedDepartmentId === "all") {
      return;
    }

    const departmentStillExists = departmentInsights.some(
      (department) => department.id === selectedDepartmentId,
    );
    if (!departmentStillExists) {
      setSelectedDepartmentId("all");
    }
  }, [departmentInsights, selectedDepartmentId]);

  const totalInstructionCount = useMemo(() => {
    return departmentInsights.reduce((sum, entry) => sum + entry.instructionCount, 0);
  }, [departmentInsights]);
  const totalDepartmentCount = departmentInsights.length;
  const shouldScrollDepartmentInsight = totalDepartmentCount > 15;

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

  const departmentFilteredSystemHistoryEvents = useMemo(() => {
    if (selectedDepartmentId === "all") {
      return systemHistoryEvents;
    }

    return systemHistoryEvents.filter(
      (event) => event.workItem.department_id === selectedDepartmentId,
    );
  }, [selectedDepartmentId, systemHistoryEvents]);

  const filteredSystemHistoryEvents = useMemo(() => {
    if (!normalizedQuery) {
      return departmentFilteredSystemHistoryEvents;
    }

    return departmentFilteredSystemHistoryEvents.filter((event) =>
      systemHistoryMatchesQuery(event, normalizedQuery),
    );
  }, [departmentFilteredSystemHistoryEvents, normalizedQuery]);

  const visibleSystemHistoryEvents = useMemo(
    () => filteredSystemHistoryEvents.slice(0, systemHistoryRowLimit),
    [filteredSystemHistoryEvents, systemHistoryRowLimit],
  );

  const systemHistoryTimelineByInstruction = useMemo(() => {
    const eventsByInstruction = new Map<string, DashboardSystemHistoryEventData[]>();

    for (const event of filteredSystemHistoryEvents) {
      const existingEvents = eventsByInstruction.get(event.instruction_id) ?? [];
      existingEvents.push(event);
      eventsByInstruction.set(event.instruction_id, existingEvents);
    }

    for (const [instructionId, instructionEvents] of eventsByInstruction.entries()) {
      eventsByInstruction.set(
        instructionId,
        [...instructionEvents].sort(
          (a, b) => toSortableTimestamp(a.occurred_at) - toSortableTimestamp(b.occurred_at),
        ),
      );
    }

    return eventsByInstruction;
  }, [filteredSystemHistoryEvents]);

  const selectedSystemHistoryVersionDetails = useMemo<SelectedSystemHistoryVersionDetails | null>(
    () => {
      if (!selectedSystemHistoryEventId) {
        return null;
      }

      const selectedEvent =
        filteredSystemHistoryEvents.find((event) => event.id === selectedSystemHistoryEventId) ??
        null;
      if (!selectedEvent) {
        return null;
      }

      const instructionTimeline =
        systemHistoryTimelineByInstruction.get(selectedEvent.instruction_id) ?? [selectedEvent];
      const selectedEventIndex = instructionTimeline.findIndex(
        (event) => event.id === selectedEvent.id,
      );
      const safeSelectedIndex =
        selectedEventIndex >= 0 ? selectedEventIndex : instructionTimeline.length - 1;

      const toChangeCallouts = (events: DashboardSystemHistoryEventData[]) => {
        const calloutsByKey = new Map<string, SystemHistoryChangeCallout>();
        for (const event of events) {
          const segments = parseSystemHistoryDetailSegments(event.detail);
          for (const segment of segments) {
            const key = segment.toLowerCase();
            calloutsByKey.set(key, {
              id: `${event.id}:${key}`,
              label: segment,
              actorName: event.actor_name,
              occurredAt: event.occurred_at,
            });
          }
        }
        return [...calloutsByKey.values()];
      };

      return {
        selectedEvent,
        baselineEvent: instructionTimeline[0] ?? null,
        previousEvent:
          safeSelectedIndex > 0 ? instructionTimeline[safeSelectedIndex - 1] : null,
        changesInEvent: toChangeCallouts([selectedEvent]),
        cumulativeChanges: toChangeCallouts(instructionTimeline.slice(1, safeSelectedIndex + 1)),
      };
    },
    [
      filteredSystemHistoryEvents,
      selectedSystemHistoryEventId,
      systemHistoryTimelineByInstruction,
    ],
  );

  useEffect(() => {
    setSelectedSystemHistoryEventId((currentSelection) => {
      if (!currentSelection) {
        return null;
      }

      if (visibleSystemHistoryEvents.length === 0) {
        return null;
      }

      if (visibleSystemHistoryEvents.some((event) => event.id === currentSelection)) {
        return currentSelection;
      }

      return null;
    });
  }, [visibleSystemHistoryEvents]);

  const visibleWidgets = useMemo(
    () => widgetLayout.filter((widget) => widget.visible),
    [widgetLayout],
  );

  const sortedDepartmentActivity = useMemo(() => {
    return [...departmentInsights].sort((a, b) => b.instructionCount - a.instructionCount);
  }, [departmentInsights]);

  const recentUpdateEvents = useMemo(() => {
    return filteredSystemHistoryEvents
      .filter((event) => event.event_type === "updated")
      .slice(0, RECENT_UPDATES_EVENT_LIMIT);
  }, [filteredSystemHistoryEvents]);

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

  const reviewQueueEntries = useMemo<ReviewQueueEntry[]>(() => {
    const departmentScoped =
      selectedDepartmentId === "all"
        ? flattenedInstructionEntries
        : flattenedInstructionEntries.filter(
            (entry) => entry.workItem.department_id === selectedDepartmentId,
          );

    const queryScoped = normalizedQuery
      ? departmentScoped.filter(
          (entry) =>
            itemMatchesQuery(entry.workItem, normalizedQuery) ||
            instructionMatchesQuery(entry.instruction, normalizedQuery),
        )
      : departmentScoped;

    return queryScoped
      .map((entry) => {
        const reviewStatus =
          instructionReviewStatusByInstructionId[entry.instruction.id] ?? null;
        const daysSinceCalibration = toElapsedCalendarDays(
          reviewStatus?.last_calibrated_at ?? entry.instruction.updated_at,
        );
        const daysSinceUpdate = toElapsedCalendarDays(entry.instruction.updated_at);
        const isFlagged = reviewStatus?.status === "needs_review";
        const isOutOfRange =
          daysSinceCalibration !== null &&
          daysSinceCalibration >= normalizedReviewWindowDays;

        return {
          instruction: entry.instruction,
          workItem: entry.workItem,
          reviewStatus,
          daysSinceUpdate,
          daysSinceCalibration,
          isFlagged,
          isOutOfRange,
        };
      })
      .filter((entry) => entry.isFlagged || entry.isOutOfRange)
      .sort((a, b) => {
        if (a.isFlagged !== b.isFlagged) {
          return a.isFlagged ? -1 : 1;
        }

        const daysGapA = a.daysSinceCalibration ?? -1;
        const daysGapB = b.daysSinceCalibration ?? -1;
        if (daysGapA !== daysGapB) {
          return daysGapB - daysGapA;
        }

        return (
          toSortableTimestamp(a.instruction.updated_at) -
          toSortableTimestamp(b.instruction.updated_at)
        );
      })
      .slice(0, 12);
  }, [
    flattenedInstructionEntries,
    normalizedQuery,
    selectedDepartmentId,
    instructionReviewStatusByInstructionId,
    normalizedReviewWindowDays,
  ]);

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

  const totalAuthoredLikes = useMemo(
    () =>
      likedInstructions.reduce((sum, instruction) => sum + instruction.likes_count, 0),
    [likedInstructions],
  );

  useEffect(() => {
    if ((likeCelebration?.newLikesCount ?? 0) > 0) {
      setActiveLikeCelebration(likeCelebration);
      return;
    }

    setActiveLikeCelebration(null);
  }, [likeCelebration]);

  useEffect(() => {
    if ((activeLikeCelebration?.newLikesCount ?? 0) <= 0) {
      return;
    }

    const seenAt = activeLikeCelebration?.latestNewLikeAt;
    if (!seenAt) {
      return;
    }

    void (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token) {
          return;
        }

        await fetch("/api/instruction-likes/mark-seen", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ seenAt }),
        });
      } catch {
        // This acknowledgement is best-effort and should never block dashboard usage.
      }
    })();
  }, [activeLikeCelebration?.latestNewLikeAt, activeLikeCelebration?.newLikesCount, supabase]);

  const authoredDrilldownEntries = useMemo<ImpactDrilldownEntry[]>(() => {
    return [...myInstructionEntries]
      .sort((a, b) => {
        const aTime = new Date(a.instruction.created_at).getTime();
        const bTime = new Date(b.instruction.created_at).getTime();
        return bTime - aTime;
      })
      .slice(0, 12)
      .map((entry) => ({
        id: entry.instruction.id,
        href: `/instructions/${entry.instruction.id}`,
        label: getLabelWithDepartment(entry.workItem),
        detail: `Revision ${entry.instruction.revision} | Created ${new Date(
          entry.instruction.created_at,
        ).toLocaleDateString()}`,
        color: entry.workItem.department_color,
      }));
  }, [myInstructionEntries]);

  const departmentsDrilldownEntries = useMemo<ImpactDrilldownEntry[]>(() => {
    const latestByDepartment = new Map<
      string,
      {
        entry: (typeof myInstructionEntries)[number];
        timestamp: number;
      }
    >();

    for (const entry of myInstructionEntries) {
      const timestamp = new Date(entry.instruction.created_at).getTime();
      const existing = latestByDepartment.get(entry.workItem.department_id);

      if (!existing || timestamp > existing.timestamp) {
        latestByDepartment.set(entry.workItem.department_id, { entry, timestamp });
      }
    }

    return [...latestByDepartment.values()]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 12)
      .map(({ entry }) => ({
        id: entry.instruction.id,
        href: `/instructions/${entry.instruction.id}`,
        label: getLabelWithDepartment(entry.workItem),
        detail: `Latest authored item for ${entry.workItem.department_name} | Revision ${entry.instruction.revision}`,
        color: entry.workItem.department_color,
      }));
  }, [myInstructionEntries]);

  const likesDrilldownEntries = useMemo<ImpactDrilldownEntry[]>(() => {
    return [...likedInstructions]
      .sort((a, b) => {
        const aTime = new Date(a.latest_liked_at).getTime();
        const bTime = new Date(b.latest_liked_at).getTime();
        return bTime - aTime;
      })
      .slice(0, 12)
      .map((instruction) => ({
        id: instruction.id,
        href: `/instructions/${instruction.id}`,
        label: getLabelWithDepartment(instruction.workItem),
        detail: `${instruction.likes_count} like${instruction.likes_count === 1 ? "" : "s"} | Latest ${new Date(
          instruction.latest_liked_at,
        ).toLocaleDateString()}`,
        color: instruction.workItem.department_color,
      }));
  }, [likedInstructions]);

  const recentDrilldownEntries = useMemo<ImpactDrilldownEntry[]>(() => {
    if (!myLatestEntry) {
      return [];
    }

    return [
      {
        id: myLatestEntry.instruction.id,
        href: `/instructions/${myLatestEntry.instruction.id}`,
        label: getLabelWithDepartment(myLatestEntry.workItem),
        detail: `Revision ${myLatestEntry.instruction.revision} | Created ${new Date(
          myLatestEntry.instruction.created_at,
        ).toLocaleDateString()}`,
        color: myLatestEntry.workItem.department_color,
      },
    ];
  }, [myLatestEntry]);

  const activeImpactDrilldown = useMemo<DrilldownPanelData | null>(() => {
    if (!impactDrilldownKey) {
      return null;
    }

    if (impactDrilldownKey === "authored") {
      return {
        title: "Authored Instructions",
        description: "Latest active instructions you authored.",
        entries: authoredDrilldownEntries,
        emptyMessage: "No authored instructions yet.",
      };
    }

    if (impactDrilldownKey === "departments") {
      return {
        title: "Departments Touched",
        description: "Latest authored instruction per department.",
        entries: departmentsDrilldownEntries,
        emptyMessage: "No department activity yet.",
      };
    }

    if (impactDrilldownKey === "likes") {
      return {
        title: "Instructions You Were Liked For",
        description: "Active authored instructions that received likes.",
        entries: likesDrilldownEntries,
        emptyMessage: "No likes received yet.",
      };
    }

    return {
      title: "Most Recent Authored",
      description: "Your latest authored active instruction.",
      entries: recentDrilldownEntries,
      emptyMessage: "No authored instructions yet.",
    };
  }, [
    authoredDrilldownEntries,
    departmentsDrilldownEntries,
    impactDrilldownKey,
    likesDrilldownEntries,
    recentDrilldownEntries,
  ]);

  const activeDepartmentDrilldown = useMemo<DrilldownPanelData | null>(() => {
    if (!departmentDrilldownDepartmentId) {
      return null;
    }

    const department = departmentInsights.find(
      (entry) => entry.id === departmentDrilldownDepartmentId,
    );
    if (!department) {
      return null;
    }

    const entries: ImpactDrilldownEntry[] = flattenedInstructionEntries
      .filter((entry) => entry.workItem.department_id === department.id)
      .sort((a, b) => {
        const aTime = new Date(a.instruction.updated_at).getTime();
        const bTime = new Date(b.instruction.updated_at).getTime();
        return bTime - aTime;
      })
      .slice(0, 24)
      .map((entry) => ({
        id: entry.instruction.id,
        href: `/instructions/${entry.instruction.id}`,
        label: getLabelWithDepartment(entry.workItem),
        detail: `Revision ${entry.instruction.revision} | Updated by ${entry.instruction.updater_name} on ${new Date(
          entry.instruction.updated_at,
        ).toLocaleDateString()}`,
        color: entry.workItem.department_color,
      }));

    return {
      title: `${department.name} Activity`,
      description: "Latest active instruction updates for this department.",
      entries,
      emptyMessage: "No active instructions in this department.",
    };
  }, [departmentDrilldownDepartmentId, departmentInsights, flattenedInstructionEntries]);

  const kpiDateBuckets = useMemo(() => {
    const today = new Date();
    const todayStart = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    ).getTime();

    return Array.from({ length: kpiTimeRangeDays }, (_, index) => {
      const offset = kpiTimeRangeDays - 1 - index;
      const start = todayStart - offset * ONE_DAY_MS;
      return {
        id: `kpi-day-${start}`,
        start,
        end: start + ONE_DAY_MS,
        shortLabel: formatKpiShortDate(start),
        fullLabel: formatKpiLongDate(start),
      };
    });
  }, [kpiTimeRangeDays]);

  const kpiRangeStart = kpiDateBuckets[0]?.start ?? 0;
  const kpiRangeEnd = (kpiDateBuckets[kpiDateBuckets.length - 1]?.end ?? 0) + 1;
  const kpiBucketIndexByStart = useMemo(
    () => new Map(kpiDateBuckets.map((bucket, index) => [bucket.start, index])),
    [kpiDateBuckets],
  );

  const kpiEventsInRange = useMemo(() => {
    return filteredSystemHistoryEvents
      .map((event) => ({
        event,
        timestamp: toSortableTimestamp(event.occurred_at),
      }))
      .filter(
        (entry) =>
          entry.timestamp >= kpiRangeStart &&
          entry.timestamp < kpiRangeEnd &&
          entry.timestamp > 0,
      );
  }, [filteredSystemHistoryEvents, kpiRangeEnd, kpiRangeStart]);

  const kpiInstructionEntriesScoped = useMemo(() => {
    const departmentScoped =
      selectedDepartmentId === "all"
        ? flattenedInstructionEntries
        : flattenedInstructionEntries.filter(
            (entry) => entry.workItem.department_id === selectedDepartmentId,
          );

    if (!normalizedQuery) {
      return departmentScoped;
    }

    return departmentScoped.filter(
      (entry) =>
        itemMatchesQuery(entry.workItem, normalizedQuery) ||
        instructionMatchesQuery(entry.instruction, normalizedQuery),
    );
  }, [flattenedInstructionEntries, normalizedQuery, selectedDepartmentId]);

  const throughputMetric = useMemo(() => {
    const points = kpiDateBuckets.map((bucket) => ({
      id: bucket.id,
      shortLabel: bucket.shortLabel,
      fullLabel: bucket.fullLabel,
      value: 0,
    }));
    const rowsByPointId = new Map<string, KpiDrilldownRow[]>();

    for (const { event, timestamp } of kpiEventsInRange) {
      const dayStart = toDayStartTimestamp(event.occurred_at);
      if (dayStart === null) {
        continue;
      }
      const bucketIndex = kpiBucketIndexByStart.get(dayStart);
      if (bucketIndex === undefined) {
        continue;
      }

      const point = points[bucketIndex];
      if (!point) {
        continue;
      }

      point.value += 1;
      const existing = rowsByPointId.get(point.id) ?? [];
      existing.push({
        id: event.id,
        label: getLabelWithDepartment(event.workItem),
        detail: `${event.action_label} by ${event.actor_name} at ${new Date(
          timestamp,
        ).toLocaleTimeString()}`,
        value: 1,
        href: `/instructions/${event.instruction_id}`,
      });
      rowsByPointId.set(point.id, existing);
    }

    return { points, rowsByPointId };
  }, [kpiBucketIndexByStart, kpiDateBuckets, kpiEventsInRange]);

  const creationVelocityMetric = useMemo(() => {
    const points = kpiDateBuckets.map((bucket) => ({
      id: `${bucket.id}-created`,
      shortLabel: bucket.shortLabel,
      fullLabel: bucket.fullLabel,
      value: 0,
    }));
    const rowsByPointId = new Map<string, KpiDrilldownRow[]>();

    for (const entry of kpiInstructionEntriesScoped) {
      const timestamp = toSortableTimestamp(entry.instruction.created_at);
      if (timestamp < kpiRangeStart || timestamp >= kpiRangeEnd || timestamp <= 0) {
        continue;
      }

      const dayStart = toDayStartTimestamp(entry.instruction.created_at);
      if (dayStart === null) {
        continue;
      }

      const bucketIndex = kpiBucketIndexByStart.get(dayStart);
      if (bucketIndex === undefined) {
        continue;
      }

      const point = points[bucketIndex];
      if (!point) {
        continue;
      }

      point.value += 1;
      const existing = rowsByPointId.get(point.id) ?? [];
      existing.push({
        id: entry.instruction.id,
        label: getLabelWithDepartment(entry.workItem),
        detail: `Revision ${entry.instruction.revision} created by ${entry.instruction.creator_name}`,
        value: 1,
        href: `/instructions/${entry.instruction.id}`,
      });
      rowsByPointId.set(point.id, existing);
    }

    return { points, rowsByPointId };
  }, [
    kpiInstructionEntriesScoped,
    kpiBucketIndexByStart,
    kpiDateBuckets,
    kpiRangeEnd,
    kpiRangeStart,
  ]);

  const departmentWorkloadMetric = useMemo(() => {
    const totalsByDepartment = new Map<
      string,
      {
        id: string;
        label: string;
        color: string;
        value: number;
        rows: KpiDrilldownRow[];
      }
    >();

    for (const { event, timestamp } of kpiEventsInRange) {
      const existing = totalsByDepartment.get(event.workItem.department_id) ?? {
        id: event.workItem.department_id,
        label: event.workItem.department_name,
        color: normalizeDepartmentColor(event.workItem.department_color),
        value: 0,
        rows: [],
      };
      existing.value += 1;
      existing.rows.push({
        id: event.id,
        label: getLabelWithDepartment(event.workItem),
        detail: `${event.action_label} by ${event.actor_name} on ${new Date(
          timestamp,
        ).toLocaleDateString()}`,
        value: 1,
        href: `/instructions/${event.instruction_id}`,
      });
      totalsByDepartment.set(event.workItem.department_id, existing);
    }

    const ranked = [...totalsByDepartment.values()]
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    const bars: KpiBarPoint[] = ranked.map((entry) => ({
      id: entry.id,
      label:
        entry.label.length > 12
          ? `${entry.label.slice(0, 11).trimEnd()}…`
          : entry.label,
      value: entry.value,
      color: entry.color,
    }));
    const rowsByBarId = new Map(ranked.map((entry) => [entry.id, entry.rows]));

    return { bars, rowsByBarId };
  }, [kpiEventsInRange]);

  const reviewHealthMetric = useMemo(() => {
    const points = kpiDateBuckets.map((bucket) => ({
      id: `${bucket.id}-review-health`,
      shortLabel: bucket.shortLabel,
      fullLabel: bucket.fullLabel,
      healthy: 0,
      attention: 0,
    }));
    const rowsByPointId = new Map<string, KpiDrilldownRow[]>();

    for (const entry of kpiInstructionEntriesScoped) {
      const timestamp = toSortableTimestamp(entry.instruction.updated_at);
      if (timestamp < kpiRangeStart || timestamp >= kpiRangeEnd || timestamp <= 0) {
        continue;
      }

      const dayStart = toDayStartTimestamp(entry.instruction.updated_at);
      if (dayStart === null) {
        continue;
      }
      const bucketIndex = kpiBucketIndexByStart.get(dayStart);
      if (bucketIndex === undefined) {
        continue;
      }
      const point = points[bucketIndex];
      if (!point) {
        continue;
      }

      const reviewStatus = instructionReviewStatusByInstructionId[entry.instruction.id] ?? null;
      const daysSinceCalibration = toElapsedCalendarDays(
        reviewStatus?.last_calibrated_at ?? entry.instruction.updated_at,
      );
      const needsAttention =
        reviewStatus?.status === "needs_review" ||
        (daysSinceCalibration !== null &&
          daysSinceCalibration >= normalizedReviewWindowDays);

      if (needsAttention) {
        point.attention += 1;
      } else {
        point.healthy += 1;
      }

      const existing = rowsByPointId.get(point.id) ?? [];
      existing.push({
        id: entry.instruction.id,
        label: getLabelWithDepartment(entry.workItem),
        detail: needsAttention
          ? `Needs attention | Revision ${entry.instruction.revision}`
          : `Healthy | Revision ${entry.instruction.revision}`,
        value: 1,
        href: `/instructions/${entry.instruction.id}`,
      });
      rowsByPointId.set(point.id, existing);
    }

    return { points, rowsByPointId };
  }, [
    kpiInstructionEntriesScoped,
    instructionReviewStatusByInstructionId,
    kpiBucketIndexByStart,
    kpiDateBuckets,
    kpiRangeEnd,
    kpiRangeStart,
    normalizedReviewWindowDays,
  ]);

  const revisionCycleMetric = useMemo(() => {
    const points: KpiScatterPoint[] = [];
    const rowsByPointId = new Map<string, KpiDrilldownRow[]>();

    const sortedEntries = [...kpiInstructionEntriesScoped].sort(
      (left, right) =>
        toSortableTimestamp(right.instruction.updated_at) -
        toSortableTimestamp(left.instruction.updated_at),
    );

    for (const entry of sortedEntries) {
      const updatedTimestamp = toSortableTimestamp(entry.instruction.updated_at);
      if (
        updatedTimestamp < kpiRangeStart ||
        updatedTimestamp >= kpiRangeEnd ||
        updatedTimestamp <= 0
      ) {
        continue;
      }

      const daysSinceUpdate = toElapsedCalendarDays(entry.instruction.updated_at);
      const xValue = Math.max(0, daysSinceUpdate ?? 0);
      const yValue = Math.max(1, entry.instruction.revision);
      const pointId = `${entry.instruction.id}-${entry.instruction.revision}`;
      points.push({
        id: pointId,
        label: getLabelWithDepartment(entry.workItem),
        xValue,
        yValue,
        color: normalizeDepartmentColor(entry.workItem.department_color),
      });
      rowsByPointId.set(pointId, [
        {
          id: entry.instruction.id,
          label: getLabelWithDepartment(entry.workItem),
          detail: `Revision ${entry.instruction.revision} updated by ${entry.instruction.updater_name}`,
          value: yValue,
          href: `/instructions/${entry.instruction.id}`,
        },
      ]);

      if (points.length >= 80) {
        break;
      }
    }

    return { points, rowsByPointId };
  }, [kpiInstructionEntriesScoped, kpiRangeEnd, kpiRangeStart]);

  const eventMixMetric = useMemo(() => {
    const segmentsById: Record<
      "created" | "updated" | "needs_review" | "up_to_date",
      KpiDonutSegment
    > = {
      created: {
        id: "created",
        label: "Created",
        value: 0,
        color: "#0EA5E9",
      },
      updated: {
        id: "updated",
        label: "Updated",
        value: 0,
        color: "#2563EB",
      },
      needs_review: {
        id: "needs_review",
        label: "Needs Review",
        value: 0,
        color: "#F59E0B",
      },
      up_to_date: {
        id: "up_to_date",
        label: "Marked Up To Date",
        value: 0,
        color: "#22C55E",
      },
    };
    const rowsBySegmentId = new Map<string, KpiDrilldownRow[]>();

    for (const { event, timestamp } of kpiEventsInRange) {
      const segmentId = classifyKpiEventType(event);
      const segment = segmentsById[segmentId];
      if (!segment) {
        continue;
      }
      segment.value += 1;
      const existingRows = rowsBySegmentId.get(segment.id) ?? [];
      existingRows.push({
        id: event.id,
        label: getLabelWithDepartment(event.workItem),
        detail: `${event.action_label} by ${event.actor_name} on ${new Date(
          timestamp,
        ).toLocaleDateString()}`,
        value: 1,
        href: `/instructions/${event.instruction_id}`,
      });
      rowsBySegmentId.set(segment.id, existingRows);
    }

    return {
      segments: Object.values(segmentsById).filter((segment) => segment.value > 0),
      rowsBySegmentId,
    };
  }, [kpiEventsInRange]);

  const kpiDateRangeLabel = useMemo(() => {
    const first = kpiDateBuckets[0];
    const last = kpiDateBuckets[kpiDateBuckets.length - 1];
    if (!first || !last) {
      return "";
    }
    return `${first.fullLabel} - ${last.fullLabel}`;
  }, [kpiDateBuckets]);

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

  async function persistDashboardLayout(params: {
    layout: DashboardWidgetLayoutItem[];
    saveAsDefault: boolean;
    successNotice?: string | null;
  }) {
    setLayoutSaving(true);
    setLayoutError(null);

    try {
      const layoutToPersist = params.layout.map((entry) => ({ ...entry }));
      const headers = await getAuthHeaders();
      const response = await fetch("/api/dashboard/layout", {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          dashboardLayout: layoutToPersist,
          saveAsDefault: params.saveAsDefault,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        dashboardLayout?: unknown;
        dashboardDefaultLayout?: unknown;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save dashboard layout.");
      }

      const persistedLayout = normalizeDashboardLayout(
        payload.dashboardLayout ?? layoutToPersist,
      );
      setSavedWidgetLayout(cloneWidgetLayout(persistedLayout));
      setWidgetLayout(cloneWidgetLayout(persistedLayout));
      if (params.saveAsDefault) {
        const persistedDefaultLayout = normalizeDashboardLayout(
          payload.dashboardDefaultLayout ?? persistedLayout,
        );
        setDefaultWidgetLayout(cloneWidgetLayout(persistedDefaultLayout));
      }
      setLayoutDirty(false);
      if (params.successNotice) {
        setLayoutNotice(params.successNotice);
      }
      persistSavedLayoutSnapshot(currentUserId, persistedLayout);
      router.refresh();
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

  async function saveDashboardLayout() {
    await persistDashboardLayout({
      layout: widgetLayout,
      saveAsDefault: false,
    });
  }

  async function saveDashboardLayoutAsDefault() {
    await persistDashboardLayout({
      layout: widgetLayout,
      saveAsDefault: true,
      successNotice: "Default dashboard layout saved.",
    });
  }

  async function loadDefaultDashboardLayout() {
    const nextLayout = cloneWidgetLayout(defaultWidgetLayout);
    if (areWidgetLayoutsEqual(widgetLayout, nextLayout)) {
      setLayoutError(null);
      setLayoutNotice("Loaded your saved default dashboard layout.");
      return;
    }

    await persistDashboardLayout({
      layout: nextLayout,
      saveAsDefault: false,
      successNotice: "Loaded your saved default dashboard layout.",
    });
  }

  async function resetDashboardLayout() {
    const resetLayout = getResetDefaultDashboardLayout();
    if (areWidgetLayoutsEqual(widgetLayout, resetLayout)) {
      setLayoutError(null);
      setLayoutNotice("Dashboard reset. All widgets are visible. Saved default unchanged.");
      return;
    }

    await persistDashboardLayout({
      layout: resetLayout,
      saveAsDefault: false,
      successNotice: "Dashboard reset. All widgets are visible. Saved default unchanged.",
    });
  }

  function updateWidgetLayout(
    updater: (current: DashboardWidgetLayoutItem[]) => DashboardWidgetLayoutItem[],
  ) {
    setWidgetLayout((current) => {
      const next = updater(current);
      if (next === current || areWidgetLayoutsEqual(next, current)) {
        return current;
      }

      setLayoutDirty(!areWidgetLayoutsEqual(next, savedWidgetLayout));
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

  function setWidgetVisibility(widgetId: DashboardWidgetId, visible: boolean) {
    updateWidgetLayout((current) =>
      current.map((widget) =>
        widget.id === widgetId ? { ...widget, visible } : widget,
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

      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
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

  function getWidgetIdAtPointerPosition(clientX: number, clientY: number) {
    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const widgetContainer = element?.closest<HTMLElement>("[data-dashboard-widget-id]");
    const candidateId = widgetContainer?.dataset.dashboardWidgetId;
    if (!candidateId || !isDashboardWidgetId(candidateId)) {
      return null;
    }

    return candidateId;
  }

  function clearWidgetPointerDragState() {
    pointerDragStateRef.current = null;
    setDraggedWidgetId(null);
    setDragOverWidgetId(null);
  }

  function handleWidgetGripPointerDown(
    widgetId: DashboardWidgetId,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (!customizeOpenRef.current || event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    pointerDragStateRef.current = {
      pointerId: event.pointerId,
      sourceWidgetId: widgetId,
    };
    setDraggedWidgetId(widgetId);
    setDragOverWidgetId(widgetId);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleWidgetGripPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const pointerDragState = pointerDragStateRef.current;
    if (!pointerDragState || pointerDragState.pointerId !== event.pointerId) {
      return;
    }

    const targetWidgetId = getWidgetIdAtPointerPosition(event.clientX, event.clientY);
    if (!targetWidgetId || targetWidgetId === dragOverWidgetId) {
      return;
    }

    setDragOverWidgetId(targetWidgetId);
  }

  function completeWidgetPointerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const pointerDragState = pointerDragStateRef.current;
    if (!pointerDragState || pointerDragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const sourceWidgetId = pointerDragState.sourceWidgetId;
    const pointerTargetWidgetId =
      getWidgetIdAtPointerPosition(event.clientX, event.clientY) ?? dragOverWidgetId;

    if (pointerTargetWidgetId && pointerTargetWidgetId !== sourceWidgetId) {
      reorderWidgets(sourceWidgetId, pointerTargetWidgetId);
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    clearWidgetPointerDragState();
  }

  function handleWidgetGripPointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    const pointerDragState = pointerDragStateRef.current;
    if (!pointerDragState || pointerDragState.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    clearWidgetPointerDragState();
  }

  function applyLayoutPreset(presetId: string) {
    const preset = DASHBOARD_LAYOUT_PRESETS.find((entry) => entry.id === presetId);
    if (!preset) {
      return;
    }

    setWidgetLayout((current) => {
      const nextLayout = preset.layout.map((entry) => ({ ...entry }));
      if (areWidgetLayoutsEqual(current, nextLayout)) {
        return current;
      }

      setLayoutDirty(!areWidgetLayoutsEqual(nextLayout, savedWidgetLayout));
      setLayoutError(null);
      return nextLayout;
    });
  }

  function discardDashboardLayoutChanges() {
    setWidgetLayout(cloneWidgetLayout(savedWidgetLayout));
    setLayoutDirty(false);
    setLayoutError(null);
  }

  saveLayoutActionRef.current = saveDashboardLayout;
  saveLayoutAsDefaultActionRef.current = saveDashboardLayoutAsDefault;
  loadDefaultLayoutActionRef.current = loadDefaultDashboardLayout;
  resetDefaultsActionRef.current = resetDashboardLayout;
  discardLayoutActionRef.current = discardDashboardLayoutChanges;
  applyLayoutPresetActionRef.current = applyLayoutPreset;
  toggleWidgetActionRef.current = toggleWidget;
  setWidgetVisibilityActionRef.current = setWidgetVisibility;
  updateWidgetSizeActionRef.current = updateWidgetSize;

  useEffect(() => {
    const handleLayoutCommand = (event: Event) => {
      const detail = (event as CustomEvent<DashboardLayoutCommandEventDetail>).detail;
      if (!detail?.command) {
        return;
      }

      if (detail.command === "apply-layout-preset") {
        if (typeof detail.presetId === "string") {
          applyLayoutPresetActionRef.current?.(detail.presetId);
        }
        return;
      }

      if (detail.command === "set-widget-visibility") {
        const widgetId = detail.widgetId;
        if (!widgetId) {
          return;
        }

        if (typeof detail.visible === "boolean") {
          setWidgetVisibilityActionRef.current?.(widgetId, detail.visible);
          return;
        }

        toggleWidgetActionRef.current?.(widgetId);
        return;
      }

      if (detail.command === "set-widget-size") {
        const widgetId = detail.widgetId;
        const size = detail.size;
        const isSizeValid =
          size === "compact" ||
          size === "standard" ||
          size === "wide" ||
          size === "full";

        if (!widgetId || !isSizeValid) {
          return;
        }

        updateWidgetSizeActionRef.current?.(widgetId, size);
        return;
      }

      if (detail.command === "toggle-customize") {
        setCustomizeOpen((current) => !current);
        return;
      }

      if (detail.command === "save-layout") {
        if (!layoutDirtyRef.current || layoutSavingRef.current) {
          return;
        }
        void saveLayoutActionRef.current?.();
        return;
      }

      if (detail.command === "save-layout-default") {
        if (layoutSavingRef.current) {
          return;
        }
        void saveLayoutAsDefaultActionRef.current?.();
        return;
      }

      if (detail.command === "discard-changes") {
        if (!layoutDirtyRef.current || layoutSavingRef.current) {
          return;
        }
        discardLayoutActionRef.current?.();
        return;
      }

      if (detail.command === "load-default") {
        if (layoutSavingRef.current) {
          return;
        }
        void loadDefaultLayoutActionRef.current?.();
        return;
      }

      if (detail.command === "reset-defaults") {
        if (layoutSavingRef.current) {
          return;
        }
        setResetDefaultsModalOpen(true);
      }
    };

    window.addEventListener(DASHBOARD_LAYOUT_COMMAND_EVENT, handleLayoutCommand as EventListener);
    return () => {
      window.removeEventListener(
        DASHBOARD_LAYOUT_COMMAND_EVENT,
        handleLayoutCommand as EventListener,
      );
    };
  }, []);

  function closeResetDefaultsModal() {
    setResetDefaultsModalOpen(false);
  }

  function handleConfirmResetDefaults() {
    setResetDefaultsModalOpen(false);
    void resetDefaultsActionRef.current?.();
  }

  useEffect(() => {
    if (!resetDefaultsModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setResetDefaultsModalOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [resetDefaultsModalOpen]);

  function closeNavigationModal() {
    pendingNavigationRef.current = null;
    setNavigationModalOpen(false);
  }

  function openNavigationModal(nextNavigation: DashboardPendingNavigation) {
    setImpactDrilldownKey(null);
    setDepartmentDrilldownDepartmentId(null);
    setActiveKpiDrilldown(null);
    pendingNavigationRef.current = nextNavigation;
    setNavigationModalOpen(true);
  }

  function handleCancelNavigationAway() {
    if (
      pendingNavigationRef.current?.kind === "history-back" &&
      layoutDirtyRef.current &&
      !historyGuardActiveRef.current
    ) {
      window.history.pushState(
        { [DASHBOARD_HISTORY_GUARD_STATE_KEY]: true },
        "",
        window.location.href,
      );
      historyGuardActiveRef.current = true;
    }

    navigationBypassRef.current = false;
    closeNavigationModal();
  }

  function handleConfirmNavigationAway() {
    const navigation = pendingNavigationRef.current;
    if (!navigation) {
      closeNavigationModal();
      return;
    }

    navigationBypassRef.current = true;
    closeNavigationModal();

    if (navigation.kind === "history-back") {
      navigateWithGuardReleased(() => {
        if (window.history.length <= 2) {
          router.push("/dashboard");
          return;
        }

        router.back();
      });
      return;
    }

    if (navigation.kind === "internal-link") {
      try {
        const destination = new URL(navigation.href, window.location.href);
        if (shouldCaptureInstructionReturnState(destination.pathname)) {
          persistInstructionReturnState();
        }
      } catch {
        // If URL parsing fails, continue with navigation without return-state capture.
      }
    }

    window.location.assign(navigation.href);
  }

  useEffect(() => {
    if (
      !navigationModalOpen &&
      !impactDrilldownKey &&
      !departmentDrilldownDepartmentId &&
      !activeKpiDrilldown
    ) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (activeKpiDrilldown) {
        setActiveKpiDrilldown(null);
        return;
      }

      if (impactDrilldownKey) {
        setImpactDrilldownKey(null);
        return;
      }

      if (departmentDrilldownDepartmentId) {
        setDepartmentDrilldownDepartmentId(null);
        return;
      }

      if (navigationModalOpen) {
        if (
          pendingNavigationRef.current?.kind === "history-back" &&
          layoutDirtyRef.current &&
          !historyGuardActiveRef.current
        ) {
          window.history.pushState(
            { [DASHBOARD_HISTORY_GUARD_STATE_KEY]: true },
            "",
            window.location.href,
          );
          historyGuardActiveRef.current = true;
        }

        navigationBypassRef.current = false;
        pendingNavigationRef.current = null;
        setNavigationModalOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [
    activeKpiDrilldown,
    departmentDrilldownDepartmentId,
    impactDrilldownKey,
    navigationModalOpen,
  ]);

  function renderWidgetHeaderControls(
    widgetId: DashboardWidgetId,
    widgetSize: DashboardWidgetSize,
  ) {
    if (widgetId === "finder") {
      const departmentToggleLabel = departmentInsightExpanded
        ? "Hide Departments"
        : "Show Departments";

      return (
        <div
          className={cn(
            "items-center",
            widgetSize === "compact" ? "flex w-full justify-end" : "flex justify-end",
          )}
        >
          <button
            type="button"
            onClick={() => setDepartmentInsightExpanded((current) => !current)}
            aria-label={departmentToggleLabel}
            title={departmentToggleLabel}
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-full border border-slate-400/35 bg-slate-900/10 text-slate-700 transition hover:bg-slate-900/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:bg-white/10 dark:text-slate-100 dark:hover:bg-white/15",
              widgetSize === "compact" ? "h-8 w-8" : "h-9 w-9",
            )}
          >
            {departmentInsightExpanded ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
        </div>
      );
    }

    if (widgetId === "system_history") {
      return (
        <label className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
          <span>Display</span>
          <select
            value={systemHistoryRowLimit}
            onChange={(event) => {
              const nextLimit = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(nextLimit) && nextLimit > 0) {
                setSystemHistoryRowLimit(nextLimit);
              }
            }}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
          >
            {SYSTEM_HISTORY_ROW_LIMIT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option} rows
              </option>
            ))}
          </select>
        </label>
      );
    }

    return null;
  }

  function renderWidgetContent(widgetId: DashboardWidgetId) {
    if (widgetId === "finder") {
      return (
        <div className={cn("grid", departmentInsightExpanded ? "gap-4" : "gap-2")}>
          <div className="grid gap-2">
            <label className="grid gap-1 text-sm">
              <span className="sr-only">Search for anything</span>
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
                  aria-label="Search for anything"
                  placeholder="Start typing"
                  onChange={(event) => setQuery(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-10 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                />
                {query.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      searchInputRef.current?.focus();
                    }}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200"
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
            </label>
          </div>

          <div
            id="finder-department-insight-slider"
            className={cn(
              "min-w-0 overflow-hidden transition-[max-height,opacity] duration-300 ease-out",
              departmentInsightExpanded ? "max-h-[40rem] opacity-100" : "max-h-0 opacity-0",
            )}
          >
            <div
              className={cn(
                shouldScrollDepartmentInsight ? "overflow-x-auto pb-1" : "overflow-visible",
              )}
            >
              <div
                className={cn(
                  "items-center gap-2 pr-1",
                  shouldScrollDepartmentInsight
                    ? "flex min-w-max whitespace-nowrap"
                    : "flex flex-wrap whitespace-normal",
                )}
              >
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
                    onClick={() =>
                      setSelectedDepartmentId((current) =>
                        current === department.id ? "all" : department.id,
                      )
                    }
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
                        <h3 className="leading-tight">
                          <PartDepartmentHeading workItem={item} />
                        </h3>
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
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
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="font-semibold">Revision {instruction.revision}</p>
                            {getForkLabel(
                              instruction.fork_number,
                              instruction.fork_root_instruction_id,
                            ) ? (
                              <span className="inline-flex items-center rounded-full border border-cyan-500/45 bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-200">
                                {getForkLabel(
                                  instruction.fork_number,
                                  instruction.fork_root_instruction_id,
                                )}
                              </span>
                            ) : null}
                          </div>
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
              Searching in {selectedDepartmentName}. Start typing above to search instructions
              instantly.
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
              <div className="flex flex-wrap items-center gap-1.5">
                <PartDepartmentHeading workItem={instruction.workItem} />
                {getForkLabel(
                  instruction.fork_number,
                  instruction.fork_root_instruction_id,
                ) ? (
                  <span className="inline-flex items-center rounded-full border border-cyan-500/45 bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-200">
                    {getForkLabel(
                      instruction.fork_number,
                      instruction.fork_root_instruction_id,
                    )}
                  </span>
                ) : null}
                {instructionReviewStatusByInstructionId[instruction.id]?.status ===
                  "needs_review" && (
                  <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/45 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                    <TriangleAlert size={10} />
                    Needs Review
                  </span>
                )}
              </div>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
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
              <div className="flex flex-wrap items-center gap-1.5">
                <PartDepartmentHeading workItem={instruction.workItem} />
                {getForkLabel(
                  instruction.fork_number,
                  instruction.fork_root_instruction_id,
                ) ? (
                  <span className="inline-flex items-center rounded-full border border-cyan-500/45 bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-200">
                    {getForkLabel(
                      instruction.fork_number,
                      instruction.fork_root_instruction_id,
                    )}
                  </span>
                ) : null}
                {instructionReviewStatusByInstructionId[instruction.id]?.status ===
                  "needs_review" && (
                  <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/45 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                    <TriangleAlert size={10} />
                    Needs Review
                  </span>
                )}
              </div>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
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
              <button
                type="button"
                key={entry.id}
                onClick={() => {
                  setImpactDrilldownKey(null);
                  setDepartmentDrilldownDepartmentId(entry.id);
                }}
                className="group rounded-xl border border-slate-300/70 bg-white/70 p-3 text-left transition hover:border-cyan-400/60 hover:bg-cyan-500/10 dark:border-slate-700 dark:bg-slate-900/50 dark:hover:border-cyan-500/50 dark:hover:bg-cyan-500/10"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {entry.name}
                  </p>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {entry.instructionCount}
                    </p>
                    <p className="text-[11px] font-semibold text-cyan-700 dark:text-cyan-300">
                      Drill down
                    </p>
                  </div>
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
              </button>
            );
          })}
        </div>
      );
    }

    if (widgetId === "review_queue") {
      return reviewQueueEntries.length === 0 ? (
        <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          No instructions are out of the review range or flagged for review in{" "}
          {selectedDepartmentName}.
        </p>
      ) : (
        <div className="grid gap-2">
          {reviewQueueEntries.map((entry) => {
            const overdueDays =
              entry.daysSinceCalibration === null
                ? null
                : Math.max(0, entry.daysSinceCalibration - normalizedReviewWindowDays);

            return (
              <Link
                key={entry.instruction.id}
                href={`/instructions/${entry.instruction.id}`}
                style={{
                  borderColor: colorWithAlpha(entry.workItem.department_color, 0.45),
                  backgroundColor: colorWithAlpha(entry.workItem.department_color, 0.14),
                  boxShadow: `inset 4px 0 0 ${colorWithAlpha(
                    entry.workItem.department_color,
                    0.85,
                  )}`,
                }}
                className="grid gap-1.5 rounded-xl border p-3 transition hover:brightness-105"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="inline-flex flex-wrap items-center gap-1.5">
                    <PartDepartmentHeading workItem={entry.workItem} />
                    {getForkLabel(
                      entry.instruction.fork_number,
                      entry.instruction.fork_root_instruction_id,
                    ) ? (
                      <span className="inline-flex items-center rounded-full border border-cyan-500/45 bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-200">
                        {getForkLabel(
                          entry.instruction.fork_number,
                          entry.instruction.fork_root_instruction_id,
                        )}
                      </span>
                    ) : null}
                  </p>
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                      entry.isFlagged
                        ? "border-rose-500/45 bg-rose-500/15 text-rose-700 dark:text-rose-200"
                        : "border-amber-500/45 bg-amber-500/15 text-amber-700 dark:text-amber-200",
                    )}
                  >
                    {entry.isFlagged ? "Needs review" : "Out of range"}
                  </span>
                </div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  {entry.workItem.item_title}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Revision {entry.instruction.revision} | Updated{" "}
                  <LocalDateTime value={entry.instruction.updated_at} mode="date" /> by{" "}
                  {entry.instruction.updater_name}
                </p>
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {formatElapsedDaysLabel(entry.daysSinceUpdate)}
                </p>
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {entry.isFlagged
                    ? "Marked as needs review by a user."
                    : overdueDays === null
                      ? "Review window status unavailable."
                      : overdueDays === 0
                        ? `Due for re-check now (${normalizedReviewWindowDays}-day window).`
                        : `Out of range by ${overdueDays} day${overdueDays === 1 ? "" : "s"} (${normalizedReviewWindowDays}-day window).`}
                </p>
              </Link>
            );
          })}
        </div>
      );
    }

    if (widgetId === "recent_updates") {
      return recentUpdateEvents.length === 0 ? (
        <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          No recent instruction updates for {selectedDepartmentName}.
        </p>
      ) : (
        <div className="grid gap-2">
          {recentUpdateEvents.map((event) => (
            <article
              key={event.id}
              style={{
                borderColor: colorWithAlpha(event.workItem.department_color, 0.45),
                backgroundColor: colorWithAlpha(event.workItem.department_color, 0.12),
                boxShadow: `inset 4px 0 0 ${colorWithAlpha(
                  event.workItem.department_color,
                  0.9,
                )}`,
              }}
              className="grid gap-2 rounded-xl border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <LocalDateTime value={event.occurred_at} mode="dateTime" />
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    By {event.actor_name}
                  </span>
                </p>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-200">
                  {event.action_label}
                </p>
              </div>

              <p>
                <PartDepartmentHeading workItem={event.workItem} />
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                <span className="font-semibold">Instruction:</span>{" "}
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {event.workItem.item_title}
                </span>
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300">{event.detail}</p>

              <div className="flex flex-wrap justify-end gap-2">
                <Link
                  href={`/instructions/${event.instruction_id}`}
                  className="inline-flex items-center rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/20 dark:text-cyan-200"
                >
                  Open instruction
                </Link>
              </div>
            </article>
          ))}
        </div>
      );
    }

    if (widgetId === "system_history") {
      return (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Showing {visibleSystemHistoryEvents.length} of {filteredSystemHistoryEvents.length}{" "}
              events
            </p>
            <button
              type="button"
              onClick={() => setSelectedSystemHistoryEventId(null)}
              disabled={!selectedSystemHistoryEventId}
              className="inline-flex items-center rounded-lg border border-slate-400/40 bg-slate-900/8 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-900/12 disabled:cursor-not-allowed disabled:opacity-45 dark:text-slate-200 dark:hover:bg-white/10"
            >
              Collapse all
            </button>
          </div>

          {visibleSystemHistoryEvents.length === 0 ? (
            <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              No recent system activity for {selectedDepartmentName}.
            </p>
          ) : (
            <div className="grid w-full gap-2">
              {visibleSystemHistoryEvents.map((event) => {
                const isSelected = selectedSystemHistoryEventId === event.id;
                const openInstructionHref = `/instructions/${event.instruction_id}`;
                const versionDetails =
                  isSelected &&
                  selectedSystemHistoryVersionDetails?.selectedEvent.id === event.id
                    ? selectedSystemHistoryVersionDetails
                    : null;

                return (
                  <article
                    key={event.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() =>
                      setSelectedSystemHistoryEventId((currentSelection) =>
                        currentSelection === event.id ? null : event.id,
                      )
                    }
                    onKeyDown={(eventKeyDown) => {
                      if (eventKeyDown.key === "Enter" || eventKeyDown.key === " ") {
                        eventKeyDown.preventDefault();
                        setSelectedSystemHistoryEventId((currentSelection) =>
                          currentSelection === event.id ? null : event.id,
                        );
                      }
                    }}
                    style={{
                      borderColor: colorWithAlpha(event.workItem.department_color, 0.5),
                      backgroundColor: colorWithAlpha(event.workItem.department_color, 0.12),
                      boxShadow: `inset 4px 0 0 ${colorWithAlpha(
                        event.workItem.department_color,
                        isSelected ? 1 : 0.85,
                      )}`,
                    }}
                    className={cn(
                      "grid gap-2 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/55",
                      isSelected ? "ring-2 ring-cyan-500/45" : "hover:brightness-105",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                        <LocalDateTime value={event.occurred_at} mode="dateTime" />
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          By {event.actor_name}
                        </span>
                      </p>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-200">
                        {event.action_label}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p>
                        <PartDepartmentHeading workItem={event.workItem} />
                      </p>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      <span className="font-semibold">Instruction:</span>{" "}
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        {event.workItem.item_title}
                      </span>
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <p
                        className={cn(
                          "font-semibold",
                          isSelected
                            ? "text-cyan-800 dark:text-cyan-200"
                            : "text-slate-600 dark:text-slate-300",
                        )}
                      >
                        {isSelected ? "Version check active" : "Click card for version check"}
                      </p>
                      <Link
                        href={openInstructionHref}
                        onClick={(clickEvent) => clickEvent.stopPropagation()}
                        className="inline-flex items-center rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 font-semibold text-cyan-800 transition hover:bg-cyan-500/20 dark:text-cyan-200"
                      >
                        Open instruction
                      </Link>
                    </div>

                    {isSelected && versionDetails ? (
                      <div className="grid gap-2 rounded-lg border border-cyan-500/35 bg-cyan-500/10 p-2.5 dark:border-slate-600 dark:bg-slate-950/70">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-800 dark:text-cyan-200">
                          Version Check
                        </p>
                        <p className="text-xs text-slate-700 dark:text-slate-300">
                          Original file: {versionDetails.baselineEvent?.actor_name ?? "Unknown"} on{" "}
                          <LocalDateTime
                            value={versionDetails.baselineEvent?.occurred_at ?? event.occurred_at}
                            mode="dateTime"
                          />
                        </p>
                        <p className="text-xs text-slate-700 dark:text-slate-300">
                          Selected update: {event.actor_name} on{" "}
                          <LocalDateTime value={event.occurred_at} mode="dateTime" />
                          {versionDetails.previousEvent ? (
                            <>
                              {" "}
                              (previous update by {versionDetails.previousEvent.actor_name} on{" "}
                              <LocalDateTime
                                value={versionDetails.previousEvent.occurred_at}
                                mode="dateTime"
                              />
                              )
                            </>
                          ) : null}
                        </p>
                        <p className="text-xs text-slate-700 dark:text-slate-300">
                          <span className="font-semibold">Update summary:</span> {event.detail}
                        </p>

                        <div className="grid gap-1">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                            Changes In This Event
                          </p>
                          {versionDetails.changesInEvent.length === 0 ? (
                            <p className="text-xs text-slate-600 dark:text-slate-300">
                              No explicit change summary found for this update.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {versionDetails.changesInEvent.map((change) => (
                                <span
                                  key={change.id}
                                  title={formatSystemHistoryTooltip(
                                    change.actorName,
                                    change.occurredAt,
                                  )}
                                  className="rounded-full border border-cyan-500/45 bg-cyan-500/20 px-2 py-0.5 text-[11px] font-semibold text-cyan-900 dark:text-cyan-100"
                                >
                                  {change.label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="grid gap-1">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                            Highlights Since Original
                          </p>
                          {versionDetails.cumulativeChanges.length === 0 ? (
                            <p className="text-xs text-slate-600 dark:text-slate-300">
                              No additional updates were captured after creation.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {versionDetails.cumulativeChanges.map((change) => (
                                <span
                                  key={change.id}
                                  title={formatSystemHistoryTooltip(
                                    change.actorName,
                                    change.occurredAt,
                                  )}
                                  className="rounded-full border border-slate-400/60 bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-slate-800 dark:border-slate-600 dark:bg-slate-900/70 dark:text-slate-200"
                                >
                                  {change.label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    if (widgetId === "kpi_throughput") {
      const totalEvents = throughputMetric.points.reduce(
        (sum, point) => sum + point.value,
        0,
      );

      return (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Time Series Filter
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{kpiDateRangeLabel}</p>
            </div>
            <KpiTimeRangePicker
              value={kpiTimeRangeDays}
              onChange={setKpiTimeRangeDays}
            />
          </div>
          <div className="rounded-xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/60">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {totalEvents} event{totalEvents === 1 ? "" : "s"} captured in the selected range.
            </p>
          </div>
          <KpiLineChart
            points={throughputMetric.points}
            yAxisLabel="Events"
            lineColor="#06B6D4"
            onSelectPoint={(point) => {
              setActiveKpiDrilldown({
                title: "Throughput Trend Drill Down",
                subtitle: `${point.fullLabel} | ${selectedDepartmentName}`,
                yAxisLabel: "Events",
                rows: throughputMetric.rowsByPointId.get(point.id) ?? [],
              });
            }}
          />
        </div>
      );
    }

    if (widgetId === "kpi_creation_velocity") {
      const totalCreated = creationVelocityMetric.points.reduce(
        (sum, point) => sum + point.value,
        0,
      );

      return (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Time Series Filter
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{kpiDateRangeLabel}</p>
            </div>
            <KpiTimeRangePicker
              value={kpiTimeRangeDays}
              onChange={setKpiTimeRangeDays}
            />
          </div>
          <div className="rounded-xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/60">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {totalCreated} instruction{totalCreated === 1 ? "" : "s"} created in this window.
            </p>
          </div>
          <KpiLineChart
            points={creationVelocityMetric.points}
            yAxisLabel="Created"
            lineColor="#3B82F6"
            showArea
            onSelectPoint={(point) => {
              setActiveKpiDrilldown({
                title: "Creation Velocity Drill Down",
                subtitle: `${point.fullLabel} | ${selectedDepartmentName}`,
                yAxisLabel: "Created",
                rows: creationVelocityMetric.rowsByPointId.get(point.id) ?? [],
              });
            }}
          />
        </div>
      );
    }

    if (widgetId === "kpi_department_workload") {
      const totalEvents = departmentWorkloadMetric.bars.reduce(
        (sum, bar) => sum + bar.value,
        0,
      );

      return (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Time Series Filter
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{kpiDateRangeLabel}</p>
            </div>
            <KpiTimeRangePicker
              value={kpiTimeRangeDays}
              onChange={setKpiTimeRangeDays}
            />
          </div>
          <div className="rounded-xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/60">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Top department load across {totalEvents} event
              {totalEvents === 1 ? "" : "s"}.
            </p>
          </div>
          {departmentWorkloadMetric.bars.length === 0 ? (
            <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              No department event load data is available for this range.
            </p>
          ) : (
            <KpiBarChart
              bars={departmentWorkloadMetric.bars}
              yAxisLabel="Events"
              onSelectBar={(bar) => {
                setActiveKpiDrilldown({
                  title: "Department Workload Drill Down",
                  subtitle: `${bar.label} | ${kpiDateRangeLabel}`,
                  yAxisLabel: "Events",
                  rows: departmentWorkloadMetric.rowsByBarId.get(bar.id) ?? [],
                });
              }}
            />
          )}
        </div>
      );
    }

    if (widgetId === "kpi_review_health") {
      return (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Time Series Filter
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{kpiDateRangeLabel}</p>
            </div>
            <KpiTimeRangePicker
              value={kpiTimeRangeDays}
              onChange={setKpiTimeRangeDays}
            />
          </div>
          <KpiStackedBarChart
            points={reviewHealthMetric.points}
            yAxisLabel="Instruction Updates"
            onSelectPoint={(point) => {
              setActiveKpiDrilldown({
                title: "Review Health Drill Down",
                subtitle: `${point.fullLabel} | ${selectedDepartmentName}`,
                yAxisLabel: "Instructions",
                rows: reviewHealthMetric.rowsByPointId.get(point.id) ?? [],
              });
            }}
          />
        </div>
      );
    }

    if (widgetId === "kpi_revision_cycle_time") {
      return (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Time Series Filter
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{kpiDateRangeLabel}</p>
            </div>
            <KpiTimeRangePicker
              value={kpiTimeRangeDays}
              onChange={setKpiTimeRangeDays}
            />
          </div>
          {revisionCycleMetric.points.length === 0 ? (
            <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              No revision cycle points are available for this time window.
            </p>
          ) : (
            <KpiScatterChart
              points={revisionCycleMetric.points}
              xAxisLabel="days since update"
              yAxisLabel="Revision"
              onSelectPoint={(point) => {
                setActiveKpiDrilldown({
                  title: "Revision Cycle Time Drill Down",
                  subtitle: point.label,
                  yAxisLabel: "Revision",
                  rows: revisionCycleMetric.rowsByPointId.get(point.id) ?? [],
                });
              }}
            />
          )}
        </div>
      );
    }

    if (widgetId === "kpi_event_mix") {
      return (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Time Series Filter
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{kpiDateRangeLabel}</p>
            </div>
            <KpiTimeRangePicker
              value={kpiTimeRangeDays}
              onChange={setKpiTimeRangeDays}
            />
          </div>
          {eventMixMetric.segments.length === 0 ? (
            <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              No event mix data is available for this time range.
            </p>
          ) : (
            <KpiDonutChart
              segments={eventMixMetric.segments}
              onSelectSegment={(segment) => {
                setActiveKpiDrilldown({
                  title: "Event Mix Drill Down",
                  subtitle: `${segment.label} | ${kpiDateRangeLabel}`,
                  yAxisLabel: "Events",
                  rows: eventMixMetric.rowsBySegmentId.get(segment.id) ?? [],
                });
              }}
            />
          )}
        </div>
      );
    }

    const isMyImpactCompact = (widgetLayoutById.get("my_impact")?.size ?? "standard") === "compact";

    return (
      <div className="grid gap-3">
        <div className={cn("grid gap-2", isMyImpactCompact ? "grid-cols-1" : "md:grid-cols-2")}>
          <ImpactKpiCard
            label="Authored Instructions"
            value={myInstructionEntries.length}
            onOpen={() => setImpactDrilldownKey("authored")}
            compact={isMyImpactCompact}
          />
          <ImpactKpiCard
            label="Departments Touched"
            value={myDepartmentCount}
            onOpen={() => setImpactDrilldownKey("departments")}
            compact={isMyImpactCompact}
          />
          <ImpactKpiCard
            label="Total Likes"
            value={totalAuthoredLikes}
            onOpen={() => setImpactDrilldownKey("likes")}
            compact={isMyImpactCompact}
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
            onOpen={() => setImpactDrilldownKey("recent")}
            compact={isMyImpactCompact}
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
                <div className="flex flex-wrap items-center gap-1.5">
                  <PartDepartmentHeading workItem={entry.workItem} />
                  {getForkLabel(
                    entry.instruction.fork_number,
                    entry.instruction.fork_root_instruction_id,
                  ) ? (
                    <span className="inline-flex items-center rounded-full border border-cyan-500/45 bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-200">
                      {getForkLabel(
                        entry.instruction.fork_number,
                        entry.instruction.fork_root_instruction_id,
                      )}
                    </span>
                  ) : null}
                  {instructionReviewStatusByInstructionId[entry.instruction.id]?.status ===
                    "needs_review" && (
                    <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/45 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                      <TriangleAlert size={10} />
                      Needs Review
                    </span>
                  )}
                </div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  {entry.workItem.item_title}
                </p>
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

  return (
    <>
      <div className="grid gap-5">
        {layoutNotice ? (
          <section className="rounded-2xl border border-emerald-500/45 bg-emerald-500/10 p-3 backdrop-blur-sm">
            <p className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
              <CheckCircle2 size={14} />
              {layoutNotice}
            </p>
          </section>
        ) : null}

        {layoutDirty || layoutError ? (
          <section className="rounded-2xl border border-white/20 bg-white/60 p-3 backdrop-blur-sm dark:border-white/10 dark:bg-slate-900/50">
            {layoutDirty ? (
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-200">
                Unsaved layout changes. Use the Dashboard Studio menu in the header
                to save or discard.
              </p>
            ) : null}
            {layoutError ? (
              <p
                className={cn(
                  "rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-200",
                  layoutDirty ? "mt-2" : "",
                )}
              >
                {layoutError}
              </p>
            ) : null}
          </section>
        ) : null}

        <div className="grid grid-cols-12 gap-4">
          {visibleWidgets.map((widget) => {
            const definition = widgetDefinitionsById.get(widget.id);
            if (!definition) {
              return null;
            }
            const isDragging = draggedWidgetId === widget.id;
            const isDragOverTarget =
              dragOverWidgetId === widget.id && draggedWidgetId !== widget.id;
            const widgetHeaderControls = renderWidgetHeaderControls(widget.id, widget.size);
            const sizeControl = customizeOpen ? (
              <label
                className={cn(
                  "inline-flex items-center text-xs text-slate-600 dark:text-slate-300",
                  widget.size === "compact" ? "gap-1.5" : "gap-1",
                )}
              >
                <span>Size</span>
                <select
                  value={widget.size}
                  onChange={(event) =>
                    updateWidgetSize(
                      widget.id,
                      event.target.value as DashboardWidgetSize,
                    )
                  }
                  className={cn(
                    "rounded-lg border border-slate-300 bg-white px-2 text-xs outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950",
                    widget.size === "compact" ? "py-1.5" : "py-1",
                  )}
                >
                  {WIDGET_SIZE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null;

            return (
              <section
                key={widget.id}
                data-dashboard-widget-id={widget.id}
                className={cn(
                  getWidgetSpanClass(widget.size),
                  "relative min-w-0 rounded-3xl border border-white/30 bg-white/80 shadow-xl backdrop-blur-xl transition dark:border-white/10 dark:bg-slate-900/70",
                  "overflow-hidden",
                  widget.size === "compact" ? "p-3" : "p-4 md:p-5",
                  isDragging ? "scale-[0.99] opacity-70" : "",
                  isDragOverTarget
                    ? "ring-2 ring-cyan-400/80 ring-offset-2 ring-offset-transparent"
                    : "",
                )}
              >
                {customizeOpen ? (
                  <button
                    type="button"
                    onClick={() => toggleWidget(widget.id)}
                    aria-label={`Remove ${definition.title} widget`}
                    className="absolute right-4 top-4 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-rose-500/40 bg-rose-500/10 text-rose-700 transition hover:bg-rose-500/20 dark:text-rose-200"
                  >
                    <X size={12} />
                  </button>
                ) : null}

                <div
                  className={cn(
                    widget.size === "compact" ? "mb-2 flex flex-col gap-2" : "mb-3 flex flex-col gap-2.5",
                    customizeOpen ? "pr-10" : "",
                    widget.size === "compact"
                      ? "items-start"
                      : "md:flex-row md:items-start md:justify-between",
                  )}
                >
                  <div className="flex min-w-0 items-start gap-2">
                    {customizeOpen ? (
                      <button
                        type="button"
                        aria-label={`Drag to reorder ${definition.title}`}
                        onDragStart={(event) => event.preventDefault()}
                        onPointerDown={(event) => handleWidgetGripPointerDown(widget.id, event)}
                        onPointerMove={handleWidgetGripPointerMove}
                        onPointerUp={completeWidgetPointerDrag}
                        onPointerCancel={handleWidgetGripPointerCancel}
                        className="mt-0.5 touch-none cursor-grab rounded-lg border border-slate-300/70 bg-white/60 p-2 text-slate-500 transition hover:bg-slate-100 active:cursor-grabbing dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-900"
                      >
                        <GripVertical size={14} />
                      </button>
                    ) : null}
                    <div className="min-w-0">
                      <h2 className={cn("break-words font-extrabold tracking-tight text-slate-900 dark:text-slate-100", widget.size === "compact" ? "text-base" : "text-xl")}>
                        {definition.title}
                      </h2>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "flex flex-wrap items-center",
                      widget.size === "compact" ? "w-full gap-2" : "gap-2",
                    )}
                  >
                    {widgetHeaderControls}
                    {sizeControl}
                  </div>
                </div>

                {renderWidgetContent(widget.id)}
              </section>
            );
          })}
        </div>
      </div>

      {portalReady &&
      likeCelebrationOpen &&
      activeLikeCelebration &&
      activeLikeCelebration.newLikesCount > 0
        ? createPortal(
            <div className="app-modal-shell fixed inset-0 z-[113] flex items-center justify-center overflow-hidden bg-slate-950/65 p-4 backdrop-blur-sm sm:p-6">
              <div className="pointer-events-none absolute inset-0">
                {celebrationConfettiPieces.map((piece) => (
                  <span
                    key={piece.id}
                    className="dashboard-like-celebration-piece"
                    style={{
                      left: `${piece.left}%`,
                      animationDelay: `${piece.delay}s`,
                      animationDuration: `${piece.duration}s`,
                      transform: `rotate(${piece.rotation}deg)`,
                      backgroundColor:
                        CELEBRATION_CONFETTI_COLORS[
                          piece.id % CELEBRATION_CONFETTI_COLORS.length
                        ],
                    }}
                  />
                ))}
              </div>

              <div className="relative z-[1] grid w-full max-w-lg gap-4 rounded-3xl border border-cyan-400/45 bg-white/95 p-6 text-center shadow-2xl dark:bg-slate-950/95">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-cyan-300/50 bg-cyan-500/20">
                  <ThumbsUp
                    size={40}
                    className="dashboard-like-celebration-thumb text-cyan-700 dark:text-cyan-200"
                  />
                </div>

                <div className="grid gap-1">
                  <h3 className="text-2xl font-extrabold text-slate-900 dark:text-slate-50">
                    You got {activeLikeCelebration.newLikesCount} new like
                    {activeLikeCelebration.newLikesCount === 1 ? "" : "s"}.
                  </h3>
                  <p className="text-sm text-cyan-700 dark:text-cyan-100">
                    Your teammates are appreciating your work instructions.
                  </p>
                </div>

                {activeLikeCelebration.highlights.length > 0 ? (
                  <div className="grid gap-2 rounded-2xl border border-cyan-300/70 bg-cyan-100/85 p-3 text-left dark:border-cyan-500/35 dark:bg-cyan-500/10">
                    {activeLikeCelebration.highlights.slice(0, 3).map((highlight) => (
                      <p
                        key={highlight.instructionId}
                        className="text-sm text-slate-800 dark:text-cyan-50"
                      >
                        <span className="font-semibold">{highlight.label}</span>
                        <span className="text-cyan-700/80 dark:text-cyan-300/80">
                          {" "}
                          Rev {highlight.revision}
                        </span>
                        <span className="text-cyan-800 dark:text-cyan-200">
                          {" "}
                          +{highlight.newLikesCount}
                        </span>
                      </p>
                    ))}
                  </div>
                ) : null}

                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => setLikeCelebrationOpen(false)}
                    className="rounded-xl border border-cyan-400/45 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-500/30 dark:text-cyan-100"
                  >
                    Nice
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {resetDefaultsModalOpen && portalReady
        ? createPortal(
            <div className="app-modal-shell fixed inset-0 z-[114] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm sm:p-6">
              <div className="grid w-full max-w-md gap-4 rounded-2xl border border-amber-500/45 bg-slate-950/95 p-5 shadow-2xl">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-200">
                    <TriangleAlert size={16} />
                  </span>
                  <div className="grid gap-1">
                    <h3 className="text-lg font-bold text-slate-100">
                      Reset dashboard layout?
                    </h3>
                    <p className="text-sm text-slate-300">
                      This will load all widgets and re-arrange your current dashboard layout.
                    </p>
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">
                      Your saved default dashboard will not be changed.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeResetDefaultsModal}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmResetDefaults}
                    className="rounded-xl border border-amber-500/45 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/30"
                  >
                    Reset and Load All Widgets
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {navigationModalOpen && portalReady
        ? createPortal(
            <div className="app-modal-shell fixed inset-0 z-[111] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm sm:p-6">
              <div className="grid w-full max-w-md gap-4 rounded-2xl border border-amber-500/45 bg-slate-950/95 p-5 shadow-2xl">
                <div className="grid gap-1">
                  <h3 className="text-lg font-bold text-slate-100">
                    Discard unsaved dashboard layout?
                  </h3>
                  <p className="text-sm text-slate-300">
                    You have unsaved widget layout changes. Leaving now will discard those
                    updates.
                  </p>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCancelNavigationAway}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                  >
                    Keep Editing
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmNavigationAway}
                    className="rounded-xl border border-amber-500/45 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/30"
                  >
                    Leave Without Saving
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {activeKpiDrilldown && portalReady
        ? createPortal(
            <div className="app-modal-shell fixed inset-0 z-[112] flex items-center justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm sm:p-6">
              <div className="grid w-full max-w-3xl gap-4 rounded-2xl border border-cyan-500/35 bg-slate-950/95 p-5 shadow-2xl">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-100">
                      {activeKpiDrilldown.title}
                    </h3>
                    <p className="text-sm text-slate-300">{activeKpiDrilldown.subtitle}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveKpiDrilldown(null)}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-3 py-1.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                  >
                    Close
                  </button>
                </div>

                {activeKpiDrilldown.rows.length === 0 ? (
                  <p className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-300">
                    No records were found for this drill down point.
                  </p>
                ) : (
                  <div className="grid max-h-[55vh] gap-2 overflow-y-auto pr-1">
                    {activeKpiDrilldown.rows.map((row) =>
                      row.href ? (
                        <Link
                          key={row.id}
                          href={row.href}
                          onClick={() => setActiveKpiDrilldown(null)}
                          className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 p-3 transition hover:bg-cyan-500/20"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold text-slate-100">{row.label}</p>
                            <span className="text-xs font-semibold text-cyan-200">
                              {activeKpiDrilldown.yAxisLabel}: {formatKpiNumber(row.value)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300">{row.detail}</p>
                        </Link>
                      ) : (
                        <article
                          key={row.id}
                          className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold text-slate-100">{row.label}</p>
                            <span className="text-xs font-semibold text-cyan-200">
                              {activeKpiDrilldown.yAxisLabel}: {formatKpiNumber(row.value)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300">{row.detail}</p>
                        </article>
                      ),
                    )}
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}

      {activeImpactDrilldown && portalReady
        ? createPortal(
            <div className="app-modal-shell fixed inset-0 z-[112] flex items-center justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm sm:p-6">
              <div className="grid w-full max-w-2xl gap-4 rounded-2xl border border-cyan-500/35 bg-slate-950/95 p-5 shadow-2xl">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-100">
                      {activeImpactDrilldown.title}
                    </h3>
                    <p className="text-sm text-slate-300">{activeImpactDrilldown.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setImpactDrilldownKey(null)}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-3 py-1.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                  >
                    Close
                  </button>
                </div>

                {activeImpactDrilldown.entries.length === 0 ? (
                  <p className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-300">
                    {activeImpactDrilldown.emptyMessage}
                  </p>
                ) : (
                  <div className="grid max-h-[55vh] gap-2 overflow-y-auto pr-1">
                    {activeImpactDrilldown.entries.map((entry) => (
                      <Link
                        key={entry.id}
                        href={entry.href}
                        onClick={() => setImpactDrilldownKey(null)}
                        style={{
                          borderColor: colorWithAlpha(entry.color, 0.5),
                          backgroundColor: colorWithAlpha(entry.color, 0.14),
                        }}
                        className="rounded-xl border p-3 transition hover:brightness-110"
                      >
                        <p className="font-semibold text-slate-100">{entry.label}</p>
                        <p className="text-xs text-slate-300">{entry.detail}</p>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}

      {activeDepartmentDrilldown && portalReady
        ? createPortal(
            <div className="app-modal-shell fixed inset-0 z-[112] flex items-center justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm sm:p-6">
              <div className="grid w-full max-w-2xl gap-4 rounded-2xl border border-cyan-500/35 bg-slate-950/95 p-5 shadow-2xl">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-100">
                      {activeDepartmentDrilldown.title}
                    </h3>
                    <p className="text-sm text-slate-300">
                      {activeDepartmentDrilldown.description}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDepartmentDrilldownDepartmentId(null)}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-3 py-1.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                  >
                    Close
                  </button>
                </div>

                {activeDepartmentDrilldown.entries.length === 0 ? (
                  <p className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-300">
                    {activeDepartmentDrilldown.emptyMessage}
                  </p>
                ) : (
                  <div className="grid max-h-[55vh] gap-2 overflow-y-auto pr-1">
                    {activeDepartmentDrilldown.entries.map((entry) => (
                      <Link
                        key={entry.id}
                        href={entry.href}
                        onClick={() => setDepartmentDrilldownDepartmentId(null)}
                        style={{
                          borderColor: colorWithAlpha(entry.color, 0.5),
                          backgroundColor: colorWithAlpha(entry.color, 0.14),
                        }}
                        className="rounded-xl border p-3 transition hover:brightness-110"
                      >
                        <p className="font-semibold text-slate-100">{entry.label}</p>
                        <p className="text-xs text-slate-300">{entry.detail}</p>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

