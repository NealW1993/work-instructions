export type DashboardWidgetId =
  | "finder"
  | "pinned"
  | "newest"
  | "department_activity"
  | "review_queue"
  | "recent_updates"
  | "my_impact"
  | "system_history"
  | "kpi_throughput"
  | "kpi_creation_velocity"
  | "kpi_department_workload"
  | "kpi_review_health"
  | "kpi_revision_cycle_time"
  | "kpi_event_mix";

export type DashboardWidgetSize = "compact" | "standard" | "wide" | "full";

export interface DashboardWidgetLayoutItem {
  id: DashboardWidgetId;
  visible: boolean;
  size: DashboardWidgetSize;
}

export interface DashboardLayoutPreset {
  id: string;
  label: string;
  layout: DashboardWidgetLayoutItem[];
}

export const DASHBOARD_WIDGET_IDS: DashboardWidgetId[] = [
  "finder",
  "pinned",
  "newest",
  "department_activity",
  "review_queue",
  "recent_updates",
  "my_impact",
  "system_history",
  "kpi_throughput",
  "kpi_creation_velocity",
  "kpi_department_workload",
  "kpi_review_health",
  "kpi_revision_cycle_time",
  "kpi_event_mix",
];

export const DASHBOARD_WIDGET_SIZES: DashboardWidgetSize[] = [
  "compact",
  "standard",
  "wide",
  "full",
];

export const DEFAULT_DASHBOARD_LAYOUT_PRESET_ID = "balanced";

export const DASHBOARD_LAYOUT_PRESETS: DashboardLayoutPreset[] = [
  {
    id: "balanced",
    label: "Balanced",
    layout: [
      { id: "finder", visible: true, size: "full" },
      { id: "my_impact", visible: true, size: "compact" },
      { id: "newest", visible: true, size: "standard" },
      { id: "pinned", visible: true, size: "standard" },
      { id: "department_activity", visible: true, size: "standard" },
      { id: "review_queue", visible: true, size: "standard" },
      { id: "recent_updates", visible: true, size: "wide" },
      { id: "system_history", visible: true, size: "full" },
      { id: "kpi_throughput", visible: false, size: "wide" },
      { id: "kpi_creation_velocity", visible: false, size: "wide" },
      { id: "kpi_department_workload", visible: false, size: "standard" },
      { id: "kpi_review_health", visible: false, size: "wide" },
      { id: "kpi_revision_cycle_time", visible: false, size: "wide" },
      { id: "kpi_event_mix", visible: false, size: "standard" },
    ],
  },
  {
    id: "operations_live",
    label: "Operations Live",
    layout: [
      { id: "system_history", visible: true, size: "full" },
      { id: "recent_updates", visible: true, size: "full" },
      { id: "finder", visible: true, size: "wide" },
      { id: "department_activity", visible: true, size: "standard" },
      { id: "newest", visible: true, size: "standard" },
      { id: "review_queue", visible: true, size: "compact" },
      { id: "pinned", visible: true, size: "compact" },
      { id: "my_impact", visible: true, size: "compact" },
      { id: "kpi_throughput", visible: false, size: "wide" },
      { id: "kpi_creation_velocity", visible: false, size: "wide" },
      { id: "kpi_department_workload", visible: false, size: "standard" },
      { id: "kpi_review_health", visible: false, size: "wide" },
      { id: "kpi_revision_cycle_time", visible: false, size: "wide" },
      { id: "kpi_event_mix", visible: false, size: "standard" },
    ],
  },
  {
    id: "supervisor",
    label: "Supervisor",
    layout: [
      { id: "finder", visible: true, size: "full" },
      { id: "department_activity", visible: true, size: "wide" },
      { id: "recent_updates", visible: true, size: "wide" },
      { id: "system_history", visible: true, size: "wide" },
      { id: "review_queue", visible: true, size: "standard" },
      { id: "newest", visible: true, size: "standard" },
      { id: "pinned", visible: true, size: "standard" },
      { id: "my_impact", visible: true, size: "compact" },
      { id: "kpi_throughput", visible: false, size: "wide" },
      { id: "kpi_creation_velocity", visible: false, size: "wide" },
      { id: "kpi_department_workload", visible: false, size: "standard" },
      { id: "kpi_review_health", visible: false, size: "wide" },
      { id: "kpi_revision_cycle_time", visible: false, size: "wide" },
      { id: "kpi_event_mix", visible: false, size: "standard" },
    ],
  },
  {
    id: "personal_focus",
    label: "Personal Focus",
    layout: [
      { id: "my_impact", visible: true, size: "standard" },
      { id: "pinned", visible: true, size: "wide" },
      { id: "newest", visible: true, size: "standard" },
      { id: "finder", visible: true, size: "full" },
      { id: "recent_updates", visible: true, size: "standard" },
      { id: "review_queue", visible: true, size: "compact" },
      { id: "system_history", visible: true, size: "wide" },
      { id: "department_activity", visible: true, size: "compact" },
      { id: "kpi_throughput", visible: false, size: "wide" },
      { id: "kpi_creation_velocity", visible: false, size: "wide" },
      { id: "kpi_department_workload", visible: false, size: "standard" },
      { id: "kpi_review_health", visible: false, size: "wide" },
      { id: "kpi_revision_cycle_time", visible: false, size: "wide" },
      { id: "kpi_event_mix", visible: false, size: "standard" },
    ],
  },
  {
    id: "compact_grid",
    label: "Compact Grid",
    layout: [
      { id: "finder", visible: true, size: "compact" },
      { id: "newest", visible: true, size: "compact" },
      { id: "pinned", visible: true, size: "compact" },
      { id: "my_impact", visible: true, size: "standard" },
      { id: "department_activity", visible: true, size: "standard" },
      { id: "recent_updates", visible: true, size: "wide" },
      { id: "review_queue", visible: true, size: "compact" },
      { id: "system_history", visible: true, size: "full" },
      { id: "kpi_throughput", visible: false, size: "wide" },
      { id: "kpi_creation_velocity", visible: false, size: "wide" },
      { id: "kpi_department_workload", visible: false, size: "standard" },
      { id: "kpi_review_health", visible: false, size: "wide" },
      { id: "kpi_revision_cycle_time", visible: false, size: "wide" },
      { id: "kpi_event_mix", visible: false, size: "standard" },
    ],
  },
  {
    id: "audit_review",
    label: "Audit Review",
    layout: [
      { id: "system_history", visible: true, size: "full" },
      { id: "recent_updates", visible: true, size: "full" },
      { id: "department_activity", visible: true, size: "standard" },
      { id: "newest", visible: true, size: "standard" },
      { id: "review_queue", visible: true, size: "compact" },
      { id: "finder", visible: true, size: "wide" },
      { id: "pinned", visible: true, size: "standard" },
      { id: "my_impact", visible: true, size: "compact" },
      { id: "kpi_throughput", visible: false, size: "wide" },
      { id: "kpi_creation_velocity", visible: false, size: "wide" },
      { id: "kpi_department_workload", visible: false, size: "standard" },
      { id: "kpi_review_health", visible: false, size: "wide" },
      { id: "kpi_revision_cycle_time", visible: false, size: "wide" },
      { id: "kpi_event_mix", visible: false, size: "standard" },
    ],
  },
];

function cloneLayout(layout: DashboardWidgetLayoutItem[]) {
  return layout.map((entry) => ({ ...entry }));
}

export function isDashboardWidgetId(value: string): value is DashboardWidgetId {
  return DASHBOARD_WIDGET_IDS.includes(value as DashboardWidgetId);
}

export function isDashboardWidgetSize(value: string): value is DashboardWidgetSize {
  return DASHBOARD_WIDGET_SIZES.includes(value as DashboardWidgetSize);
}

export function parseDashboardLayout(value: unknown): DashboardWidgetLayoutItem[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const parsed: DashboardWidgetLayoutItem[] = [];
  const seenIds = new Set<DashboardWidgetId>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const visible = typeof candidate.visible === "boolean" ? candidate.visible : null;
    const size = typeof candidate.size === "string" ? candidate.size.trim() : "";

    if (!isDashboardWidgetId(id) || seenIds.has(id) || visible === null || !isDashboardWidgetSize(size)) {
      return null;
    }

    parsed.push({
      id,
      visible,
      size,
    });
    seenIds.add(id);
  }

  return parsed;
}

function fillMissingWidgets(layout: DashboardWidgetLayoutItem[]) {
  const seen = new Set(layout.map((entry) => entry.id));
  const fallbackOrder = getDefaultDashboardLayout();
  const missing = fallbackOrder.filter((entry) => !seen.has(entry.id));
  return [...layout.map((entry) => ({ ...entry })), ...missing];
}

export function isSameDashboardLayout(
  left: DashboardWidgetLayoutItem[],
  right: DashboardWidgetLayoutItem[],
) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftEntry = left[index];
    const rightEntry = right[index];
    if (
      !leftEntry ||
      !rightEntry ||
      leftEntry.id !== rightEntry.id ||
      leftEntry.visible !== rightEntry.visible ||
      leftEntry.size !== rightEntry.size
    ) {
      return false;
    }
  }

  return true;
}

export function findMatchingDashboardLayoutPreset(layout: DashboardWidgetLayoutItem[]) {
  const completedLayout = fillMissingWidgets(layout);
  return (
    DASHBOARD_LAYOUT_PRESETS.find((preset) =>
      isSameDashboardLayout(completedLayout, preset.layout),
    ) ?? null
  );
}

export function getDefaultDashboardLayout() {
  const fallbackPreset =
    DASHBOARD_LAYOUT_PRESETS.find(
      (preset) => preset.id === DEFAULT_DASHBOARD_LAYOUT_PRESET_ID,
    ) ?? DASHBOARD_LAYOUT_PRESETS[0];

  return cloneLayout(fallbackPreset?.layout ?? []);
}

export function normalizeDashboardLayout(value: unknown) {
  const parsed = parseDashboardLayout(value);
  if (!parsed) {
    return getDefaultDashboardLayout();
  }

  return fillMissingWidgets(parsed);
}
