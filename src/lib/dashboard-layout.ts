export type DashboardWidgetId =
  | "finder"
  | "pinned"
  | "newest"
  | "department_activity"
  | "review_queue"
  | "formula_snapshot"
  | "formula_review_queue"
  | "formula_library"
  | "recent_updates"
  | "my_impact"
  | "system_history"
  | "kpi_throughput"
  | "kpi_creation_velocity"
  | "kpi_department_workload"
  | "kpi_review_health"
  | "kpi_revision_cycle_time"
  | "kpi_event_mix"
  | "kpi_review_origin_mix"
  | "kpi_department_event_share"
  | "kpi_actor_activity_mix";

export type DashboardWidgetSize = "compact" | "standard" | "wide" | "full";

export interface DashboardWidgetLayoutItem {
  id: DashboardWidgetId;
  visible: boolean;
  size: DashboardWidgetSize;
}

export interface DashboardLayoutPreset {
  id: string;
  label: string;
  description: string;
  layout: DashboardWidgetLayoutItem[];
}

export const DASHBOARD_WIDGET_IDS: DashboardWidgetId[] = [
  "finder",
  "pinned",
  "newest",
  "department_activity",
  "review_queue",
  "formula_snapshot",
  "formula_review_queue",
  "formula_library",
  "recent_updates",
  "my_impact",
  "system_history",
  "kpi_throughput",
  "kpi_creation_velocity",
  "kpi_department_workload",
  "kpi_review_health",
  "kpi_revision_cycle_time",
  "kpi_event_mix",
  "kpi_review_origin_mix",
  "kpi_department_event_share",
  "kpi_actor_activity_mix",
];

export const DASHBOARD_WIDGET_SIZES: DashboardWidgetSize[] = [
  "compact",
  "standard",
  "wide",
  "full",
];

export const DEFAULT_DASHBOARD_LAYOUT_PRESET_ID = "plant_floor";

export const DASHBOARD_LAYOUT_PRESETS: DashboardLayoutPreset[] = [
  {
    id: "plant_floor",
    label: "Plant floor",
    description: "Big search, pinned instructions, and what changed recently, for operators at the line.",
    layout: [
      { id: "finder", visible: true, size: "full" },
      { id: "pinned", visible: true, size: "standard" },
      { id: "recent_updates", visible: true, size: "standard" },
      { id: "newest", visible: true, size: "standard" },
      { id: "review_queue", visible: true, size: "standard" },
      { id: "my_impact", visible: false, size: "compact" },
      { id: "formula_snapshot", visible: false, size: "compact" },
      { id: "formula_review_queue", visible: false, size: "standard" },
      { id: "formula_library", visible: false, size: "wide" },
      { id: "department_activity", visible: false, size: "standard" },
      { id: "system_history", visible: false, size: "full" },
      { id: "kpi_throughput", visible: false, size: "wide" },
      { id: "kpi_creation_velocity", visible: false, size: "wide" },
      { id: "kpi_department_workload", visible: false, size: "standard" },
      { id: "kpi_review_health", visible: false, size: "wide" },
      { id: "kpi_revision_cycle_time", visible: false, size: "wide" },
      { id: "kpi_event_mix", visible: false, size: "standard" },
      { id: "kpi_review_origin_mix", visible: false, size: "standard" },
      { id: "kpi_department_event_share", visible: false, size: "wide" },
      { id: "kpi_actor_activity_mix", visible: false, size: "standard" },
    ],
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Instruction search, personal shortcuts, current work, and review activity.",
    layout: [
      { id: "finder", visible: true, size: "full" },
      { id: "my_impact", visible: true, size: "compact" },
      { id: "newest", visible: true, size: "standard" },
      { id: "pinned", visible: true, size: "standard" },
      { id: "formula_snapshot", visible: true, size: "compact" },
      { id: "formula_review_queue", visible: true, size: "standard" },
      { id: "formula_library", visible: false, size: "wide" },
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
      { id: "kpi_review_origin_mix", visible: false, size: "standard" },
      { id: "kpi_department_event_share", visible: false, size: "wide" },
      { id: "kpi_actor_activity_mix", visible: false, size: "standard" },
    ],
  },
  {
    id: "operations_live",
    label: "Operations Live",
    description: "Recent changes and production activity for daily floor coordination.",
    layout: [
      { id: "system_history", visible: true, size: "full" },
      { id: "recent_updates", visible: true, size: "full" },
      { id: "finder", visible: true, size: "wide" },
      { id: "department_activity", visible: true, size: "standard" },
      { id: "newest", visible: true, size: "standard" },
      { id: "review_queue", visible: true, size: "compact" },
      { id: "formula_review_queue", visible: true, size: "compact" },
      { id: "formula_snapshot", visible: true, size: "compact" },
      { id: "formula_library", visible: false, size: "wide" },
      { id: "pinned", visible: true, size: "compact" },
      { id: "my_impact", visible: true, size: "compact" },
      { id: "kpi_throughput", visible: false, size: "wide" },
      { id: "kpi_creation_velocity", visible: false, size: "wide" },
      { id: "kpi_department_workload", visible: false, size: "standard" },
      { id: "kpi_review_health", visible: false, size: "wide" },
      { id: "kpi_revision_cycle_time", visible: false, size: "wide" },
      { id: "kpi_event_mix", visible: false, size: "standard" },
      { id: "kpi_review_origin_mix", visible: false, size: "standard" },
      { id: "kpi_department_event_share", visible: false, size: "wide" },
      { id: "kpi_actor_activity_mix", visible: false, size: "standard" },
    ],
  },
  {
    id: "supervisor",
    label: "Supervisor",
    description: "Department workload, pending reviews, and the latest controlled instructions.",
    layout: [
      { id: "finder", visible: true, size: "full" },
      { id: "department_activity", visible: true, size: "wide" },
      { id: "recent_updates", visible: true, size: "wide" },
      { id: "system_history", visible: true, size: "wide" },
      { id: "review_queue", visible: true, size: "standard" },
      { id: "formula_review_queue", visible: true, size: "standard" },
      { id: "formula_snapshot", visible: true, size: "compact" },
      { id: "formula_library", visible: false, size: "wide" },
      { id: "newest", visible: true, size: "standard" },
      { id: "pinned", visible: true, size: "standard" },
      { id: "my_impact", visible: true, size: "compact" },
      { id: "kpi_throughput", visible: false, size: "wide" },
      { id: "kpi_creation_velocity", visible: false, size: "wide" },
      { id: "kpi_department_workload", visible: false, size: "standard" },
      { id: "kpi_review_health", visible: false, size: "wide" },
      { id: "kpi_revision_cycle_time", visible: false, size: "wide" },
      { id: "kpi_event_mix", visible: false, size: "standard" },
      { id: "kpi_review_origin_mix", visible: false, size: "standard" },
      { id: "kpi_department_event_share", visible: false, size: "wide" },
      { id: "kpi_actor_activity_mix", visible: false, size: "standard" },
    ],
  },
  {
    id: "personal_focus",
    label: "Personal Focus",
    description: "Pinned instructions, personal contribution, and reusable manufacturing formulas.",
    layout: [
      { id: "my_impact", visible: true, size: "standard" },
      { id: "pinned", visible: true, size: "wide" },
      { id: "newest", visible: true, size: "standard" },
      { id: "finder", visible: true, size: "full" },
      { id: "recent_updates", visible: true, size: "standard" },
      { id: "formula_snapshot", visible: true, size: "compact" },
      { id: "formula_library", visible: true, size: "standard" },
      { id: "formula_review_queue", visible: false, size: "compact" },
      { id: "review_queue", visible: true, size: "compact" },
      { id: "system_history", visible: true, size: "wide" },
      { id: "department_activity", visible: true, size: "compact" },
      { id: "kpi_throughput", visible: false, size: "wide" },
      { id: "kpi_creation_velocity", visible: false, size: "wide" },
      { id: "kpi_department_workload", visible: false, size: "standard" },
      { id: "kpi_review_health", visible: false, size: "wide" },
      { id: "kpi_revision_cycle_time", visible: false, size: "wide" },
      { id: "kpi_event_mix", visible: false, size: "standard" },
      { id: "kpi_review_origin_mix", visible: false, size: "standard" },
      { id: "kpi_department_event_share", visible: false, size: "wide" },
      { id: "kpi_actor_activity_mix", visible: false, size: "standard" },
    ],
  },
  {
    id: "compact_grid",
    label: "Compact Grid",
    description: "A compact overview for tablet workstations and smaller screens.",
    layout: [
      { id: "finder", visible: true, size: "compact" },
      { id: "newest", visible: true, size: "compact" },
      { id: "pinned", visible: true, size: "compact" },
      { id: "my_impact", visible: true, size: "standard" },
      { id: "department_activity", visible: true, size: "standard" },
      { id: "recent_updates", visible: true, size: "wide" },
      { id: "review_queue", visible: true, size: "compact" },
      { id: "formula_review_queue", visible: true, size: "compact" },
      { id: "formula_snapshot", visible: true, size: "compact" },
      { id: "formula_library", visible: false, size: "standard" },
      { id: "system_history", visible: true, size: "full" },
      { id: "kpi_throughput", visible: false, size: "wide" },
      { id: "kpi_creation_velocity", visible: false, size: "wide" },
      { id: "kpi_department_workload", visible: false, size: "standard" },
      { id: "kpi_review_health", visible: false, size: "wide" },
      { id: "kpi_revision_cycle_time", visible: false, size: "wide" },
      { id: "kpi_event_mix", visible: false, size: "standard" },
      { id: "kpi_review_origin_mix", visible: false, size: "standard" },
      { id: "kpi_department_event_share", visible: false, size: "wide" },
      { id: "kpi_actor_activity_mix", visible: false, size: "standard" },
    ],
  },
  {
    id: "audit_review",
    label: "Audit Review",
    description: "Traceable changes, revision activity, and the outstanding review workload.",
    layout: [
      { id: "system_history", visible: true, size: "full" },
      { id: "recent_updates", visible: true, size: "full" },
      { id: "department_activity", visible: true, size: "standard" },
      { id: "newest", visible: true, size: "standard" },
      { id: "review_queue", visible: true, size: "compact" },
      { id: "formula_review_queue", visible: true, size: "compact" },
      { id: "formula_snapshot", visible: true, size: "compact" },
      { id: "formula_library", visible: false, size: "wide" },
      { id: "finder", visible: true, size: "wide" },
      { id: "pinned", visible: true, size: "standard" },
      { id: "my_impact", visible: true, size: "compact" },
      { id: "kpi_throughput", visible: false, size: "wide" },
      { id: "kpi_creation_velocity", visible: false, size: "wide" },
      { id: "kpi_department_workload", visible: false, size: "standard" },
      { id: "kpi_review_health", visible: false, size: "wide" },
      { id: "kpi_revision_cycle_time", visible: false, size: "wide" },
      { id: "kpi_event_mix", visible: false, size: "standard" },
      { id: "kpi_review_origin_mix", visible: false, size: "standard" },
      { id: "kpi_department_event_share", visible: false, size: "wide" },
      { id: "kpi_actor_activity_mix", visible: false, size: "standard" },
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
  if (!Array.isArray(value) || value.length > DASHBOARD_WIDGET_IDS.length) {
    return null;
  }

  const parsed: DashboardWidgetLayoutItem[] = [];
  const seenIds = new Set<DashboardWidgetId>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
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
  // A personalized homepage must not gain visible widgets merely because the application was upgraded.
  const missing = fallbackOrder.filter((entry) => !seen.has(entry.id)).map((entry) => ({ ...entry, visible: false }));
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
  const completedLayout = normalizeDashboardLayout(layout);
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
  // Historical profiles use [] for their first-use default. An intentionally empty homepage is
  // represented by a complete list whose widgets are explicitly hidden.
  if (!Array.isArray(value) || value.length === 0) {
    return getDefaultDashboardLayout();
  }
  const recovered: DashboardWidgetLayoutItem[] = [];
  const seen = new Set<DashboardWidgetId>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const size = typeof candidate.size === "string" ? candidate.size.trim() : "";
    if (!isDashboardWidgetId(id) || seen.has(id) || typeof candidate.visible !== "boolean" || !isDashboardWidgetSize(size)) continue;
    recovered.push({ id, size, visible: candidate.visible });
    seen.add(id);
  }
  // Retired widget IDs and isolated malformed rows should not erase the remaining valid layout.
  return recovered.length ? fillMissingWidgets(recovered) : getDefaultDashboardLayout();
}
