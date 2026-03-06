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
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
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
  needs_review_note: string | null;
  needs_review_origin: "user" | "system" | null;
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
const DASHBOARD_WIDGET_DRAG_AUTOSCROLL_EDGE_THRESHOLD_PX = 120;
const DASHBOARD_WIDGET_DRAG_AUTOSCROLL_MAX_SPEED_PX_PER_FRAME = 26;
const CELEBRATION_CONFETTI_COLORS = [
  "#22D3EE",
  "#60A5FA",
  "#34D399",
  "#F59E0B",
  "#FB7185",
];
const SYSTEM_HISTORY_TIME_RANGE_SETTING_PATH = [
  "dashboard",
  "systemHistory",
  "timeRangeDays",
] as const;
const WIDGET_TITLE_OVERRIDES_SETTING_PATH = [
  "dashboard",
  "widgetTitles",
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
const RECENT_UPDATES_SCROLL_CARD_LIMIT = 5;
const NEWEST_SCROLL_CARD_LIMIT = 6;
const RECENT_UPDATES_TIME_RANGE_SETTING_PATH = [
  "dashboard",
  "recentUpdates",
  "timeRangeDays",
] as const;
const KPI_WIDGET_TIME_RANGES_SETTING_PATH = [
  "dashboard",
  "kpiWidgetTimeRanges",
] as const;

const DEFAULT_KPI_TIME_RANGE_DAYS: KpiTimeRangeDays = 30;
const MAX_LAYOUT_UNDO_STEPS = 30;

function isKpiTimeRangeDays(value: number): value is KpiTimeRangeDays {
  return value === 7 || value === 30 || value === 90;
}

const MAX_WIDGET_TITLE_LENGTH = 80;
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
  {
    id: "kpi_review_origin_mix",
    title: "KPI: Review Origin Mix",
    description: "Donut graph of user-triggered versus system timeline review changes.",
    category: "kpi",
  },
  {
    id: "kpi_department_event_share",
    title: "KPI: Department Event Share",
    description: "Donut graph of event volume share by department.",
    category: "kpi",
  },
  {
    id: "kpi_actor_activity_mix",
    title: "KPI: Actor Activity Mix",
    description: "Donut graph of event activity by user.",
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
  kpi_review_origin_mix: "standard",
  kpi_department_event_share: "wide",
  kpi_actor_activity_mix: "standard",
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

function getNeedsReviewPillTooltip(
  reviewStatus: DashboardInstructionReviewStatusData | null | undefined,
) {
  if (!reviewStatus || reviewStatus.status !== "needs_review") {
    return "";
  }

  const note = reviewStatus.needs_review_note?.trim();
  if (note) {
    return note;
  }

  return "Mandatory review per system timeline.";
}

function isRecentUpdatesTimeRangeDays(value: number): value is RecentUpdatesTimeRangeDays {
  return RECENT_UPDATES_TIME_RANGE_OPTIONS.some((option) => option.value === value);
}

function truncateKpiLegendLabel(value: string, maxLength = 24) {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function normalizeWidgetTitleOverride(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, MAX_WIDGET_TITLE_LENGTH);
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

function getWorkItemTitle(workItem: DashboardWorkItemSummary) {
  const title = workItem.item_title?.trim();
  return title && title.length > 0 ? title : "Untitled Work Item";
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
  title: string;
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

type RecentUpdatesTimeRangeDays = 7 | 14 | 30 | 90;

const DEFAULT_RECENT_UPDATES_TIME_RANGE_DAYS: RecentUpdatesTimeRangeDays = 30;

const RECENT_UPDATES_TIME_RANGE_OPTIONS: Array<{
  value: RecentUpdatesTimeRangeDays;
  label: string;
}> = [
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
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
  title: string;
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

function getKpiAxisScale(maxValue: number, targetSteps = 4) {
  const safeMax = Math.max(1, Number.isFinite(maxValue) ? maxValue : 1);
  const safeTargetSteps = Math.max(1, targetSteps);
  const roundedMax = Math.ceil(safeMax);
  const step =
    roundedMax <= safeTargetSteps + 1
      ? 1
      : Math.max(1, Math.ceil(roundedMax / safeTargetSteps));
  const axisMax = Math.max(step, Math.ceil(roundedMax / step) * step);
  const ticks = Array.from(
    { length: Math.floor(axisMax / step) + 1 },
    (_, index) => axisMax - index * step,
  );

  return {
    axisMax,
    ticks,
  };
}

interface KpiChartViewport {
  width: number;
  height: number;
  minWidth: number;
  pointRadius: number;
  xLabelTargetCount: number;
  axisTickSteps: number;
}

function getKpiChartViewport(widgetSize: DashboardWidgetSize): KpiChartViewport {
  switch (widgetSize) {
    case "compact":
      return {
        width: 420,
        height: 196,
        minWidth: 360,
        pointRadius: 3,
        xLabelTargetCount: 4,
        axisTickSteps: 3,
      };
    case "full":
      return {
        width: 1080,
        height: 252,
        minWidth: 920,
        pointRadius: 4.5,
        xLabelTargetCount: 12,
        axisTickSteps: 5,
      };
    case "wide":
      return {
        width: 860,
        height: 236,
        minWidth: 740,
        pointRadius: 4,
        xLabelTargetCount: 9,
        axisTickSteps: 4,
      };
    case "standard":
    default:
      return {
        width: 640,
        height: 220,
        minWidth: 560,
        pointRadius: 4,
        xLabelTargetCount: 6,
        axisTickSteps: 4,
      };
  }
}

function getKpiXAxisLabelStep(totalPoints: number, targetLabelCount: number) {
  if (totalPoints <= 1 || targetLabelCount <= 1) {
    return 1;
  }

  return Math.max(1, Math.ceil(totalPoints / targetLabelCount));
}

function shouldRenderKpiXAxisLabel(
  index: number,
  totalPoints: number,
  labelStep: number,
) {
  if (totalPoints <= 1) {
    return true;
  }

  return index === 0 || index === totalPoints - 1 || index % labelStep === 0;
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
  widgetSize,
  lineColor = "#06B6D4",
  showArea = false,
  onSelectPoint,
}: {
  points: KpiTimeSeriesPoint[];
  yAxisLabel: string;
  widgetSize: DashboardWidgetSize;
  lineColor?: string;
  showArea?: boolean;
  onSelectPoint?: (point: KpiTimeSeriesPoint) => void;
}) {
  const viewport = getKpiChartViewport(widgetSize);
  const width = viewport.width;
  const height = viewport.height;
  const padding = { top: 16, right: 12, bottom: 34, left: 44 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...points.map((point) => point.value));
  const { axisMax, ticks } = getKpiAxisScale(maxValue, viewport.axisTickSteps);
  const xStep = points.length > 1 ? plotWidth / (points.length - 1) : 0;
  const labelStep = getKpiXAxisLabelStep(points.length, viewport.xLabelTargetCount);
  const yAxisTitleX = padding.left - 20;
  const yAxisTitleY = padding.top + plotHeight / 2;

  const toX = (index: number) =>
    points.length > 1 ? padding.left + xStep * index : padding.left + plotWidth / 2;
  const toY = (value: number) =>
    padding.top + ((axisMax - value) / axisMax) * plotHeight;

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
          className="w-full text-slate-500 dark:text-slate-300"
          style={{
            minWidth: `${viewport.minWidth}px`,
            height: `${Math.round(viewport.height)}px`,
          }}
        >
          <text
            x={yAxisTitleX}
            y={yAxisTitleY}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-current text-[11px] font-semibold"
            transform={`rotate(-90 ${yAxisTitleX} ${yAxisTitleY})`}
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
                r={viewport.pointRadius}
                fill={lineColor}
                className={onSelectPoint ? "cursor-pointer" : ""}
                onClick={() => onSelectPoint?.(point)}
              />
              {shouldRenderKpiXAxisLabel(index, points.length, labelStep) ? (
                <text
                  x={toX(index)}
                  y={height - 12}
                  textAnchor="middle"
                  className="fill-current text-[10px]"
                >
                  {point.shortLabel}
                </text>
              ) : null}
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
  widgetSize,
  onSelectBar,
}: {
  bars: KpiBarPoint[];
  yAxisLabel: string;
  widgetSize: DashboardWidgetSize;
  onSelectBar?: (bar: KpiBarPoint) => void;
}) {
  const viewport = getKpiChartViewport(widgetSize);
  const width = viewport.width;
  const height = viewport.height;
  const padding = { top: 16, right: 12, bottom: 42, left: 44 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...bars.map((bar) => bar.value));
  const { axisMax, ticks } = getKpiAxisScale(maxValue, viewport.axisTickSteps);
  const barSlotWidth = bars.length > 0 ? plotWidth / bars.length : plotWidth;
  const barWidth = Math.max(
    widgetSize === "compact" ? 10 : 14,
    Math.min(widgetSize === "full" ? 48 : 42, barSlotWidth - 8),
  );
  const toY = (value: number) => padding.top + ((axisMax - value) / axisMax) * plotHeight;
  const labelStep = getKpiXAxisLabelStep(bars.length, viewport.xLabelTargetCount);
  const yAxisTitleX = padding.left - 20;
  const yAxisTitleY = padding.top + plotHeight / 2;

  return (
    <div className="grid gap-2">
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full text-slate-500 dark:text-slate-300"
          style={{
            minWidth: `${viewport.minWidth}px`,
            height: `${Math.round(viewport.height)}px`,
          }}
        >
          <text
            x={yAxisTitleX}
            y={yAxisTitleY}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-current text-[11px] font-semibold"
            transform={`rotate(-90 ${yAxisTitleX} ${yAxisTitleY})`}
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
            const rawBarHeight = padding.top + plotHeight - y;
            const barHeight = bar.value > 0 ? Math.max(1, rawBarHeight) : 0;

            return (
              <g key={bar.id}>
                {barHeight > 0 ? (
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    rx={4}
                    fill={bar.color}
                    className={onSelectBar ? "cursor-pointer" : ""}
                    onClick={() => onSelectBar?.(bar)}
                  />
                ) : null}
                {shouldRenderKpiXAxisLabel(index, bars.length, labelStep) ? (
                  <text
                    x={x + barWidth / 2}
                    y={height - 18}
                    textAnchor="middle"
                    className="fill-current text-[10px]"
                  >
                    {bar.label}
                  </text>
                ) : null}
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
  widgetSize,
  onSelectPoint,
}: {
  points: KpiStackedPoint[];
  yAxisLabel: string;
  widgetSize: DashboardWidgetSize;
  onSelectPoint?: (point: KpiStackedPoint) => void;
}) {
  const viewport = getKpiChartViewport(widgetSize);
  const width = viewport.width;
  const height = viewport.height;
  const padding = { top: 16, right: 12, bottom: 34, left: 44 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(
    1,
    ...points.map((point) => point.healthy + point.attention),
  );
  const { axisMax, ticks } = getKpiAxisScale(maxValue, viewport.axisTickSteps);
  const barSlotWidth = points.length > 0 ? plotWidth / points.length : plotWidth;
  const barWidth = Math.max(
    widgetSize === "compact" ? 6 : 8,
    Math.min(widgetSize === "full" ? 28 : 24, barSlotWidth - 6),
  );
  const toY = (value: number) => padding.top + ((axisMax - value) / axisMax) * plotHeight;
  const labelStep = getKpiXAxisLabelStep(points.length, viewport.xLabelTargetCount);

  return (
    <div className="grid gap-2">
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full text-slate-500 dark:text-slate-300"
          style={{
            minWidth: `${viewport.minWidth}px`,
            height: `${Math.round(viewport.height)}px`,
          }}
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
            const rawHealthyHeight = padding.top + plotHeight - healthyTopY;
            const healthyHeight = point.healthy > 0 ? Math.max(1, rawHealthyHeight) : 0;
            const rawAttentionHeight = total > 0 ? healthyTopY - totalTopY : 0;
            const attentionHeight =
              point.attention > 0 ? Math.max(1, rawAttentionHeight) : 0;
            const healthySegmentRadius = attentionHeight > 0 ? 0 : 3;

            return (
              <g key={point.id}>
                {healthyHeight > 0 ? (
                  <rect
                    x={x}
                    y={healthyTopY}
                    width={barWidth}
                    height={healthyHeight}
                    rx={healthySegmentRadius}
                    fill="#22C55E"
                    className={onSelectPoint ? "cursor-pointer" : ""}
                    onClick={() => onSelectPoint?.(point)}
                  />
                ) : null}
                {attentionHeight > 0 ? (
                  <rect
                    x={x}
                    y={totalTopY}
                    width={barWidth}
                    height={attentionHeight}
                    rx={3}
                    fill="#F59E0B"
                    className={onSelectPoint ? "cursor-pointer" : ""}
                    onClick={() => onSelectPoint?.(point)}
                  />
                ) : null}
                {shouldRenderKpiXAxisLabel(index, points.length, labelStep) ? (
                  <text
                    x={x + barWidth / 2}
                    y={height - 12}
                    textAnchor="middle"
                    className="fill-current text-[10px]"
                  >
                    {point.shortLabel}
                  </text>
                ) : null}
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
  widgetSize,
  onSelectPoint,
}: {
  points: KpiScatterPoint[];
  xAxisLabel: string;
  yAxisLabel: string;
  widgetSize: DashboardWidgetSize;
  onSelectPoint?: (point: KpiScatterPoint) => void;
}) {
  const viewport = getKpiChartViewport(widgetSize);
  const width = viewport.width;
  const height = viewport.height;
  const padding = { top: 16, right: 12, bottom: 34, left: 44 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxX = Math.max(1, ...points.map((point) => point.xValue));
  const maxY = Math.max(1, ...points.map((point) => point.yValue));
  const { axisMax: axisMaxX, ticks: xTicks } = getKpiAxisScale(
    maxX,
    viewport.axisTickSteps,
  );
  const { axisMax: axisMaxY, ticks: yTicks } = getKpiAxisScale(
    maxY,
    viewport.axisTickSteps,
  );
  const toX = (value: number) => padding.left + (value / axisMaxX) * plotWidth;
  const toY = (value: number) => padding.top + ((axisMaxY - value) / axisMaxY) * plotHeight;
  const yAxisTitleX = padding.left - 20;
  const yAxisTitleY = padding.top + plotHeight / 2;

  return (
    <div className="grid gap-2">
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full text-slate-500 dark:text-slate-300"
          style={{
            minWidth: `${viewport.minWidth}px`,
            height: `${Math.round(viewport.height)}px`,
          }}
        >
          <text
            x={yAxisTitleX}
            y={yAxisTitleY}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-current text-[11px] font-semibold"
            transform={`rotate(-90 ${yAxisTitleX} ${yAxisTitleY})`}
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
              r={viewport.pointRadius}
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
  widgetSize,
  onSelectSegment,
}: {
  segments: KpiDonutSegment[];
  widgetSize: DashboardWidgetSize;
  onSelectSegment?: (segment: KpiDonutSegment) => void;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const isCompact = widgetSize === "compact";
  const isWide = widgetSize === "wide";
  const isFull = widgetSize === "full";
  const radius =
    isCompact ? 42 : isFull ? 98 : isWide ? 72 : 58;
  const circumference = 2 * Math.PI * radius;
  let cumulative = 0;
  const donutSize = radius * 2 + 36;
  const center = donutSize / 2;
  const ringWidth = isCompact ? 14 : isFull ? 24 : isWide ? 20 : 18;
  const donutPixelSize = isCompact ? 112 : isFull ? 304 : isWide ? 236 : 188;
  const totalLabelY = center - (isCompact ? 2 : isFull ? 18 : 6);
  const totalValueY = center + (isCompact ? 14 : isFull ? 22 : 14);

  return (
    <div className="grid gap-3">
      <div
        className={cn(
          "grid items-center gap-4",
          isCompact
            ? "justify-items-center"
            : isFull
              ? "md:grid-cols-[minmax(280px,340px)_1fr]"
              : "sm:grid-cols-[minmax(200px,240px)_1fr]",
        )}
      >
        <svg
          viewBox={`0 0 ${donutSize} ${donutSize}`}
          className="shrink-0"
          style={{ width: `${donutPixelSize}px`, height: `${donutPixelSize}px` }}
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#CBD5E1"
            strokeWidth={ringWidth}
          />
          {total > 0
            ? segments.map((segment) => {
                const segmentLength = (segment.value / total) * circumference;
                const dashOffset = -cumulative;
                cumulative += segmentLength;

                return (
                  <circle
                    key={segment.id}
                    cx={center}
                    cy={center}
                    r={radius}
                    fill="none"
                    stroke={segment.color}
                    strokeWidth={ringWidth}
                    strokeDasharray={`${segmentLength} ${circumference - segmentLength}`}
                    strokeDashoffset={dashOffset}
                    transform={`rotate(-90 ${center} ${center})`}
                    className={onSelectSegment ? "cursor-pointer" : ""}
                    onClick={() => onSelectSegment?.(segment)}
                  />
                );
              })
            : null}
          <text
            x={center}
            y={totalLabelY}
            textAnchor="middle"
            dominantBaseline="middle"
            className={cn(
              "fill-slate-700 font-semibold dark:fill-slate-300",
              isFull ? "text-[13px]" : "text-[11px]",
            )}
          >
            Total
          </text>
          <text
            x={center}
            y={totalValueY}
            textAnchor="middle"
            dominantBaseline="middle"
            className={cn(
              "fill-slate-900 font-extrabold dark:fill-slate-100",
              isCompact ? "text-base" : isFull ? "text-2xl" : "text-xl",
            )}
          >
            {total}
          </text>
        </svg>

        <div
          className={cn(
            "grid w-full gap-1.5",
            !isCompact && isFull ? "sm:grid-cols-2" : "",
          )}
        >
          {segments.map((segment) => (
            <button
              key={segment.id}
              type="button"
              onClick={() => onSelectSegment?.(segment)}
              className={cn(
                "inline-flex w-full items-center gap-2 rounded-lg border border-slate-300/70 bg-white/70 text-left font-semibold text-slate-700 transition hover:bg-cyan-500/10 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-cyan-500/15",
                isCompact
                  ? "px-2.5 py-1 text-xs"
                  : isFull
                    ? "min-h-14 rounded-xl px-4 py-3 text-base"
                    : "px-3 py-1.5 text-sm",
              )}
            >
              <span
                className={cn("rounded-sm", isFull ? "h-3.5 w-3.5" : "h-2.5 w-2.5")}
                style={{ backgroundColor: segment.color }}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 whitespace-normal break-words",
                  isFull ? "text-base" : "",
                )}
              >
                {segment.label}
              </span>
              <span
                className={cn(
                  "ml-auto shrink-0 text-slate-500 dark:text-slate-400",
                  isFull ? "text-base font-bold" : "",
                )}
              >
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

function computeKpiMetricsForRange(
  days: KpiTimeRangeDays,
  filteredSystemHistoryEvents: DashboardSystemHistoryEventData[],
  instructionEntriesScoped: Array<{
    instruction: DashboardWorkItemInstructionData;
    workItem: DashboardWorkItemData;
  }>,
  reviewStatusMap: Record<string, DashboardInstructionReviewStatusData>,
  reviewWindowDays: number,
) {
  // Build date buckets
  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();

  const dateRangeBuckets = Array.from({ length: days }, (_, index) => {
    const offset = days - 1 - index;
    const start = todayStart - offset * ONE_DAY_MS;
    return {
      id: `kpi-day-${start}`,
      start,
      end: start + ONE_DAY_MS,
      shortLabel: formatKpiShortDate(start),
      fullLabel: formatKpiLongDate(start),
    };
  });

  const rangeStart = dateRangeBuckets[0]?.start ?? 0;
  const rangeEnd = (dateRangeBuckets[dateRangeBuckets.length - 1]?.end ?? 0) + 1;
  const bucketIndexByStart = new Map(
    dateRangeBuckets.map((bucket, index) => [bucket.start, index]),
  );

  const eventsInRange = filteredSystemHistoryEvents
    .map((event) => ({
      event,
      timestamp: toSortableTimestamp(event.occurred_at),
    }))
    .filter(
      (entry) =>
        entry.timestamp >= rangeStart &&
        entry.timestamp < rangeEnd &&
        entry.timestamp > 0,
    );

  // dateRangeLabel
  const first = dateRangeBuckets[0];
  const last = dateRangeBuckets[dateRangeBuckets.length - 1];
  const dateRangeLabel =
    first && last ? `${first.fullLabel} - ${last.fullLabel}` : "";

  // throughputMetric
  const throughputPoints = dateRangeBuckets.map((bucket) => ({
    id: bucket.id,
    shortLabel: bucket.shortLabel,
    fullLabel: bucket.fullLabel,
    value: 0,
  }));
  const throughputRowsByPointId = new Map<string, KpiDrilldownRow[]>();

  for (const { event, timestamp } of eventsInRange) {
    const dayStart = toDayStartTimestamp(event.occurred_at);
    if (dayStart === null) {
      continue;
    }
    const bucketIndex = bucketIndexByStart.get(dayStart);
    if (bucketIndex === undefined) {
      continue;
    }
    const point = throughputPoints[bucketIndex];
    if (!point) {
      continue;
    }
    point.value += 1;
    const existing = throughputRowsByPointId.get(point.id) ?? [];
    existing.push({
      id: event.id,
      label: getLabelWithDepartment(event.workItem),
      title: getWorkItemTitle(event.workItem),
      detail: `${event.action_label} by ${event.actor_name} at ${new Date(
        timestamp,
      ).toLocaleTimeString()}`,
      value: 1,
      href: `/instructions/${event.instruction_id}`,
    });
    throughputRowsByPointId.set(point.id, existing);
  }
  const throughputMetric = { points: throughputPoints, rowsByPointId: throughputRowsByPointId };

  // creationVelocityMetric
  const creationVelocityPoints = dateRangeBuckets.map((bucket) => ({
    id: `${bucket.id}-created`,
    shortLabel: bucket.shortLabel,
    fullLabel: bucket.fullLabel,
    value: 0,
  }));
  const creationVelocityRowsByPointId = new Map<string, KpiDrilldownRow[]>();

  for (const entry of instructionEntriesScoped) {
    const timestamp = toSortableTimestamp(entry.instruction.created_at);
    if (timestamp < rangeStart || timestamp >= rangeEnd || timestamp <= 0) {
      continue;
    }
    const dayStart = toDayStartTimestamp(entry.instruction.created_at);
    if (dayStart === null) {
      continue;
    }
    const bucketIndex = bucketIndexByStart.get(dayStart);
    if (bucketIndex === undefined) {
      continue;
    }
    const point = creationVelocityPoints[bucketIndex];
    if (!point) {
      continue;
    }
    point.value += 1;
    const existing = creationVelocityRowsByPointId.get(point.id) ?? [];
    existing.push({
      id: entry.instruction.id,
      label: getLabelWithDepartment(entry.workItem),
      title: getWorkItemTitle(entry.workItem),
      detail: `Revision ${entry.instruction.revision} created by ${entry.instruction.creator_name}`,
      value: 1,
      href: `/instructions/${entry.instruction.id}`,
    });
    creationVelocityRowsByPointId.set(point.id, existing);
  }
  const creationVelocityMetric = {
    points: creationVelocityPoints,
    rowsByPointId: creationVelocityRowsByPointId,
  };

  // departmentWorkloadMetric
  const totalsByDepartmentWorkload = new Map<
    string,
    {
      id: string;
      label: string;
      color: string;
      value: number;
      rows: KpiDrilldownRow[];
    }
  >();

  for (const { event, timestamp } of eventsInRange) {
    const existing = totalsByDepartmentWorkload.get(event.workItem.department_id) ?? {
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
      title: getWorkItemTitle(event.workItem),
      detail: `${event.action_label} by ${event.actor_name} on ${new Date(
        timestamp,
      ).toLocaleDateString()}`,
      value: 1,
      href: `/instructions/${event.instruction_id}`,
    });
    totalsByDepartmentWorkload.set(event.workItem.department_id, existing);
  }

  const rankedWorkload = [...totalsByDepartmentWorkload.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const departmentWorkloadBars: KpiBarPoint[] = rankedWorkload.map((entry) => ({
    id: entry.id,
    label:
      entry.label.length > 12
        ? `${entry.label.slice(0, 11).trimEnd()}…`
        : entry.label,
    value: entry.value,
    color: entry.color,
  }));
  const departmentWorkloadRowsByBarId = new Map(
    rankedWorkload.map((entry) => [entry.id, entry.rows]),
  );
  const departmentWorkloadMetric = {
    bars: departmentWorkloadBars,
    rowsByBarId: departmentWorkloadRowsByBarId,
  };

  // reviewHealthMetric
  const reviewHealthPoints = dateRangeBuckets.map((bucket) => ({
    id: `${bucket.id}-review-health`,
    shortLabel: bucket.shortLabel,
    fullLabel: bucket.fullLabel,
    healthy: 0,
    attention: 0,
  }));
  const reviewHealthRowsByPointId = new Map<string, KpiDrilldownRow[]>();

  for (const entry of instructionEntriesScoped) {
    const timestamp = toSortableTimestamp(entry.instruction.updated_at);
    if (timestamp < rangeStart || timestamp >= rangeEnd || timestamp <= 0) {
      continue;
    }
    const dayStart = toDayStartTimestamp(entry.instruction.updated_at);
    if (dayStart === null) {
      continue;
    }
    const bucketIndex = bucketIndexByStart.get(dayStart);
    if (bucketIndex === undefined) {
      continue;
    }
    const point = reviewHealthPoints[bucketIndex];
    if (!point) {
      continue;
    }
    const reviewStatus = reviewStatusMap[entry.instruction.id] ?? null;
    const daysSinceCalibration = toElapsedCalendarDays(
      reviewStatus?.last_calibrated_at ?? entry.instruction.updated_at,
    );
    const needsAttention =
      reviewStatus?.status === "needs_review" ||
      (daysSinceCalibration !== null && daysSinceCalibration >= reviewWindowDays);

    if (needsAttention) {
      point.attention += 1;
    } else {
      point.healthy += 1;
    }

    const existing = reviewHealthRowsByPointId.get(point.id) ?? [];
    existing.push({
      id: entry.instruction.id,
      label: getLabelWithDepartment(entry.workItem),
      title: getWorkItemTitle(entry.workItem),
      detail: needsAttention
        ? `Needs attention | Revision ${entry.instruction.revision}`
        : `Healthy | Revision ${entry.instruction.revision}`,
      value: 1,
      href: `/instructions/${entry.instruction.id}`,
    });
    reviewHealthRowsByPointId.set(point.id, existing);
  }
  const reviewHealthMetric = {
    points: reviewHealthPoints,
    rowsByPointId: reviewHealthRowsByPointId,
  };

  // revisionCycleMetric
  const revisionCyclePoints: KpiScatterPoint[] = [];
  const revisionCycleRowsByPointId = new Map<string, KpiDrilldownRow[]>();

  const sortedEntries = [...instructionEntriesScoped].sort(
    (left, right) =>
      toSortableTimestamp(right.instruction.updated_at) -
      toSortableTimestamp(left.instruction.updated_at),
  );

  for (const entry of sortedEntries) {
    const updatedTimestamp = toSortableTimestamp(entry.instruction.updated_at);
    if (
      updatedTimestamp < rangeStart ||
      updatedTimestamp >= rangeEnd ||
      updatedTimestamp <= 0
    ) {
      continue;
    }
    const daysSinceUpdate = toElapsedCalendarDays(entry.instruction.updated_at);
    const xValue = Math.max(0, daysSinceUpdate ?? 0);
    const yValue = Math.max(1, entry.instruction.revision);
    const pointId = `${entry.instruction.id}-${entry.instruction.revision}`;
    revisionCyclePoints.push({
      id: pointId,
      label: getLabelWithDepartment(entry.workItem),
      xValue,
      yValue,
      color: normalizeDepartmentColor(entry.workItem.department_color),
    });
    revisionCycleRowsByPointId.set(pointId, [
      {
        id: entry.instruction.id,
        label: getLabelWithDepartment(entry.workItem),
        title: getWorkItemTitle(entry.workItem),
        detail: `Revision ${entry.instruction.revision} updated by ${entry.instruction.updater_name}`,
        value: yValue,
        href: `/instructions/${entry.instruction.id}`,
      },
    ]);

    if (revisionCyclePoints.length >= 80) {
      break;
    }
  }
  const revisionCycleMetric = {
    points: revisionCyclePoints,
    rowsByPointId: revisionCycleRowsByPointId,
  };

  // eventMixMetric
  const eventMixSegmentsById: Record<
    "created" | "updated" | "needs_review" | "up_to_date",
    KpiDonutSegment
  > = {
    created: { id: "created", label: "Created", value: 0, color: "#0EA5E9" },
    updated: { id: "updated", label: "Updated", value: 0, color: "#2563EB" },
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
  const eventMixRowsBySegmentId = new Map<string, KpiDrilldownRow[]>();

  for (const { event, timestamp } of eventsInRange) {
    const segmentId = classifyKpiEventType(event);
    const segment = eventMixSegmentsById[segmentId];
    if (!segment) {
      continue;
    }
    segment.value += 1;
    const existingRows = eventMixRowsBySegmentId.get(segment.id) ?? [];
    existingRows.push({
      id: event.id,
      label: getLabelWithDepartment(event.workItem),
      title: getWorkItemTitle(event.workItem),
      detail: `${event.action_label} by ${event.actor_name} on ${new Date(
        timestamp,
      ).toLocaleDateString()}`,
      value: 1,
      href: `/instructions/${event.instruction_id}`,
    });
    eventMixRowsBySegmentId.set(segment.id, existingRows);
  }
  const eventMixMetric = {
    segments: Object.values(eventMixSegmentsById).filter((segment) => segment.value > 0),
    rowsBySegmentId: eventMixRowsBySegmentId,
  };

  // reviewOriginMixMetric
  const reviewOriginSegmentsById: Record<"user" | "system", KpiDonutSegment> = {
    user: {
      id: "review-origin-user",
      label: "User Triggered",
      value: 0,
      color: "#3B82F6",
    },
    system: {
      id: "review-origin-system",
      label: "System Timeline",
      value: 0,
      color: "#F97316",
    },
  };
  const reviewOriginRowsBySegmentId = new Map<string, KpiDrilldownRow[]>();

  for (const { event, timestamp } of eventsInRange) {
    const eventType = classifyKpiEventType(event);
    if (eventType !== "needs_review" && eventType !== "up_to_date") {
      continue;
    }
    const segment =
      event.detail.trim().toLowerCase().includes("system counter")
        ? reviewOriginSegmentsById.system
        : reviewOriginSegmentsById.user;
    segment.value += 1;
    const existingRows = reviewOriginRowsBySegmentId.get(segment.id) ?? [];
    existingRows.push({
      id: event.id,
      label: getLabelWithDepartment(event.workItem),
      title: getWorkItemTitle(event.workItem),
      detail: `${event.action_label} by ${event.actor_name} on ${new Date(
        timestamp,
      ).toLocaleDateString()}`,
      value: 1,
      href: `/instructions/${event.instruction_id}`,
    });
    reviewOriginRowsBySegmentId.set(segment.id, existingRows);
  }
  const reviewOriginMixMetric = {
    segments: Object.values(reviewOriginSegmentsById).filter((segment) => segment.value > 0),
    rowsBySegmentId: reviewOriginRowsBySegmentId,
  };

  // departmentEventShareMetric
  const totalsByDepartmentShare = new Map<
    string,
    {
      id: string;
      label: string;
      color: string;
      value: number;
      rows: KpiDrilldownRow[];
    }
  >();

  for (const { event, timestamp } of eventsInRange) {
    const existing = totalsByDepartmentShare.get(event.workItem.department_id) ?? {
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
      title: getWorkItemTitle(event.workItem),
      detail: `${event.action_label} by ${event.actor_name} on ${new Date(
        timestamp,
      ).toLocaleDateString()}`,
      value: 1,
      href: `/instructions/${event.instruction_id}`,
    });
    totalsByDepartmentShare.set(event.workItem.department_id, existing);
  }

  const rankedDepartmentShare = [...totalsByDepartmentShare.values()].sort(
    (a, b) => b.value - a.value,
  );
  const departmentShareRowsBySegmentId = new Map<string, KpiDrilldownRow[]>();
  const departmentShareSegments: KpiDonutSegment[] = rankedDepartmentShare.map((entry) => {
    departmentShareRowsBySegmentId.set(entry.id, entry.rows);
    return {
      id: entry.id,
      label: entry.label,
      value: entry.value,
      color: entry.color,
    };
  });
  const departmentEventShareMetric = {
    segments: departmentShareSegments,
    rowsBySegmentId: departmentShareRowsBySegmentId,
  };

  // actorActivityMixMetric
  const actorColorRamp = [
    "#06B6D4",
    "#3B82F6",
    "#8B5CF6",
    "#F59E0B",
    "#22C55E",
    "#F43F5E",
  ];
  const totalsByActor = new Map<
    string,
    {
      id: string;
      label: string;
      value: number;
      rows: KpiDrilldownRow[];
    }
  >();

  for (const { event, timestamp } of eventsInRange) {
    const actorKey = event.actor_name.trim() || "Unknown User";
    const existing = totalsByActor.get(actorKey) ?? {
      id: actorKey,
      label: actorKey,
      value: 0,
      rows: [],
    };
    existing.value += 1;
    existing.rows.push({
      id: event.id,
      label: getLabelWithDepartment(event.workItem),
      title: getWorkItemTitle(event.workItem),
      detail: `${event.action_label} by ${event.actor_name} on ${new Date(
        timestamp,
      ).toLocaleDateString()}`,
      value: 1,
      href: `/instructions/${event.instruction_id}`,
    });
    totalsByActor.set(actorKey, existing);
  }

  const rankedActors = [...totalsByActor.values()].sort((a, b) => b.value - a.value);
  const topActors = rankedActors.slice(0, 5);
  const remainingActors = rankedActors.slice(5);
  const actorRowsBySegmentId = new Map<string, KpiDrilldownRow[]>();
  const actorSegments: KpiDonutSegment[] = topActors.map((entry, index) => {
    const segmentId = `actor-${index + 1}-${entry.id}`;
    actorRowsBySegmentId.set(segmentId, entry.rows);
    return {
      id: segmentId,
      label: truncateKpiLegendLabel(entry.label, 20),
      value: entry.value,
      color: actorColorRamp[index % actorColorRamp.length] ?? "#0EA5E9",
    };
  });

  if (remainingActors.length > 0) {
    const otherRows = remainingActors.flatMap((entry) => entry.rows);
    const otherValue = remainingActors.reduce((sum, entry) => sum + entry.value, 0);
    actorRowsBySegmentId.set("actors-other", otherRows);
    actorSegments.push({
      id: "actors-other",
      label: "Other Users",
      value: otherValue,
      color: "#94A3B8",
    });
  }
  const actorActivityMixMetric = {
    segments: actorSegments,
    rowsBySegmentId: actorRowsBySegmentId,
  };

  return {
    dateRangeLabel,
    throughputMetric,
    creationVelocityMetric,
    departmentWorkloadMetric,
    reviewHealthMetric,
    revisionCycleMetric,
    eventMixMetric,
    reviewOriginMixMetric,
    departmentEventShareMetric,
    actorActivityMixMetric,
  };
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
  const layoutUndoStackRef = useRef<DashboardWidgetLayoutItem[][]>([]);
  const layoutRedoStackRef = useRef<DashboardWidgetLayoutItem[][]>([]);
  const customizeOpenRef = useRef(false);
  const saveLayoutActionRef = useRef<(() => Promise<void>) | null>(null);
  const saveLayoutAsDefaultActionRef = useRef<(() => Promise<void>) | null>(null);
  const loadDefaultLayoutActionRef = useRef<(() => Promise<void>) | null>(null);
  const resetDefaultsActionRef = useRef<(() => Promise<void>) | null>(null);
  const discardLayoutActionRef = useRef<(() => void) | null>(null);
  const undoLayoutActionRef = useRef<(() => void) | null>(null);
  const redoLayoutActionRef = useRef<(() => void) | null>(null);
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
  const dragPointerPositionRef = useRef<{
    clientX: number;
    clientY: number;
  } | null>(null);
  const dragAutoScrollFrameRef = useRef<number | null>(null);
  const dragOverWidgetIdRef = useRef<DashboardWidgetId | null>(null);
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
  const previousUserIdRef = useRef(currentUserId);
  const widgetTitleInputRef = useRef<HTMLInputElement | null>(null);
  const cancelWidgetTitleCommitRef = useRef(false);
  const newestListRef = useRef<HTMLDivElement | null>(null);
  const systemHistoryListRef = useRef<HTMLDivElement | null>(null);
  const recentUpdatesListRef = useRef<HTMLDivElement | null>(null);
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
  const [layoutUndoStack, setLayoutUndoStack] = useState<DashboardWidgetLayoutItem[][]>([]);
  const [layoutRedoStack, setLayoutRedoStack] = useState<DashboardWidgetLayoutItem[][]>([]);
  const [newestTimeRangeDays, setNewestTimeRangeDays] = useState<KpiTimeRangeDays>(30);
  const [kpiTimeRangeByWidget, setKpiTimeRangeByWidget] = useState<Partial<Record<string, KpiTimeRangeDays>>>({});
  const [activeKpiDrilldown, setActiveKpiDrilldown] =
    useState<KpiDrilldownPanelData | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [navigationModalOpen, setNavigationModalOpen] = useState(false);
  const [resetDefaultsModalOpen, setResetDefaultsModalOpen] = useState(false);
  const [layoutNotice, setLayoutNotice] = useState<string | null>(null);
  const [impactDrilldownKey, setImpactDrilldownKey] = useState<ImpactDrilldownKey | null>(null);
  const [departmentDrilldownDepartmentId, setDepartmentDrilldownDepartmentId] =
    useState<string | null>(null);
  const [systemHistoryTimeRangeDays, setSystemHistoryTimeRangeDays] =
    useState<RecentUpdatesTimeRangeDays>(DEFAULT_RECENT_UPDATES_TIME_RANGE_DAYS);
  const [systemHistoryListMaxHeight, setSystemHistoryListMaxHeight] = useState<number | null>(
    null,
  );
  const [recentUpdatesTimeRangeDays, setRecentUpdatesTimeRangeDays] =
    useState<RecentUpdatesTimeRangeDays>(DEFAULT_RECENT_UPDATES_TIME_RANGE_DAYS);
  const [newestListMaxHeight, setNewestListMaxHeight] = useState<number | null>(null);
  const [recentUpdatesListMaxHeight, setRecentUpdatesListMaxHeight] = useState<number | null>(
    null,
  );
  const [widgetTitleOverrides, setWidgetTitleOverrides] = useState<
    Partial<Record<DashboardWidgetId, string>>
  >({});
  const [editingWidgetTitleId, setEditingWidgetTitleId] =
    useState<DashboardWidgetId | null>(null);
  const [editingWidgetTitleValue, setEditingWidgetTitleValue] = useState("");
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

  const getKpiWidgetTimeRange = (widgetId: string): KpiTimeRangeDays =>
    kpiTimeRangeByWidget[widgetId] ?? DEFAULT_KPI_TIME_RANGE_DAYS;

  function setKpiWidgetTimeRange(widgetId: string, days: KpiTimeRangeDays) {
    setKpiTimeRangeByWidget((prev) => ({ ...prev, [widgetId]: days }));
  }

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
  const activeKpiDrilldownTotalEvents = useMemo(
    () =>
      activeKpiDrilldown?.rows.reduce(
        (sum, row) => sum + (Number.isFinite(row.value) ? row.value : 0),
        0,
      ) ?? 0,
    [activeKpiDrilldown],
  );

  useEffect(() => {
    dragOverWidgetIdRef.current = dragOverWidgetId;
  }, [dragOverWidgetId]);

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;
  const widgetTitleById = useMemo(() => {
    return new Map<DashboardWidgetId, string>(
      WIDGET_DEFINITIONS.map((widgetDefinition) => [
        widgetDefinition.id,
        widgetTitleOverrides[widgetDefinition.id] ?? widgetDefinition.title,
      ]),
    );
  }, [widgetTitleOverrides]);

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
        title: widgetTitleById.get(widget.id) ?? definition?.title ?? widget.id,
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
          canUndoLayout: layoutUndoStack.length > 0,
          canRedoLayout: layoutRedoStack.length > 0,
          activeLayoutPresetId,
          layoutPresets: DASHBOARD_LAYOUT_PRESETS.map((preset) => ({
            id: preset.id,
            label: preset.label,
          })),
          studioWidgets,
        },
      }),
    );
  }, [
    customizeOpen,
    layoutDirty,
    layoutError,
    layoutSaving,
    layoutUndoStack.length,
    layoutRedoStack.length,
    widgetLayout,
    widgetTitleById,
  ]);

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

      const rawSystemHistoryTimeRange = getUserSettingAtPath(
        settings,
        SYSTEM_HISTORY_TIME_RANGE_SETTING_PATH,
      );
      const parsedSystemHistoryTimeRange =
        typeof rawSystemHistoryTimeRange === "number"
          ? rawSystemHistoryTimeRange
          : typeof rawSystemHistoryTimeRange === "string"
            ? Number.parseInt(rawSystemHistoryTimeRange, 10)
            : Number.NaN;
      if (isRecentUpdatesTimeRangeDays(parsedSystemHistoryTimeRange)) {
        setSystemHistoryTimeRangeDays(parsedSystemHistoryTimeRange);
      }

      const rawRecentUpdatesTimeRange = getUserSettingAtPath(
        settings,
        RECENT_UPDATES_TIME_RANGE_SETTING_PATH,
      );
      const parsedRecentUpdatesTimeRange =
        typeof rawRecentUpdatesTimeRange === "number"
          ? rawRecentUpdatesTimeRange
          : typeof rawRecentUpdatesTimeRange === "string"
            ? Number.parseInt(rawRecentUpdatesTimeRange, 10)
            : Number.NaN;
      if (isRecentUpdatesTimeRangeDays(parsedRecentUpdatesTimeRange)) {
        setRecentUpdatesTimeRangeDays(parsedRecentUpdatesTimeRange);
      }

      const rawKpiWidgetTimeRanges = getUserSettingAtPath(
        settings,
        KPI_WIDGET_TIME_RANGES_SETTING_PATH,
      );
      if (
        rawKpiWidgetTimeRanges &&
        typeof rawKpiWidgetTimeRanges === "object" &&
        !Array.isArray(rawKpiWidgetTimeRanges)
      ) {
        const parsedRanges: Partial<Record<string, KpiTimeRangeDays>> = {};
        for (const [wId, rawVal] of Object.entries(
          rawKpiWidgetTimeRanges as Record<string, unknown>,
        )) {
          const numVal =
            typeof rawVal === "number"
              ? rawVal
              : typeof rawVal === "string"
                ? Number.parseInt(rawVal, 10)
                : Number.NaN;
          if (isKpiTimeRangeDays(numVal)) {
            parsedRanges[wId] = numVal;
          }
        }
        if (Object.keys(parsedRanges).length > 0) {
          setKpiTimeRangeByWidget(parsedRanges);
        }
      }

      const rawWidgetTitleOverrides = getUserSettingAtPath(
        settings,
        WIDGET_TITLE_OVERRIDES_SETTING_PATH,
      );
      if (
        rawWidgetTitleOverrides &&
        typeof rawWidgetTitleOverrides === "object" &&
        !Array.isArray(rawWidgetTitleOverrides)
      ) {
        const parsedWidgetTitleOverrides: Partial<Record<DashboardWidgetId, string>> = {};
        for (const widgetId of DASHBOARD_WIDGET_IDS) {
          const normalizedTitle = normalizeWidgetTitleOverride(
            (rawWidgetTitleOverrides as Record<string, unknown>)[widgetId],
          );
          if (normalizedTitle) {
            parsedWidgetTitleOverrides[widgetId] = normalizedTitle;
          }
        }
        setWidgetTitleOverrides(parsedWidgetTitleOverrides);
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
      path: SYSTEM_HISTORY_TIME_RANGE_SETTING_PATH.join("."),
      value: systemHistoryTimeRangeDays,
    });
  }, [supabase, systemHistoryTimeRangeDays]);

  useEffect(() => {
    if (!finderPreferencesHydratedRef.current) {
      return;
    }

    void patchCurrentUserSetting({
      supabase,
      path: RECENT_UPDATES_TIME_RANGE_SETTING_PATH.join("."),
      value: recentUpdatesTimeRangeDays,
    });
  }, [recentUpdatesTimeRangeDays, supabase]);

  useEffect(() => {
    if (!finderPreferencesHydratedRef.current) {
      return;
    }

    void patchCurrentUserSetting({
      supabase,
      path: KPI_WIDGET_TIME_RANGES_SETTING_PATH.join("."),
      value: kpiTimeRangeByWidget,
    });
  }, [supabase, kpiTimeRangeByWidget]);

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
    layoutUndoStackRef.current = layoutUndoStack;
  }, [layoutUndoStack]);

  useEffect(() => {
    layoutRedoStackRef.current = layoutRedoStack;
  }, [layoutRedoStack]);

  useEffect(() => {
    customizeOpenRef.current = customizeOpen;
    if (!customizeOpen) {
      if (dragAutoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(dragAutoScrollFrameRef.current);
        dragAutoScrollFrameRef.current = null;
      }
      dragPointerPositionRef.current = null;
      pointerDragStateRef.current = null;
      dragOverWidgetIdRef.current = null;
      setDraggedWidgetId(null);
      setDragOverWidgetId(null);
      setActiveKpiDrilldown(null);
      setEditingWidgetTitleId(null);
      setEditingWidgetTitleValue("");
      cancelWidgetTitleCommitRef.current = false;
    }
  }, [customizeOpen]);

  useEffect(() => {
    if (!editingWidgetTitleId) {
      return;
    }

    const input = widgetTitleInputRef.current;
    if (!input) {
      return;
    }

    input.focus();
    input.select();
  }, [editingWidgetTitleId]);

  useEffect(() => {
    return () => {
      if (dragAutoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(dragAutoScrollFrameRef.current);
        dragAutoScrollFrameRef.current = null;
      }
      dragPointerPositionRef.current = null;
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
            canUndoLayout: false,
            canRedoLayout: false,
            activeLayoutPresetId: null,
            layoutPresets: [],
            studioWidgets: [],
          },
        }),
      );
    };
  }, []);

  useEffect(() => {
    const previousUserId = previousUserIdRef.current;
    const userChanged = previousUserId !== currentUserId;
    previousUserIdRef.current = currentUserId;

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
    if (userChanged) {
      setLayoutUndoStack([]);
      setLayoutRedoStack([]);
    }

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

  const filteredFinderInstructionCards = useMemo(
    () =>
      filteredItems
        .flatMap((item) =>
          item.work_instructions.map((instruction) => ({
            workItem: item,
            instruction,
          })),
        )
        .sort(
          (a, b) =>
            toSortableTimestamp(b.instruction.updated_at) -
            toSortableTimestamp(a.instruction.updated_at),
        ),
    [filteredItems],
  );

  const filteredPinnedInstructions = useMemo(() => {
    if (selectedDepartmentId === "all") {
      return pinnedInstructions;
    }

    return pinnedInstructions.filter(
      (instruction) => instruction.workItem.department_id === selectedDepartmentId,
    );
  }, [pinnedInstructions, selectedDepartmentId]);

  const newestRangeStartTimestamp = useMemo(() => {
    const today = new Date();
    const todayStart = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    ).getTime();
    return todayStart - (newestTimeRangeDays - 1) * ONE_DAY_MS;
  }, [newestTimeRangeDays]);

  const newestDateRangeLabel = useMemo(() => {
    const today = new Date();
    const todayStart = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    ).getTime();
    return `${formatKpiLongDate(newestRangeStartTimestamp)} - ${formatKpiLongDate(todayStart)}`;
  }, [newestRangeStartTimestamp]);

  const filteredNewestInstructions = useMemo(() => {
    const departmentScoped =
      selectedDepartmentId === "all"
        ? newestInstructions
        : newestInstructions.filter(
            (instruction) => instruction.workItem.department_id === selectedDepartmentId,
          );

    return departmentScoped.filter(
      (instruction) => toSortableTimestamp(instruction.created_at) >= newestRangeStartTimestamp,
    );
  }, [newestInstructions, newestRangeStartTimestamp, selectedDepartmentId]);

  const shouldScrollNewest = filteredNewestInstructions.length > NEWEST_SCROLL_CARD_LIMIT;

  const recalculateNewestListMaxHeight = useCallback(() => {
    const listElement = newestListRef.current;
    if (!listElement || !shouldScrollNewest) {
      setNewestListMaxHeight(null);
      return;
    }

    const cards = Array.from(
      listElement.querySelectorAll<HTMLElement>("[data-newest-card='true']"),
    );
    const visibleCardCount = Math.min(cards.length, NEWEST_SCROLL_CARD_LIMIT);
    if (visibleCardCount === 0) {
      setNewestListMaxHeight(null);
      return;
    }

    let totalHeight = 0;
    for (let index = 0; index < visibleCardCount; index += 1) {
      totalHeight += cards[index].offsetHeight;
    }

    const styles = window.getComputedStyle(listElement);
    const parsedGap = Number.parseFloat(styles.rowGap || styles.gap || "0");
    if (Number.isFinite(parsedGap) && parsedGap > 0 && visibleCardCount > 1) {
      totalHeight += parsedGap * (visibleCardCount - 1);
    }

    const nextMaxHeight = Math.ceil(totalHeight);
    setNewestListMaxHeight((currentHeight) =>
      currentHeight === nextMaxHeight ? currentHeight : nextMaxHeight,
    );
  }, [shouldScrollNewest]);

  useEffect(() => {
    recalculateNewestListMaxHeight();
  }, [filteredNewestInstructions, recalculateNewestListMaxHeight]);

  useEffect(() => {
    const listElement = newestListRef.current;
    if (!listElement || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      recalculateNewestListMaxHeight();
    });
    observer.observe(listElement);
    return () => {
      observer.disconnect();
    };
  }, [filteredNewestInstructions.length, recalculateNewestListMaxHeight]);

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

  const systemHistoryCutoffTimestamp = useMemo(
    () => Date.now() - systemHistoryTimeRangeDays * ONE_DAY_MS,
    [systemHistoryTimeRangeDays],
  );

  const visibleSystemHistoryEvents = useMemo(
    () =>
      filteredSystemHistoryEvents.filter(
        (event) => toSortableTimestamp(event.occurred_at) >= systemHistoryCutoffTimestamp,
      ),
    [filteredSystemHistoryEvents, systemHistoryCutoffTimestamp],
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

  const shouldScrollSystemHistory =
    visibleSystemHistoryEvents.length > RECENT_UPDATES_SCROLL_CARD_LIMIT;

  const recalculateSystemHistoryListMaxHeight = useCallback(() => {
    const listElement = systemHistoryListRef.current;
    if (!listElement || !shouldScrollSystemHistory) {
      setSystemHistoryListMaxHeight(null);
      return;
    }

    const cards = Array.from(
      listElement.querySelectorAll<HTMLElement>("[data-system-history-card='true']"),
    );
    const visibleCardCount = Math.min(cards.length, RECENT_UPDATES_SCROLL_CARD_LIMIT);
    if (visibleCardCount === 0) {
      setSystemHistoryListMaxHeight(null);
      return;
    }

    let totalHeight = 0;
    for (let index = 0; index < visibleCardCount; index += 1) {
      totalHeight += cards[index].offsetHeight;
    }

    const styles = window.getComputedStyle(listElement);
    const parsedGap = Number.parseFloat(styles.rowGap || styles.gap || "0");
    if (Number.isFinite(parsedGap) && parsedGap > 0 && visibleCardCount > 1) {
      totalHeight += parsedGap * (visibleCardCount - 1);
    }

    const nextMaxHeight = Math.ceil(totalHeight);
    setSystemHistoryListMaxHeight((currentHeight) =>
      currentHeight === nextMaxHeight ? currentHeight : nextMaxHeight,
    );
  }, [shouldScrollSystemHistory]);

  useEffect(() => {
    recalculateSystemHistoryListMaxHeight();
  }, [recalculateSystemHistoryListMaxHeight, visibleSystemHistoryEvents]);

  useEffect(() => {
    const listElement = systemHistoryListRef.current;
    if (!listElement || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      recalculateSystemHistoryListMaxHeight();
    });
    observer.observe(listElement);
    return () => {
      observer.disconnect();
    };
  }, [recalculateSystemHistoryListMaxHeight, visibleSystemHistoryEvents.length]);

  const visibleWidgets = useMemo(
    () => widgetLayout.filter((widget) => widget.visible),
    [widgetLayout],
  );

  const sortedDepartmentActivity = useMemo(() => {
    return [...departmentInsights].sort((a, b) => b.instructionCount - a.instructionCount);
  }, [departmentInsights]);

  const recentUpdatesCutoffTimestamp = useMemo(
    () => Date.now() - recentUpdatesTimeRangeDays * ONE_DAY_MS,
    [recentUpdatesTimeRangeDays],
  );

  const recentUpdateEvents = useMemo(() => {
    return filteredSystemHistoryEvents
      .filter((event) => {
        if (event.event_type !== "updated") {
          return false;
        }

        return toSortableTimestamp(event.occurred_at) >= recentUpdatesCutoffTimestamp;
      })
      .slice(0, RECENT_UPDATES_EVENT_LIMIT);
  }, [filteredSystemHistoryEvents, recentUpdatesCutoffTimestamp]);

  const shouldScrollRecentUpdates = recentUpdateEvents.length > RECENT_UPDATES_SCROLL_CARD_LIMIT;

  const recalculateRecentUpdatesListMaxHeight = useCallback(() => {
    const listElement = recentUpdatesListRef.current;
    if (!listElement || !shouldScrollRecentUpdates) {
      setRecentUpdatesListMaxHeight(null);
      return;
    }

    const cards = Array.from(
      listElement.querySelectorAll<HTMLElement>("[data-recent-update-card='true']"),
    );
    const visibleCardCount = Math.min(cards.length, RECENT_UPDATES_SCROLL_CARD_LIMIT);
    if (visibleCardCount === 0) {
      setRecentUpdatesListMaxHeight(null);
      return;
    }

    let totalHeight = 0;
    for (let index = 0; index < visibleCardCount; index += 1) {
      totalHeight += cards[index].offsetHeight;
    }

    const styles = window.getComputedStyle(listElement);
    const parsedGap = Number.parseFloat(styles.rowGap || styles.gap || "0");
    if (Number.isFinite(parsedGap) && parsedGap > 0 && visibleCardCount > 1) {
      totalHeight += parsedGap * (visibleCardCount - 1);
    }

    const nextMaxHeight = Math.ceil(totalHeight);
    setRecentUpdatesListMaxHeight((currentHeight) =>
      currentHeight === nextMaxHeight ? currentHeight : nextMaxHeight,
    );
  }, [shouldScrollRecentUpdates]);

  useEffect(() => {
    recalculateRecentUpdatesListMaxHeight();
  }, [recalculateRecentUpdatesListMaxHeight, recentUpdateEvents]);

  useEffect(() => {
    const listElement = recentUpdatesListRef.current;
    if (!listElement || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      recalculateRecentUpdatesListMaxHeight();
    });
    observer.observe(listElement);
    return () => {
      observer.disconnect();
    };
  }, [recalculateRecentUpdatesListMaxHeight, recentUpdateEvents.length]);

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
        title: getWorkItemTitle(entry.workItem),
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
        title: getWorkItemTitle(entry.workItem),
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
        title: getWorkItemTitle(instruction.workItem),
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
        title: getWorkItemTitle(myLatestEntry.workItem),
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
        title: getWorkItemTitle(entry.workItem),
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

  const kpiMetricsByRange = useMemo(
    () => ({
      7: computeKpiMetricsForRange(
        7,
        filteredSystemHistoryEvents,
        kpiInstructionEntriesScoped,
        instructionReviewStatusByInstructionId,
        normalizedReviewWindowDays,
      ),
      30: computeKpiMetricsForRange(
        30,
        filteredSystemHistoryEvents,
        kpiInstructionEntriesScoped,
        instructionReviewStatusByInstructionId,
        normalizedReviewWindowDays,
      ),
      90: computeKpiMetricsForRange(
        90,
        filteredSystemHistoryEvents,
        kpiInstructionEntriesScoped,
        instructionReviewStatusByInstructionId,
        normalizedReviewWindowDays,
      ),
    }),
    [
      filteredSystemHistoryEvents,
      kpiInstructionEntriesScoped,
      instructionReviewStatusByInstructionId,
      normalizedReviewWindowDays,
    ],
  );

  const widgetDefinitionsById = useMemo(
    () => new Map(WIDGET_DEFINITIONS.map((widget) => [widget.id, widget])),
    [],
  );

  const beginWidgetTitleEdit = useCallback(
    (widgetId: DashboardWidgetId) => {
      if (!customizeOpen) {
        return;
      }

      const currentTitle =
        widgetTitleById.get(widgetId) ?? widgetDefinitionsById.get(widgetId)?.title ?? widgetId;
      cancelWidgetTitleCommitRef.current = false;
      setEditingWidgetTitleId(widgetId);
      setEditingWidgetTitleValue(currentTitle);
    },
    [customizeOpen, widgetDefinitionsById, widgetTitleById],
  );

  const cancelWidgetTitleEdit = useCallback(() => {
    cancelWidgetTitleCommitRef.current = false;
    setEditingWidgetTitleId(null);
    setEditingWidgetTitleValue("");
  }, []);

  const commitWidgetTitleEdit = useCallback(
    (widgetId: DashboardWidgetId) => {
      const defaultTitle = widgetDefinitionsById.get(widgetId)?.title ?? widgetId;
      const normalizedTitleOverride = normalizeWidgetTitleOverride(editingWidgetTitleValue);
      const shouldOverride = normalizedTitleOverride !== null && normalizedTitleOverride !== defaultTitle;

      setWidgetTitleOverrides((currentOverrides) => {
        const nextOverrides = { ...currentOverrides };
        if (shouldOverride && normalizedTitleOverride) {
          nextOverrides[widgetId] = normalizedTitleOverride;
        } else {
          delete nextOverrides[widgetId];
        }
        return nextOverrides;
      });

      setEditingWidgetTitleId(null);
      setEditingWidgetTitleValue("");

      void patchCurrentUserSetting({
        supabase,
        path: [...WIDGET_TITLE_OVERRIDES_SETTING_PATH, widgetId].join("."),
        value: shouldOverride ? normalizedTitleOverride : null,
      });
    },
    [editingWidgetTitleValue, supabase, widgetDefinitionsById],
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

    pushLayoutUndoSnapshot(widgetLayout);
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

    pushLayoutUndoSnapshot(widgetLayout);
    await persistDashboardLayout({
      layout: resetLayout,
      saveAsDefault: false,
      successNotice: "Dashboard reset. All widgets are visible. Saved default unchanged.",
    });
  }

  function pushLayoutSnapshot(
    updateStack: Dispatch<SetStateAction<DashboardWidgetLayoutItem[][]>>,
    layout: DashboardWidgetLayoutItem[],
  ) {
    const snapshot = cloneWidgetLayout(layout);
    updateStack((currentStack) => {
      const latestSnapshot = currentStack[currentStack.length - 1];
      if (latestSnapshot && areWidgetLayoutsEqual(latestSnapshot, snapshot)) {
        return currentStack;
      }

      if (currentStack.length >= MAX_LAYOUT_UNDO_STEPS) {
        return [...currentStack.slice(1), snapshot];
      }

      return [...currentStack, snapshot];
    });
  }

  function pushLayoutUndoSnapshot(
    layout: DashboardWidgetLayoutItem[],
    options?: { clearRedoStack?: boolean },
  ) {
    pushLayoutSnapshot(setLayoutUndoStack, layout);
    if (options?.clearRedoStack ?? true) {
      setLayoutRedoStack([]);
    }
  }

  function pushLayoutRedoSnapshot(layout: DashboardWidgetLayoutItem[]) {
    pushLayoutSnapshot(setLayoutRedoStack, layout);
  }

  function undoDashboardLayoutChange() {
    const latestSnapshot = layoutUndoStackRef.current[layoutUndoStackRef.current.length - 1];
    if (!latestSnapshot) {
      return;
    }

    const restoredLayout = cloneWidgetLayout(latestSnapshot);
    setWidgetLayout((currentLayout) => {
      if (areWidgetLayoutsEqual(currentLayout, restoredLayout)) {
        return currentLayout;
      }

      pushLayoutRedoSnapshot(currentLayout);
      setLayoutDirty(!areWidgetLayoutsEqual(restoredLayout, savedWidgetLayout));
      setLayoutError(null);
      setLayoutNotice("Reverted last dashboard layout change.");
      return restoredLayout;
    });
    setLayoutUndoStack((currentStack) => currentStack.slice(0, -1));
  }

  function redoDashboardLayoutChange() {
    const latestSnapshot = layoutRedoStackRef.current[layoutRedoStackRef.current.length - 1];
    if (!latestSnapshot) {
      return;
    }

    const restoredLayout = cloneWidgetLayout(latestSnapshot);
    setWidgetLayout((currentLayout) => {
      if (areWidgetLayoutsEqual(currentLayout, restoredLayout)) {
        return currentLayout;
      }

      pushLayoutUndoSnapshot(currentLayout, { clearRedoStack: false });
      setLayoutDirty(!areWidgetLayoutsEqual(restoredLayout, savedWidgetLayout));
      setLayoutError(null);
      setLayoutNotice("Reapplied last dashboard layout change.");
      return restoredLayout;
    });
    setLayoutRedoStack((currentStack) => currentStack.slice(0, -1));
  }

  function updateWidgetLayout(
    updater: (current: DashboardWidgetLayoutItem[]) => DashboardWidgetLayoutItem[],
  ) {
    setWidgetLayout((current) => {
      const next = updater(current);
      if (next === current || areWidgetLayoutsEqual(next, current)) {
        return current;
      }

      pushLayoutUndoSnapshot(current);
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

  function updateDragOverWidgetFromPointerPosition() {
    const pointerPosition = dragPointerPositionRef.current;
    if (!pointerPosition) {
      return;
    }

    const targetWidgetId = getWidgetIdAtPointerPosition(
      pointerPosition.clientX,
      pointerPosition.clientY,
    );
    if (!targetWidgetId || targetWidgetId === dragOverWidgetIdRef.current) {
      return;
    }

    setDragOverWidgetId(targetWidgetId);
  }

  function stopWidgetDragAutoScroll() {
    if (dragAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(dragAutoScrollFrameRef.current);
      dragAutoScrollFrameRef.current = null;
    }
    dragPointerPositionRef.current = null;
  }

  function stepWidgetDragAutoScroll() {
    const pointerDragState = pointerDragStateRef.current;
    const pointerPosition = dragPointerPositionRef.current;
    if (!pointerDragState || !pointerPosition) {
      stopWidgetDragAutoScroll();
      return;
    }

    const viewportHeight = window.innerHeight;
    let deltaY = 0;
    if (pointerPosition.clientY < DASHBOARD_WIDGET_DRAG_AUTOSCROLL_EDGE_THRESHOLD_PX) {
      const ratio =
        (DASHBOARD_WIDGET_DRAG_AUTOSCROLL_EDGE_THRESHOLD_PX - pointerPosition.clientY) /
        DASHBOARD_WIDGET_DRAG_AUTOSCROLL_EDGE_THRESHOLD_PX;
      deltaY = -Math.max(
        1,
        Math.round(ratio * DASHBOARD_WIDGET_DRAG_AUTOSCROLL_MAX_SPEED_PX_PER_FRAME),
      );
    } else if (
      pointerPosition.clientY >
      viewportHeight - DASHBOARD_WIDGET_DRAG_AUTOSCROLL_EDGE_THRESHOLD_PX
    ) {
      const ratio =
        (pointerPosition.clientY -
          (viewportHeight - DASHBOARD_WIDGET_DRAG_AUTOSCROLL_EDGE_THRESHOLD_PX)) /
        DASHBOARD_WIDGET_DRAG_AUTOSCROLL_EDGE_THRESHOLD_PX;
      deltaY = Math.max(
        1,
        Math.round(ratio * DASHBOARD_WIDGET_DRAG_AUTOSCROLL_MAX_SPEED_PX_PER_FRAME),
      );
    }

    if (deltaY !== 0) {
      window.scrollBy({
        top: deltaY,
        left: 0,
        behavior: "auto",
      });
      updateDragOverWidgetFromPointerPosition();
    }

    dragAutoScrollFrameRef.current = window.requestAnimationFrame(stepWidgetDragAutoScroll);
  }

  function startWidgetDragAutoScroll() {
    if (dragAutoScrollFrameRef.current !== null) {
      return;
    }

    dragAutoScrollFrameRef.current = window.requestAnimationFrame(stepWidgetDragAutoScroll);
  }

  function clearWidgetPointerDragState() {
    stopWidgetDragAutoScroll();
    pointerDragStateRef.current = null;
    dragOverWidgetIdRef.current = null;
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
    dragPointerPositionRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
    };
    setDraggedWidgetId(widgetId);
    setDragOverWidgetId(widgetId);
    dragOverWidgetIdRef.current = widgetId;
    startWidgetDragAutoScroll();
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleWidgetGripPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const pointerDragState = pointerDragStateRef.current;
    if (!pointerDragState || pointerDragState.pointerId !== event.pointerId) {
      return;
    }

    dragPointerPositionRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
    };
    updateDragOverWidgetFromPointerPosition();
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

    updateWidgetLayout(() => preset.layout.map((entry) => ({ ...entry })));
  }

  function discardDashboardLayoutChanges() {
    if (areWidgetLayoutsEqual(widgetLayout, savedWidgetLayout)) {
      setLayoutError(null);
      return;
    }

    pushLayoutUndoSnapshot(widgetLayout);
    setWidgetLayout(cloneWidgetLayout(savedWidgetLayout));
    setLayoutDirty(false);
    setLayoutError(null);
  }

  saveLayoutActionRef.current = saveDashboardLayout;
  saveLayoutAsDefaultActionRef.current = saveDashboardLayoutAsDefault;
  loadDefaultLayoutActionRef.current = loadDefaultDashboardLayout;
  resetDefaultsActionRef.current = resetDashboardLayout;
  discardLayoutActionRef.current = discardDashboardLayoutChanges;
  undoLayoutActionRef.current = undoDashboardLayoutChange;
  redoLayoutActionRef.current = redoDashboardLayoutChange;
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

      if (detail.command === "undo-layout-change") {
        if (layoutSavingRef.current || layoutUndoStackRef.current.length === 0) {
          return;
        }
        undoLayoutActionRef.current?.();
        return;
      }

      if (detail.command === "redo-layout-change") {
        if (layoutSavingRef.current || layoutRedoStackRef.current.length === 0) {
          return;
        }
        redoLayoutActionRef.current?.();
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
    inlineCompactControls = false,
  ) {
    if (widgetId === "finder") {
      const departmentToggleLabel = departmentInsightExpanded
        ? "Hide Departments"
        : "Show Departments";

      return (
        <div
          className={cn(
            "items-center",
            widgetSize === "compact" && !inlineCompactControls
              ? "flex w-full justify-end"
              : "flex justify-end",
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

    if (widgetId === "recent_updates") {
      return (
        <label className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
          <span>Window</span>
          <select
            value={recentUpdatesTimeRangeDays}
            onChange={(event) => {
              const nextRange = Number.parseInt(event.target.value, 10);
              if (isRecentUpdatesTimeRangeDays(nextRange)) {
                setRecentUpdatesTimeRangeDays(nextRange);
              }
            }}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
          >
            {RECENT_UPDATES_TIME_RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                Last {option.label}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (widgetId === "system_history") {
      return (
        <label className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
          <span>Window</span>
          <select
            value={systemHistoryTimeRangeDays}
            onChange={(event) => {
              const nextRange = Number.parseInt(event.target.value, 10);
              if (isRecentUpdatesTimeRangeDays(nextRange)) {
                setSystemHistoryTimeRangeDays(nextRange);
              }
            }}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
          >
            {RECENT_UPDATES_TIME_RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                Last {option.label}
              </option>
            ))}
          </select>
        </label>
      );
    }

    return null;
  }

  function renderWidgetContent(
    widgetId: DashboardWidgetId,
    widgetSize: DashboardWidgetSize,
  ) {
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
                {filteredFinderInstructionCards.length} matching instruction
                {filteredFinderInstructionCards.length === 1 ? "" : "s"} across{" "}
                {filteredItems.length} work item{filteredItems.length === 1 ? "" : "s"} for{" "}
                &quot;{query.trim()}&quot; in {selectedDepartmentName}.
              </p>

              {filteredFinderInstructionCards.length === 0 ? (
                <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                  No work instructions found.
                </p>
              ) : (
                <div className="grid gap-2">
                  {filteredFinderInstructionCards.map((entry) => (
                    <Link
                      key={entry.instruction.id}
                      href={`/instructions/${entry.instruction.id}`}
                      onClick={persistInstructionReturnState}
                      style={{
                        borderColor: colorWithAlpha(entry.workItem.department_color, 0.45),
                        backgroundColor: colorWithAlpha(entry.workItem.department_color, 0.14),
                        boxShadow: `inset 4px 0 0 ${colorWithAlpha(
                          entry.workItem.department_color,
                          0.85,
                        )}`,
                      }}
                      className="rounded-xl border px-3 py-2.5 transition hover:brightness-105"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <PartDepartmentHeading workItem={entry.workItem} />
                        <span className="inline-flex items-center rounded-full border border-slate-400/45 bg-slate-900/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-500/55 dark:bg-slate-100/10 dark:text-slate-200">
                          Rev {entry.instruction.revision}
                        </span>
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
                          <span
                            title={getNeedsReviewPillTooltip(
                              instructionReviewStatusByInstructionId[entry.instruction.id],
                            )}
                            className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/45 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
                          >
                            <TriangleAlert size={10} />
                            Needs Review
                          </span>
                        )}
                      </div>

                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                        {entry.workItem.item_title}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Updated <LocalDateTime value={entry.instruction.updated_at} mode="date" />{" "}
                        by {entry.instruction.updater_name}
                      </p>
                    </Link>
                  ))}
                </div>
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
                  <span
                    title={getNeedsReviewPillTooltip(
                      instructionReviewStatusByInstructionId[instruction.id],
                    )}
                    className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/45 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
                  >
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
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Created Date Range
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{newestDateRangeLabel}</p>
            </div>
            <KpiTimeRangePicker
              value={newestTimeRangeDays}
              onChange={setNewestTimeRangeDays}
            />
          </div>
          <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
            No instructions created in the last {newestTimeRangeDays} days for{" "}
            {selectedDepartmentName}.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Created Date Range
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{newestDateRangeLabel}</p>
            </div>
            <KpiTimeRangePicker
              value={newestTimeRangeDays}
              onChange={setNewestTimeRangeDays}
            />
          </div>
          <div
            ref={newestListRef}
            className={cn("grid gap-2", shouldScrollNewest ? "overflow-y-auto pr-1" : "")}
            style={
              shouldScrollNewest && newestListMaxHeight !== null
                ? { maxHeight: `${newestListMaxHeight}px` }
                : undefined
            }
          >
            {filteredNewestInstructions.map((instruction) => (
              <Link
                key={instruction.id}
                data-newest-card="true"
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
                    <span
                      title={getNeedsReviewPillTooltip(
                        instructionReviewStatusByInstructionId[instruction.id],
                      )}
                      className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/45 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
                    >
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
                    title={
                      entry.isFlagged
                        ? getNeedsReviewPillTooltip(entry.reviewStatus)
                        : undefined
                    }
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
          No instruction updates in the last {recentUpdatesTimeRangeDays} days for{" "}
          {selectedDepartmentName}.
        </p>
      ) : (
        <div
          ref={recentUpdatesListRef}
          className={cn("grid gap-2", shouldScrollRecentUpdates ? "overflow-y-auto pr-1" : "")}
          style={
            shouldScrollRecentUpdates && recentUpdatesListMaxHeight !== null
              ? { maxHeight: `${recentUpdatesListMaxHeight}px` }
              : undefined
          }
        >
          {recentUpdateEvents.map((event) => (
            <article
              key={event.id}
              data-recent-update-card="true"
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
              {visibleSystemHistoryEvents.length} event
              {visibleSystemHistoryEvents.length === 1 ? "" : "s"} in the last{" "}
              {systemHistoryTimeRangeDays} days
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
              No system activity in the last {systemHistoryTimeRangeDays} days for{" "}
              {selectedDepartmentName}.
            </p>
          ) : (
            <div
              ref={systemHistoryListRef}
              className={cn("grid w-full gap-2", shouldScrollSystemHistory ? "overflow-y-auto pr-1" : "")}
              style={
                shouldScrollSystemHistory && systemHistoryListMaxHeight !== null
                  ? { maxHeight: `${systemHistoryListMaxHeight}px` }
                  : undefined
              }
            >
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
                    data-system-history-card="true"
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
      const kpiData = kpiMetricsByRange[getKpiWidgetTimeRange(widgetId)];
      const totalEvents = kpiData.throughputMetric.points.reduce(
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
              <p className="text-xs text-slate-500 dark:text-slate-400">{kpiData.dateRangeLabel}</p>
            </div>
            <KpiTimeRangePicker
              value={getKpiWidgetTimeRange(widgetId)}
              onChange={(days) => setKpiWidgetTimeRange(widgetId, days)}
            />
          </div>
          <div className="rounded-xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/60">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {totalEvents} event{totalEvents === 1 ? "" : "s"} captured in the selected range.
            </p>
          </div>
          <KpiLineChart
            points={kpiData.throughputMetric.points}
            yAxisLabel="Events"
            widgetSize={widgetSize}
            lineColor="#06B6D4"
            onSelectPoint={(point) => {
              setActiveKpiDrilldown({
                title: "Throughput Trend Drill Down",
                subtitle: `${point.fullLabel} | ${selectedDepartmentName}`,
                yAxisLabel: "Events",
                rows: kpiData.throughputMetric.rowsByPointId.get(point.id) ?? [],
              });
            }}
          />
        </div>
      );
    }

    if (widgetId === "kpi_creation_velocity") {
      const kpiData = kpiMetricsByRange[getKpiWidgetTimeRange(widgetId)];
      const totalCreated = kpiData.creationVelocityMetric.points.reduce(
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
              <p className="text-xs text-slate-500 dark:text-slate-400">{kpiData.dateRangeLabel}</p>
            </div>
            <KpiTimeRangePicker
              value={getKpiWidgetTimeRange(widgetId)}
              onChange={(days) => setKpiWidgetTimeRange(widgetId, days)}
            />
          </div>
          <div className="rounded-xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/60">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {totalCreated} instruction{totalCreated === 1 ? "" : "s"} created in this window.
            </p>
          </div>
          <KpiLineChart
            points={kpiData.creationVelocityMetric.points}
            yAxisLabel="Created"
            widgetSize={widgetSize}
            lineColor="#3B82F6"
            showArea
            onSelectPoint={(point) => {
              setActiveKpiDrilldown({
                title: "Creation Velocity Drill Down",
                subtitle: `${point.fullLabel} | ${selectedDepartmentName}`,
                yAxisLabel: "Created",
                rows: kpiData.creationVelocityMetric.rowsByPointId.get(point.id) ?? [],
              });
            }}
          />
        </div>
      );
    }

    if (widgetId === "kpi_department_workload") {
      const kpiData = kpiMetricsByRange[getKpiWidgetTimeRange(widgetId)];
      const totalEvents = kpiData.departmentWorkloadMetric.bars.reduce(
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
              <p className="text-xs text-slate-500 dark:text-slate-400">{kpiData.dateRangeLabel}</p>
            </div>
            <KpiTimeRangePicker
              value={getKpiWidgetTimeRange(widgetId)}
              onChange={(days) => setKpiWidgetTimeRange(widgetId, days)}
            />
          </div>
          <div className="rounded-xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/60">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Top department load across {totalEvents} event
              {totalEvents === 1 ? "" : "s"}.
            </p>
          </div>
          {kpiData.departmentWorkloadMetric.bars.length === 0 ? (
            <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              No department event load data is available for this range.
            </p>
          ) : (
            <KpiBarChart
              bars={kpiData.departmentWorkloadMetric.bars}
              yAxisLabel="Events"
              widgetSize={widgetSize}
              onSelectBar={(bar) => {
                setActiveKpiDrilldown({
                  title: "Department Workload Drill Down",
                  subtitle: `${bar.label} | ${kpiData.dateRangeLabel}`,
                  yAxisLabel: "Events",
                  rows: kpiData.departmentWorkloadMetric.rowsByBarId.get(bar.id) ?? [],
                });
              }}
            />
          )}
        </div>
      );
    }

    if (widgetId === "kpi_review_health") {
      const kpiData = kpiMetricsByRange[getKpiWidgetTimeRange(widgetId)];
      return (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Time Series Filter
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{kpiData.dateRangeLabel}</p>
            </div>
            <KpiTimeRangePicker
              value={getKpiWidgetTimeRange(widgetId)}
              onChange={(days) => setKpiWidgetTimeRange(widgetId, days)}
            />
          </div>
          <KpiStackedBarChart
            points={kpiData.reviewHealthMetric.points}
            yAxisLabel="Instruction Updates"
            widgetSize={widgetSize}
            onSelectPoint={(point) => {
              setActiveKpiDrilldown({
                title: "Review Health Drill Down",
                subtitle: `${point.fullLabel} | ${selectedDepartmentName}`,
                yAxisLabel: "Instructions",
                rows: kpiData.reviewHealthMetric.rowsByPointId.get(point.id) ?? [],
              });
            }}
          />
        </div>
      );
    }

    if (widgetId === "kpi_revision_cycle_time") {
      const kpiData = kpiMetricsByRange[getKpiWidgetTimeRange(widgetId)];
      return (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Time Series Filter
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{kpiData.dateRangeLabel}</p>
            </div>
            <KpiTimeRangePicker
              value={getKpiWidgetTimeRange(widgetId)}
              onChange={(days) => setKpiWidgetTimeRange(widgetId, days)}
            />
          </div>
          {kpiData.revisionCycleMetric.points.length === 0 ? (
            <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              No revision cycle points are available for this time window.
            </p>
          ) : (
            <KpiScatterChart
              points={kpiData.revisionCycleMetric.points}
              xAxisLabel="days since update"
              yAxisLabel="Revision"
              widgetSize={widgetSize}
              onSelectPoint={(point) => {
                setActiveKpiDrilldown({
                  title: "Revision Cycle Time Drill Down",
                  subtitle: point.label,
                  yAxisLabel: "Revision",
                  rows: kpiData.revisionCycleMetric.rowsByPointId.get(point.id) ?? [],
                });
              }}
            />
          )}
        </div>
      );
    }

    if (widgetId === "kpi_event_mix") {
      const kpiData = kpiMetricsByRange[getKpiWidgetTimeRange(widgetId)];
      return (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Time Series Filter
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{kpiData.dateRangeLabel}</p>
            </div>
            <KpiTimeRangePicker
              value={getKpiWidgetTimeRange(widgetId)}
              onChange={(days) => setKpiWidgetTimeRange(widgetId, days)}
            />
          </div>
          {kpiData.eventMixMetric.segments.length === 0 ? (
            <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              No event mix data is available for this time range.
            </p>
          ) : (
            <KpiDonutChart
              segments={kpiData.eventMixMetric.segments}
              widgetSize={widgetSize}
              onSelectSegment={(segment) => {
                setActiveKpiDrilldown({
                  title: "Event Mix Drill Down",
                  subtitle: `${segment.label} | ${kpiData.dateRangeLabel}`,
                  yAxisLabel: "Events",
                  rows: kpiData.eventMixMetric.rowsBySegmentId.get(segment.id) ?? [],
                });
              }}
            />
          )}
        </div>
      );
    }

    if (widgetId === "kpi_review_origin_mix") {
      const kpiData = kpiMetricsByRange[getKpiWidgetTimeRange(widgetId)];
      return (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Time Series Filter
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{kpiData.dateRangeLabel}</p>
            </div>
            <KpiTimeRangePicker
              value={getKpiWidgetTimeRange(widgetId)}
              onChange={(days) => setKpiWidgetTimeRange(widgetId, days)}
            />
          </div>
          {kpiData.reviewOriginMixMetric.segments.length === 0 ? (
            <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              No review-origin events are available for this time range.
            </p>
          ) : (
            <KpiDonutChart
              segments={kpiData.reviewOriginMixMetric.segments}
              widgetSize={widgetSize}
              onSelectSegment={(segment) => {
                setActiveKpiDrilldown({
                  title: "Review Origin Mix Drill Down",
                  subtitle: `${segment.label} | ${kpiData.dateRangeLabel}`,
                  yAxisLabel: "Events",
                  rows: kpiData.reviewOriginMixMetric.rowsBySegmentId.get(segment.id) ?? [],
                });
              }}
            />
          )}
        </div>
      );
    }

    if (widgetId === "kpi_department_event_share") {
      const kpiData = kpiMetricsByRange[getKpiWidgetTimeRange(widgetId)];
      return (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Time Series Filter
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{kpiData.dateRangeLabel}</p>
            </div>
            <KpiTimeRangePicker
              value={getKpiWidgetTimeRange(widgetId)}
              onChange={(days) => setKpiWidgetTimeRange(widgetId, days)}
            />
          </div>
          {kpiData.departmentEventShareMetric.segments.length === 0 ? (
            <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              No department event-share data is available for this range.
            </p>
          ) : (
            <KpiDonutChart
              segments={kpiData.departmentEventShareMetric.segments}
              widgetSize={widgetSize}
              onSelectSegment={(segment) => {
                setActiveKpiDrilldown({
                  title: "Department Event Share Drill Down",
                  subtitle: `${segment.label} | ${kpiData.dateRangeLabel}`,
                  yAxisLabel: "Events",
                  rows: kpiData.departmentEventShareMetric.rowsBySegmentId.get(segment.id) ?? [],
                });
              }}
            />
          )}
        </div>
      );
    }

    if (widgetId === "kpi_actor_activity_mix") {
      const kpiData = kpiMetricsByRange[getKpiWidgetTimeRange(widgetId)];
      return (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Time Series Filter
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{kpiData.dateRangeLabel}</p>
            </div>
            <KpiTimeRangePicker
              value={getKpiWidgetTimeRange(widgetId)}
              onChange={(days) => setKpiWidgetTimeRange(widgetId, days)}
            />
          </div>
          {kpiData.actorActivityMixMetric.segments.length === 0 ? (
            <p className="rounded-xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              No actor activity data is available for this range.
            </p>
          ) : (
            <KpiDonutChart
              segments={kpiData.actorActivityMixMetric.segments}
              widgetSize={widgetSize}
              onSelectSegment={(segment) => {
                setActiveKpiDrilldown({
                  title: "Actor Activity Mix Drill Down",
                  subtitle: `${segment.label} | ${kpiData.dateRangeLabel}`,
                  yAxisLabel: "Events",
                  rows: kpiData.actorActivityMixMetric.rowsBySegmentId.get(segment.id) ?? [],
                });
              }}
            />
          )}
        </div>
      );
    }

    const isMyImpactCompact = widgetSize === "compact";

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
                    <span
                      title={getNeedsReviewPillTooltip(
                        instructionReviewStatusByInstructionId[entry.instruction.id],
                      )}
                      className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/45 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
                    >
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
            const widgetDisplayTitle =
              widgetTitleById.get(widget.id) ?? definition.title;
            const isEditingWidgetTitle = editingWidgetTitleId === widget.id;
            const isDragging = draggedWidgetId === widget.id;
            const isDragOverTarget =
              dragOverWidgetId === widget.id && draggedWidgetId !== widget.id;
            const useInlineCompactHeaderControls =
              widget.id === "finder" && widget.size === "compact" && !customizeOpen;
            const widgetHeaderControls = renderWidgetHeaderControls(
              widget.id,
              widget.size,
              useInlineCompactHeaderControls,
            );
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
                    aria-label={`Remove ${widgetDisplayTitle} widget`}
                    className="absolute right-4 top-4 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-rose-500/40 bg-rose-500/10 text-rose-700 transition hover:bg-rose-500/20 dark:text-rose-200"
                  >
                    <X size={12} />
                  </button>
                ) : null}

                <div
                  className={cn(
                    widget.size === "compact"
                      ? useInlineCompactHeaderControls
                        ? "mb-2 flex items-start justify-between gap-2"
                        : "mb-2 flex flex-col items-start gap-2"
                      : "mb-3 flex flex-col gap-2.5 md:flex-row md:items-start md:justify-between",
                    customizeOpen ? "pr-10" : "",
                  )}
                >
                  <div
                    className={cn(
                      "flex min-w-0 items-start gap-2",
                      useInlineCompactHeaderControls ? "flex-1" : "",
                    )}
                  >
                    {customizeOpen ? (
                      <button
                        type="button"
                        aria-label={`Drag to reorder ${widgetDisplayTitle}`}
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
                      {isEditingWidgetTitle ? (
                        <input
                          ref={widgetTitleInputRef}
                          value={editingWidgetTitleValue}
                          maxLength={MAX_WIDGET_TITLE_LENGTH}
                          onChange={(event) => setEditingWidgetTitleValue(event.target.value)}
                          onBlur={() => {
                            if (cancelWidgetTitleCommitRef.current) {
                              cancelWidgetTitleEdit();
                              return;
                            }
                            commitWidgetTitleEdit(widget.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              cancelWidgetTitleCommitRef.current = true;
                              event.currentTarget.blur();
                              return;
                            }

                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }
                          }}
                          className={cn(
                            "w-full rounded-lg border border-cyan-500/45 bg-cyan-500/10 px-2.5 py-1 font-extrabold tracking-tight text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/55 dark:text-slate-100",
                            widget.size === "compact" ? "text-base" : "text-xl",
                          )}
                          aria-label={`Rename ${widgetDisplayTitle} widget`}
                        />
                      ) : (
                        <h2
                          onDoubleClick={() => beginWidgetTitleEdit(widget.id)}
                          title={customizeOpen ? "Double-click to rename widget" : undefined}
                          className={cn(
                            "break-words font-extrabold tracking-tight text-slate-900 dark:text-slate-100",
                            widget.size === "compact" ? "text-base" : "text-xl",
                            customizeOpen ? "cursor-text" : "",
                          )}
                        >
                          {widgetDisplayTitle}
                        </h2>
                      )}
                    </div>
                  </div>

                  <div
                    className={cn(
                      "flex flex-wrap items-center",
                      widget.size === "compact"
                        ? useInlineCompactHeaderControls
                          ? "shrink-0 justify-end gap-2"
                          : "w-full gap-2"
                        : "gap-2",
                    )}
                  >
                    {widgetHeaderControls}
                    {sizeControl}
                  </div>
                </div>

                {renderWidgetContent(widget.id, widget.size)}
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
                  <div className="grid gap-2">
                    <div className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-3 py-2">
                      <p className="text-sm font-semibold text-cyan-100">
                        Total Events: {formatKpiNumber(activeKpiDrilldownTotalEvents)}
                      </p>
                    </div>

                    <div className="grid max-h-[55vh] gap-2 overflow-y-auto pr-1">
                      {activeKpiDrilldown.rows.map((row) =>
                        row.href ? (
                          <Link
                            key={row.id}
                            href={row.href}
                            onClick={() => setActiveKpiDrilldown(null)}
                            className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 p-3 transition hover:bg-cyan-500/20"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-slate-100">{row.label}</p>
                            </div>
                            <p className="text-sm font-semibold text-slate-100">{row.title}</p>
                            <p className="text-xs text-slate-300">{row.detail}</p>
                          </Link>
                        ) : (
                          <article
                            key={row.id}
                            className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-slate-100">{row.label}</p>
                            </div>
                            <p className="text-sm font-semibold text-slate-100">{row.title}</p>
                            <p className="text-xs text-slate-300">{row.detail}</p>
                          </article>
                        ),
                      )}
                    </div>
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
                        <p className="text-sm font-semibold text-slate-100">{entry.title}</p>
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
                        <p className="text-sm font-semibold text-slate-100">{entry.title}</p>
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

