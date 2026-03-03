import type {
  DashboardWidgetId,
  DashboardWidgetSize,
} from "@/lib/dashboard-layout";

export const DASHBOARD_LAYOUT_COMMAND_EVENT = "dashboard:layout-command";
export const DASHBOARD_LAYOUT_STATE_EVENT = "dashboard:layout-state";
export const DASHBOARD_LAYOUT_MENU_INTENT_KEY = "dashboard:layout-menu-intent";
export const DASHBOARD_LAYOUT_MENU_INTENT_OPEN_CUSTOMIZE = "open-customize";

export type DashboardLayoutCommand =
  | "toggle-customize"
  | "save-layout"
  | "save-layout-default"
  | "discard-changes"
  | "undo-layout-change"
  | "redo-layout-change"
  | "load-default"
  | "reset-defaults"
  | "apply-layout-preset"
  | "set-widget-visibility"
  | "set-widget-size";

export interface DashboardLayoutCommandEventDetail {
  command: DashboardLayoutCommand;
  presetId?: string;
  widgetId?: DashboardWidgetId;
  visible?: boolean;
  size?: DashboardWidgetSize;
}

export interface DashboardLayoutStudioWidgetState {
  id: DashboardWidgetId;
  title: string;
  description: string;
  visible: boolean;
  size: DashboardWidgetSize;
  category: "core" | "kpi";
}

export interface DashboardLayoutPresetState {
  id: string;
  label: string;
}

export interface DashboardLayoutStateEventDetail {
  available: boolean;
  customizeOpen: boolean;
  layoutDirty: boolean;
  layoutSaving: boolean;
  layoutError: string | null;
  canUndoLayout: boolean;
  canRedoLayout: boolean;
  activeLayoutPresetId: string | null;
  layoutPresets: DashboardLayoutPresetState[];
  studioWidgets: DashboardLayoutStudioWidgetState[];
}

export const DASHBOARD_LAYOUT_DEFAULT_STATE: DashboardLayoutStateEventDetail = {
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
};
