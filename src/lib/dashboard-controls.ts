export const DASHBOARD_LAYOUT_COMMAND_EVENT = "dashboard:layout-command";
export const DASHBOARD_LAYOUT_STATE_EVENT = "dashboard:layout-state";
export const DASHBOARD_LAYOUT_MENU_INTENT_KEY = "dashboard:layout-menu-intent";
export const DASHBOARD_LAYOUT_MENU_INTENT_OPEN_CUSTOMIZE = "open-customize";

export type DashboardLayoutCommand =
  | "toggle-customize"
  | "save-layout"
  | "save-layout-default"
  | "discard-changes"
  | "reset-defaults";

export interface DashboardLayoutCommandEventDetail {
  command: DashboardLayoutCommand;
}

export interface DashboardLayoutStateEventDetail {
  available: boolean;
  customizeOpen: boolean;
  layoutDirty: boolean;
  layoutSaving: boolean;
  layoutError: string | null;
}

export const DASHBOARD_LAYOUT_DEFAULT_STATE: DashboardLayoutStateEventDetail = {
  available: false,
  customizeOpen: false,
  layoutDirty: false,
  layoutSaving: false,
  layoutError: null,
};
