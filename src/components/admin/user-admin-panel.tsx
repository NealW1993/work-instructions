"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Eye,
  GripVertical,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { InstructionReviewActivityChart } from "@/components/admin/instruction-review-activity-chart";
import { LocalDateTime } from "@/components/ui/local-date-time";
import { PinInput } from "@/components/ui/pin-input";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { AppRole } from "@/lib/types";
import { cn, isValidEmployeeId, normalizeEmployeeId } from "@/lib/utils";

interface AdminUser {
  id: string;
  email: string;
  employee_id: string | null;
  full_name: string;
  role: AppRole;
  is_active: boolean;
  inactivity_timeout_minutes: number | null;
  created_at: string;
}

interface AdminDepartment {
  id: string;
  name: string;
  sort_order: number;
  color_hex: string;
  created_at: string;
  updated_at: string;
}

interface AdminSuggestedTool {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SuggestedToolsResponse {
  canCreateTaxonomy: boolean;
  canManageTaxonomy: boolean;
  tools: AdminSuggestedTool[];
}

interface InstructionReviewSettingsResponse {
  reviewWindowDays: number;
  updatedAt: string | null;
}

interface AdminWorkInstruction {
  id: string;
  workItemId: string;
  revision: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  partId: string;
  itemTitle: string;
  departmentName: string;
  departmentColorHex: string | null;
  forkRootInstructionId: string | null;
  forkNumber: number | null;
  viewCount: number;
}

interface WorkInstructionManagementResponse {
  instructions: AdminWorkInstruction[];
}

type WorkInstructionBulkAction = "archive" | "permanent_delete";
type WorkInstructionConfirmAction =
  | WorkInstructionBulkAction
  | "archive_and_delete";

interface WorkInstructionBulkActionResponse {
  success?: boolean;
  action?: WorkInstructionBulkAction;
  archiveInstructionIds?: string[];
  deleteInstructionIds?: string[];
  skippedAlreadyArchivedIds?: string[];
  skippedNotArchivedIds?: string[];
  missingInstructionIds?: string[];
  error?: string;
}

interface WorkInstructionActionConfirmState {
  action: WorkInstructionConfirmAction;
  selectedInstructionIds: string[];
  archiveInstructionIds: string[];
  deleteInstructionIds: string[];
  skippedInstructionIds: string[];
}

interface CreateUserFieldErrors {
  fullName: boolean;
  email: boolean;
  employeeId: boolean;
  pin: boolean;
}

type UserSettingField = "employeeId" | "role" | "inactivityTimeout" | "pin";

type ConfirmDialogState =
  | {
      kind: "delete-user";
      userId: string;
      title: string;
      description: string;
      confirmLabel: string;
    }
  | {
      kind: "delete-department";
      departmentId: string;
      title: string;
      description: string;
      confirmLabel: string;
    }
  | {
      kind: "save-all-departments";
      departmentIds: string[];
      title: string;
      description: string;
      confirmLabel: string;
    }
  | {
      kind: "delete-suggested-tool";
      toolId: string;
      title: string;
      description: string;
      confirmLabel: string;
    };

const ROLE_OPTIONS: AppRole[] = ["user", "admin", "system_admin"];

const DEFAULT_CREATE_USER_FIELD_ERRORS: CreateUserFieldErrors = {
  fullName: false,
  email: false,
  employeeId: false,
  pin: false,
};

const DEFAULT_DEPARTMENT_COLORS = [
  "#0EA5E9",
  "#22C55E",
  "#F97316",
  "#A855F7",
  "#EAB308",
  "#14B8A6",
  "#EF4444",
  "#8B5CF6",
  "#06B6D4",
  "#84CC16",
  "#F43F5E",
  "#3B82F6",
] as const;
const DEFAULT_REVIEW_WINDOW_DAYS = 30;

function normalizeColorHex(value: string) {
  const normalized = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null;
}

function colorWithAlpha(colorHex: string, alpha: number) {
  const resolvedColor = normalizeColorHex(colorHex) ?? DEFAULT_DEPARTMENT_COLORS[0];
  const red = Number.parseInt(resolvedColor.slice(1, 3), 16);
  const green = Number.parseInt(resolvedColor.slice(3, 5), 16);
  const blue = Number.parseInt(resolvedColor.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getInputClass(hasError: boolean) {
  return cn(
    "rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950",
    hasError ? "border-rose-500 ring-2 ring-rose-500/30" : "",
  );
}

function normalizeReviewWindowDaysInput(value: string) {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed)) {
    return null;
  }

  if (parsed < 1 || parsed > 365) {
    return null;
  }

  return parsed;
}

function normalizeInactivityTimeoutInput(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "never") {
    return null;
  }

  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10080) {
    return undefined;
  }

  return parsed;
}

function normalizeSuggestedToolInput(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function getToolAlphabetBucket(value: string) {
  const firstChar = value.trim().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(firstChar) ? firstChar : "#";
}

function getUserSettingSavedKey(userId: string, field: UserSettingField) {
  return `${userId}:${field}`;
}

function SavedRibbonOverlay({ visible }: { visible: boolean }) {
  if (!visible) {
    return null;
  }

  return (
    <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
      <span className="user-setting-saved-ribbon-layer absolute inset-y-0 -left-1/2 w-[200%] bg-emerald-500/35" />
      <span className="user-setting-saved-ribbon-text absolute inset-y-0 -left-1/2 flex w-[200%] items-center justify-center text-[11px] font-extrabold uppercase tracking-[0.2em] text-emerald-950 dark:text-emerald-50">
        Saved
      </span>
    </span>
  );
}

function isInteractiveClickTarget(target: EventTarget | null) {
  if (!(target instanceof Node)) {
    return false;
  }

  const element =
    target instanceof HTMLElement ? target : target.parentElement;
  if (!element) {
    return false;
  }

  return Boolean(
    element.closest(
      "button, a, input, select, textarea, label, [role='button'], [role='link']",
    ),
  );
}

export function UserAdminPanel() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [departments, setDepartments] = useState<AdminDepartment[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [reviewWindowDaysInput, setReviewWindowDaysInput] = useState<string>(
    String(DEFAULT_REVIEW_WINDOW_DAYS),
  );
  const [reviewWindowDaysSaved, setReviewWindowDaysSaved] = useState<number>(
    DEFAULT_REVIEW_WINDOW_DAYS,
  );
  const [reviewWindowUpdatedAt, setReviewWindowUpdatedAt] = useState<string | null>(null);
  const [reviewSettingsBusy, setReviewSettingsBusy] = useState(false);
  const [reviewWindowInputHasError, setReviewWindowInputHasError] = useState(false);
  const [reviewActivityReloadToken, setReviewActivityReloadToken] = useState(0);
  const [canCreateSuggestedToolTaxonomy, setCanCreateSuggestedToolTaxonomy] = useState(false);
  const [canManageSuggestedToolTaxonomy, setCanManageSuggestedToolTaxonomy] = useState(false);
  const [suggestedTools, setSuggestedTools] = useState<AdminSuggestedTool[]>([]);
  const [suggestedToolsCollapsed, setSuggestedToolsCollapsed] = useState(true);
  const [suggestedToolSearch, setSuggestedToolSearch] = useState("");
  const [suggestedToolAlphabetFilter, setSuggestedToolAlphabetFilter] = useState("All");
  const [showInactiveSuggestedTools, setShowInactiveSuggestedTools] = useState(true);
  const [newSuggestedToolName, setNewSuggestedToolName] = useState("");
  const [editingSuggestedToolId, setEditingSuggestedToolId] = useState<string | null>(null);
  const [editingSuggestedToolName, setEditingSuggestedToolName] = useState("");
  const [editingSuggestedToolNameHasError, setEditingSuggestedToolNameHasError] = useState(false);
  const [newSuggestedToolNameHasError, setNewSuggestedToolNameHasError] = useState(false);
  const [workInstructions, setWorkInstructions] = useState<AdminWorkInstruction[]>([]);
  const [workInstructionsCollapsed, setWorkInstructionsCollapsed] = useState(true);
  const [workInstructionSelection, setWorkInstructionSelection] = useState<
    Record<string, boolean>
  >({});
  const [workInstructionBusy, setWorkInstructionBusy] = useState(false);
  const [workInstructionListMaxHeight, setWorkInstructionListMaxHeight] = useState<number | null>(
    null,
  );
  const [workInstructionActionConfirm, setWorkInstructionActionConfirm] =
    useState<WorkInstructionActionConfirmState | null>(null);
  const workInstructionListRef = useRef<HTMLDivElement | null>(null);

  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [newDepartmentNameHasError, setNewDepartmentNameHasError] = useState(false);
  const [newDepartmentColor, setNewDepartmentColor] = useState<string>(
    DEFAULT_DEPARTMENT_COLORS[0],
  );
  const [newDepartmentColorHasError, setNewDepartmentColorHasError] = useState(false);
  const [departmentNameUpdates, setDepartmentNameUpdates] = useState<
    Record<string, string>
  >({});
  const [departmentNameUpdateErrors, setDepartmentNameUpdateErrors] = useState<
    Record<string, boolean>
  >({});
  const [departmentColorUpdates, setDepartmentColorUpdates] = useState<
    Record<string, string>
  >({});
  const [departmentColorUpdateErrors, setDepartmentColorUpdateErrors] = useState<
    Record<string, boolean>
  >({});
  const [departmentOrderDirty, setDepartmentOrderDirty] = useState(false);
  const [draggedDepartmentId, setDraggedDepartmentId] = useState<string | null>(null);
  const [dragOverDepartmentId, setDragOverDepartmentId] = useState<string | null>(null);
  const [departmentsCollapsed, setDepartmentsCollapsed] = useState(true);
  const [usersCollapsed, setUsersCollapsed] = useState(true);
  const [departmentSavedFlash, setDepartmentSavedFlash] = useState<Record<string, boolean>>({});
  const [editingDepartmentOrderId, setEditingDepartmentOrderId] = useState<string | null>(
    null,
  );
  const [editingDepartmentOrderValue, setEditingDepartmentOrderValue] = useState("");
  const usersRefreshTimeoutRef = useRef<number | null>(null);
  const departmentsRefreshTimeoutRef = useRef<number | null>(null);
  const suggestedToolsRefreshTimeoutRef = useRef<number | null>(null);
  const workInstructionsRefreshTimeoutRef = useRef<number | null>(null);

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newEmployeeId, setNewEmployeeId] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("user");
  const [createUserFieldErrors, setCreateUserFieldErrors] = useState<CreateUserFieldErrors>(
    DEFAULT_CREATE_USER_FIELD_ERRORS,
  );

  const [pinUpdates, setPinUpdates] = useState<Record<string, string>>({});
  const [roleUpdates, setRoleUpdates] = useState<Record<string, AppRole>>({});
  const [employeeIdUpdates, setEmployeeIdUpdates] = useState<Record<string, string>>({});
  const [inactivityTimeoutUpdates, setInactivityTimeoutUpdates] = useState<Record<string, string>>(
    {},
  );
  const [userSettingSavedFlash, setUserSettingSavedFlash] = useState<Record<string, boolean>>({});
  const [portalReady, setPortalReady] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const userSettingSavedTimeoutIdsRef = useRef<Record<string, number>>({});

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

  const fetchUsers = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/users", {
        method: "GET",
        headers,
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        users?: AdminUser[];
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load users.");
      }

      setUsers(payload.users ?? []);
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to load users";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }, [getAuthHeaders]);

  const fetchDepartments = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/departments", {
        method: "GET",
        headers,
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        departments?: AdminDepartment[];
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load departments.");
      }

      const resolvedDepartments = payload.departments ?? [];
      setDepartments(resolvedDepartments);
      setDepartmentOrderDirty(false);
      setDraggedDepartmentId(null);
      setDragOverDepartmentId(null);
      setEditingDepartmentOrderId(null);
      setEditingDepartmentOrderValue("");
      setDepartmentNameUpdates(() => {
        const next: Record<string, string> = {};
        for (const department of resolvedDepartments) {
          next[department.id] = department.name;
        }
        return next;
      });
      setDepartmentColorUpdates(() => {
        const next: Record<string, string> = {};
        for (const department of resolvedDepartments) {
          const normalizedColor = normalizeColorHex(department.color_hex);
          next[department.id] = normalizedColor ?? "#0EA5E9";
        }
        return next;
      });
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to load departments";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }, [getAuthHeaders]);

  const fetchInstructionReviewSettings = useCallback(async () => {
    setReviewSettingsBusy(true);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/instruction-review/settings", {
        method: "GET",
        headers,
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      } & Partial<InstructionReviewSettingsResponse>;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load instruction review settings.");
      }

      const nextReviewWindowDays = normalizeReviewWindowDaysInput(
        String(payload.reviewWindowDays ?? DEFAULT_REVIEW_WINDOW_DAYS),
      );
      const resolvedReviewWindowDays =
        nextReviewWindowDays ?? DEFAULT_REVIEW_WINDOW_DAYS;

      setReviewWindowDaysSaved(resolvedReviewWindowDays);
      setReviewWindowDaysInput(String(resolvedReviewWindowDays));
      setReviewWindowUpdatedAt(payload.updatedAt ?? null);
      setReviewWindowInputHasError(false);
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load instruction review settings.";
      setError(normalizedMessage);
    } finally {
      setReviewSettingsBusy(false);
    }
  }, [getAuthHeaders]);

  const fetchSuggestedTools = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/suggested-tools?includeInactive=true", {
        method: "GET",
        headers,
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      } & Partial<SuggestedToolsResponse>;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load suggested tools.");
      }

      const nextTools = payload.tools ?? [];
      setCanCreateSuggestedToolTaxonomy(payload.canCreateTaxonomy === true);
      setCanManageSuggestedToolTaxonomy(payload.canManageTaxonomy === true);
      setSuggestedTools(nextTools);
      setEditingSuggestedToolId((current) =>
        current && nextTools.some((tool) => tool.id === current) ? current : null,
      );
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load suggested tools.";
      setError(normalizedMessage);
    }
  }, [getAuthHeaders]);

  const fetchWorkInstructions = useCallback(async () => {
    setWorkInstructionBusy(true);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/admin/work-instructions", {
        method: "GET",
        headers,
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      } & Partial<WorkInstructionManagementResponse>;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load work instructions.");
      }

      const nextInstructions = payload.instructions ?? [];
      setWorkInstructions(nextInstructions);
      setWorkInstructionSelection((current) => {
        const next: Record<string, boolean> = {};
        const validInstructionIds = new Set(nextInstructions.map((instruction) => instruction.id));

        for (const [instructionId, selected] of Object.entries(current)) {
          if (selected && validInstructionIds.has(instructionId)) {
            next[instructionId] = true;
          }
        }

        return next;
      });
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load work instructions.";
      setError(normalizedMessage);
    } finally {
      setWorkInstructionBusy(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    return () => {
      for (const timeoutId of Object.values(userSettingSavedTimeoutIdsRef.current)) {
        window.clearTimeout(timeoutId);
      }
      userSettingSavedTimeoutIdsRef.current = {};
    };
  }, []);

  const triggerUserSettingSavedFlash = useCallback((userId: string, field: UserSettingField) => {
    if (typeof window === "undefined") {
      return;
    }

    const key = getUserSettingSavedKey(userId, field);
    const existingTimeoutId = userSettingSavedTimeoutIdsRef.current[key];
    if (typeof existingTimeoutId === "number") {
      window.clearTimeout(existingTimeoutId);
    }
    setUserSettingSavedFlash((current) => ({ ...current, [key]: false }));
    window.requestAnimationFrame(() => {
      setUserSettingSavedFlash((current) => ({ ...current, [key]: true }));
    });

    const timeoutId = window.setTimeout(() => {
      setUserSettingSavedFlash((current) => ({
        ...current,
        [key]: false,
      }));
      delete userSettingSavedTimeoutIdsRef.current[key];
    }, 6200);

    userSettingSavedTimeoutIdsRef.current[key] = timeoutId;
  }, []);

  useEffect(() => {
    void (async () => {
      await Promise.all([
        fetchUsers(),
        fetchDepartments(),
        fetchInstructionReviewSettings(),
        fetchSuggestedTools(),
        fetchWorkInstructions(),
      ]);
    })();
  }, [
    fetchDepartments,
    fetchInstructionReviewSettings,
    fetchSuggestedTools,
    fetchUsers,
    fetchWorkInstructions,
  ]);

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      setCurrentUserId(user?.id ?? null);
    })();
  }, [supabase]);

  const scheduleUsersRefresh = useCallback(() => {
    if (typeof window === "undefined" || usersRefreshTimeoutRef.current !== null) {
      return;
    }

    usersRefreshTimeoutRef.current = window.setTimeout(() => {
      usersRefreshTimeoutRef.current = null;
      void fetchUsers();
    }, 450);
  }, [fetchUsers]);

  const scheduleDepartmentsRefresh = useCallback(() => {
    if (
      typeof window === "undefined" ||
      departmentsRefreshTimeoutRef.current !== null ||
      departmentOrderDirty
    ) {
      return;
    }

    departmentsRefreshTimeoutRef.current = window.setTimeout(() => {
      departmentsRefreshTimeoutRef.current = null;
      void fetchDepartments();
    }, 450);
  }, [departmentOrderDirty, fetchDepartments]);

  const scheduleSuggestedToolsRefresh = useCallback(() => {
    if (
      typeof window === "undefined" ||
      suggestedToolsRefreshTimeoutRef.current !== null
    ) {
      return;
    }

    suggestedToolsRefreshTimeoutRef.current = window.setTimeout(() => {
      suggestedToolsRefreshTimeoutRef.current = null;
      void fetchSuggestedTools();
    }, 450);
  }, [fetchSuggestedTools]);

  const scheduleWorkInstructionsRefresh = useCallback(() => {
    if (
      typeof window === "undefined" ||
      workInstructionsRefreshTimeoutRef.current !== null
    ) {
      return;
    }

    workInstructionsRefreshTimeoutRef.current = window.setTimeout(() => {
      workInstructionsRefreshTimeoutRef.current = null;
      void fetchWorkInstructions();
    }, 550);
  }, [fetchWorkInstructions]);

  useEffect(() => {
    const usersChannel = supabase
      .channel("admin-users-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => scheduleUsersRefresh(),
      )
      .subscribe();

    const departmentsChannel = supabase
      .channel("admin-departments-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "departments" },
        () => scheduleDepartmentsRefresh(),
      )
      .subscribe();

    const suggestedToolsChannel = supabase
      .channel("admin-suggested-tools-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "suggested_tools" },
        () => scheduleSuggestedToolsRefresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "suggested_tool_categories" },
        () => scheduleSuggestedToolsRefresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "suggested_tool_subcategories" },
        () => scheduleSuggestedToolsRefresh(),
      )
      .subscribe();

    const workInstructionsChannel = supabase
      .channel("admin-work-instructions-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_instructions" },
        () => scheduleWorkInstructionsRefresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "instruction_view_events" },
        () => scheduleWorkInstructionsRefresh(),
      )
      .subscribe();

    return () => {
      if (usersRefreshTimeoutRef.current !== null) {
        window.clearTimeout(usersRefreshTimeoutRef.current);
        usersRefreshTimeoutRef.current = null;
      }
      if (departmentsRefreshTimeoutRef.current !== null) {
        window.clearTimeout(departmentsRefreshTimeoutRef.current);
        departmentsRefreshTimeoutRef.current = null;
      }
      if (suggestedToolsRefreshTimeoutRef.current !== null) {
        window.clearTimeout(suggestedToolsRefreshTimeoutRef.current);
        suggestedToolsRefreshTimeoutRef.current = null;
      }
      if (workInstructionsRefreshTimeoutRef.current !== null) {
        window.clearTimeout(workInstructionsRefreshTimeoutRef.current);
        workInstructionsRefreshTimeoutRef.current = null;
      }
      void supabase.removeChannel(usersChannel);
      void supabase.removeChannel(departmentsChannel);
      void supabase.removeChannel(suggestedToolsChannel);
      void supabase.removeChannel(workInstructionsChannel);
    };
  }, [
    scheduleDepartmentsRefresh,
    scheduleWorkInstructionsRefresh,
    scheduleSuggestedToolsRefresh,
    scheduleUsersRefresh,
    supabase,
  ]);

  function getNextDepartmentColor() {
    const usedColors = new Set(
      departments
        .map((department) => normalizeColorHex(department.color_hex))
        .filter((value): value is string => value !== null),
    );

    const firstUnused = DEFAULT_DEPARTMENT_COLORS.find((color) => !usedColors.has(color));
    if (firstUnused) {
      return firstUnused;
    }

    return DEFAULT_DEPARTMENT_COLORS[departments.length % DEFAULT_DEPARTMENT_COLORS.length];
  }

  function reorderDepartments(sourceDepartmentId: string, targetDepartmentId: string) {
    if (sourceDepartmentId === targetDepartmentId) {
      return;
    }

    setDepartments((current) => {
      const sourceIndex = current.findIndex((department) => department.id === sourceDepartmentId);
      const targetIndex = current.findIndex((department) => department.id === targetDepartmentId);

      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return current;
      }

      const next = [...current];
      const [movedDepartment] = next.splice(sourceIndex, 1);
      if (!movedDepartment) {
        return current;
      }

      next.splice(targetIndex, 0, movedDepartment);
      return next;
    });

    setDepartmentOrderDirty(true);
  }

  function moveDepartmentToIndex(sourceDepartmentId: string, targetIndex: number) {
    setDepartments((current) => {
      const sourceIndex = current.findIndex((department) => department.id === sourceDepartmentId);
      if (sourceIndex < 0) {
        return current;
      }

      const boundedTargetIndex = Math.max(0, Math.min(targetIndex, current.length - 1));
      if (sourceIndex === boundedTargetIndex) {
        return current;
      }

      const next = [...current];
      const [movedDepartment] = next.splice(sourceIndex, 1);
      if (!movedDepartment) {
        return current;
      }

      next.splice(boundedTargetIndex, 0, movedDepartment);
      return next;
    });
    setDepartmentOrderDirty(true);
  }

  function startDepartmentOrderEdit(departmentId: string, currentOrder: number) {
    if (busy) {
      return;
    }

    setEditingDepartmentOrderId(departmentId);
    setEditingDepartmentOrderValue(String(currentOrder));
  }

  function cancelDepartmentOrderEdit() {
    setEditingDepartmentOrderId(null);
    setEditingDepartmentOrderValue("");
  }

  function commitDepartmentOrderEdit(departmentId: string) {
    const parsedOrder = Number.parseInt(editingDepartmentOrderValue, 10);
    if (!Number.isFinite(parsedOrder) || parsedOrder < 1) {
      cancelDepartmentOrderEdit();
      return;
    }

    moveDepartmentToIndex(departmentId, parsedOrder - 1);
    cancelDepartmentOrderEdit();
  }

  async function saveInstructionReviewSettings() {
    setReviewSettingsBusy(true);
    setError(null);
    setMessage(null);

    try {
      const reviewWindowDays = normalizeReviewWindowDaysInput(reviewWindowDaysInput);
      if (reviewWindowDays === null) {
        setReviewWindowInputHasError(true);
        throw new Error("Review window days must be a whole number between 1 and 365.");
      }

      const headers = await getAuthHeaders();
      const response = await fetch("/api/instruction-review/settings", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ reviewWindowDays }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      } & Partial<InstructionReviewSettingsResponse>;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update instruction review settings.");
      }

      const savedReviewWindowDays = normalizeReviewWindowDaysInput(
        String(payload.reviewWindowDays ?? reviewWindowDays),
      );

      setReviewWindowDaysSaved(savedReviewWindowDays ?? reviewWindowDays);
      setReviewWindowDaysInput(
        String(savedReviewWindowDays ?? reviewWindowDays),
      );
      setReviewWindowUpdatedAt(payload.updatedAt ?? null);
      setReviewWindowInputHasError(false);
      setMessage("Instruction review window updated.");
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to update instruction review settings.";
      setError(normalizedMessage);
    } finally {
      setReviewSettingsBusy(false);
    }
  }

  async function handleCreateSuggestedTool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    setNewSuggestedToolNameHasError(false);

    try {
      const normalizedName = normalizeSuggestedToolInput(newSuggestedToolName);

      if (!normalizedName) {
        setNewSuggestedToolNameHasError(true);
        throw new Error("Tool name is required.");
      }

      const headers = await getAuthHeaders();
      const response = await fetch("/api/suggested-tools", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: normalizedName,
          sortOrder: suggestedTools.length,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to create suggested tool.");
      }

      setMessage("Common tool added.");
      setNewSuggestedToolName("");
      await fetchSuggestedTools();
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to create suggested tool.";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  async function performDeleteSuggestedTool(toolId: string) {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/suggested-tools/${toolId}`, {
        method: "DELETE",
        headers,
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to delete suggested tool.");
      }

      setMessage("Common tool removed from future search.");
      setConfirmDialog(null);
      await fetchSuggestedTools();
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to delete suggested tool.";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  async function performUpdateSuggestedTool(
    toolId: string,
    payload: {
      name?: string;
      isActive?: boolean;
    },
    successMessage: string,
  ) {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/suggested-tools/${toolId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload),
      });

      const responsePayload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(responsePayload.error ?? "Unable to update common tool.");
      }

      setMessage(successMessage);
      setConfirmDialog(null);
      await fetchSuggestedTools();
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to update common tool.";
      setError(normalizedMessage);
      throw caughtError;
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSuggestedToolEdit(toolId: string) {
    const normalizedName = normalizeSuggestedToolInput(editingSuggestedToolName);
    if (!normalizedName) {
      setEditingSuggestedToolNameHasError(true);
      setError("Tool name is required.");
      return;
    }

    try {
      await performUpdateSuggestedTool(
        toolId,
        { name: normalizedName },
        "Common tool updated.",
      );

      setEditingSuggestedToolId(null);
      setEditingSuggestedToolName("");
      setEditingSuggestedToolNameHasError(false);
    } catch {
      // Error state is handled in performUpdateSuggestedTool.
    }
  }

  async function handleRestoreSuggestedTool(toolId: string) {
    try {
      await performUpdateSuggestedTool(
        toolId,
        { isActive: true },
        "Common tool restored to active search results.",
      );
    } catch {
      // Error state is handled in performUpdateSuggestedTool.
    }
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    setCreateUserFieldErrors(DEFAULT_CREATE_USER_FIELD_ERRORS);

    try {
      const normalizedName = newName.trim();
      const normalizedEmail = newEmail.trim().toLowerCase();
      const normalizedEmployeeId = normalizeEmployeeId(newEmployeeId);
      const normalizedPin = newPin.trim();

      if (!normalizedName) {
        setCreateUserFieldErrors((current) => ({ ...current, fullName: true }));
        throw new Error("Full Name is required.");
      }

      if (!normalizedEmail) {
        setCreateUserFieldErrors((current) => ({ ...current, email: true }));
        throw new Error("Email is required.");
      }

      if (!isValidEmployeeId(normalizedEmployeeId)) {
        setCreateUserFieldErrors((current) => ({ ...current, employeeId: true }));
        throw new Error("Employee ID must be 1-6 digits.");
      }

      if (!/^\d{6}$/.test(normalizedPin)) {
        setCreateUserFieldErrors((current) => ({ ...current, pin: true }));
        throw new Error("PIN must be exactly 6 digits.");
      }

      const headers = await getAuthHeaders();
      const response = await fetch("/api/users", {
        method: "POST",
        headers,
        body: JSON.stringify({
          fullName: normalizedName,
          email: normalizedEmail,
          employeeId: normalizedEmployeeId,
          pin: normalizedPin,
          role: newRole,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to create user.");
      }

      setMessage("User created.");
      setNewName("");
      setNewEmail("");
      setNewEmployeeId("");
      setNewPin("");
      setNewRole("user");
      await fetchUsers();
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to create user";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  async function updateRole(userId: string) {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const role = roleUpdates[userId];
      if (!role) {
        throw new Error("Select a role first.");
      }

      const headers = await getAuthHeaders();
      const response = await fetch(`/api/users/${userId}/role`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ role }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update role.");
      }

      setMessage("Role updated.");
      await fetchUsers();
      setRoleUpdates((current) => {
        const next = { ...current };
        delete next[userId];
        return next;
      });
      triggerUserSettingSavedFlash(userId, "role");
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to update role";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  async function updatePin(userId: string) {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const pin = pinUpdates[userId] ?? "";

      if (pin.length !== 6) {
        throw new Error("PIN must be exactly 6 digits.");
      }

      const headers = await getAuthHeaders();
      const response = await fetch(`/api/users/${userId}/pin`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ pin }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update PIN.");
      }

      setMessage("PIN updated.");
      setPinUpdates((current) => ({
        ...current,
        [userId]: "",
      }));
      triggerUserSettingSavedFlash(userId, "pin");
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to update PIN";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  async function updateEmployeeId(userId: string) {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const employeeId = normalizeEmployeeId(
        employeeIdUpdates[userId] ?? users.find((user) => user.id === userId)?.employee_id ?? "",
      );

      if (!isValidEmployeeId(employeeId)) {
        throw new Error("Employee ID must be 1-6 digits.");
      }

      const headers = await getAuthHeaders();
      const response = await fetch(`/api/users/${userId}/employee-id`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          employeeId,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update employee ID.");
      }

      setMessage("Employee ID updated.");
      await fetchUsers();
      setEmployeeIdUpdates((current) => {
        const next = { ...current };
        delete next[userId];
        return next;
      });
      triggerUserSettingSavedFlash(userId, "employeeId");
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to update employee ID";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  async function updateInactivityTimeout(userId: string) {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const rawValue =
        inactivityTimeoutUpdates[userId] ??
        (() => {
          const defaultMinutes = users.find((user) => user.id === userId)?.inactivity_timeout_minutes;
          return defaultMinutes === null || defaultMinutes === undefined
            ? "never"
            : String(defaultMinutes);
        })();
      const normalizedTimeout = normalizeInactivityTimeoutInput(rawValue);

      if (normalizedTimeout === undefined) {
        throw new Error(
          "Auto sign-out timeout must be 'Never' or a whole number of minutes between 1 and 10080.",
        );
      }

      const headers = await getAuthHeaders();
      const response = await fetch(`/api/users/${userId}/inactivity-timeout`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          inactivityTimeoutMinutes: normalizedTimeout,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update auto sign-out timeout.");
      }

      setMessage(
        normalizedTimeout === null
          ? "Auto sign-out timeout updated to Never."
          : `Auto sign-out timeout updated to ${normalizedTimeout} minute${normalizedTimeout === 1 ? "" : "s"}.`,
      );
      setInactivityTimeoutUpdates((current) => {
        const next = { ...current };
        delete next[userId];
        return next;
      });
      triggerUserSettingSavedFlash(userId, "inactivityTimeout");
      await fetchUsers();
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to update auto sign-out timeout.";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    setNewDepartmentNameHasError(false);
    setNewDepartmentColorHasError(false);

    try {
      const name = newDepartmentName.trim();
      if (!name) {
        setNewDepartmentNameHasError(true);
        throw new Error("Department name is required.");
      }

      const normalizedColor = normalizeColorHex(newDepartmentColor);
      if (!normalizedColor) {
        setNewDepartmentColorHasError(true);
        throw new Error("Department color must be a valid hex value like #0EA5E9.");
      }

      const headers = await getAuthHeaders();
      const response = await fetch("/api/departments", {
        method: "POST",
        headers,
        body: JSON.stringify({ name, colorHex: normalizedColor }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to create department.");
      }

      setMessage("Department created.");
      setNewDepartmentName("");
      setNewDepartmentColor(getNextDepartmentColor());
      await fetchDepartments();
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to create department";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  async function updateDepartment(departmentId: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    setDepartmentNameUpdateErrors((current) => ({
      ...current,
      [departmentId]: false,
    }));
    setDepartmentColorUpdateErrors((current) => ({
      ...current,
      [departmentId]: false,
    }));

    try {
      const rawName =
        departmentNameUpdates[departmentId] ??
        departments.find((department) => department.id === departmentId)?.name ??
        "";
      const name = rawName.trim();
      const rawColor =
        departmentColorUpdates[departmentId] ??
        departments.find((department) => department.id === departmentId)?.color_hex ??
        "";
      const colorHex = normalizeColorHex(rawColor);

      if (!name) {
        setDepartmentNameUpdateErrors((current) => ({
          ...current,
          [departmentId]: true,
        }));
        throw new Error("Department name is required.");
      }

      if (!colorHex) {
        setDepartmentColorUpdateErrors((current) => ({
          ...current,
          [departmentId]: true,
        }));
        throw new Error("Department color must be a valid hex value like #0EA5E9.");
      }

      const headers = await getAuthHeaders();
      const response = await fetch(`/api/departments/${departmentId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ name, colorHex }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update department.");
      }

      setMessage(
        "Department updated. Name, color, and existing assignments are now in sync.",
      );
      await fetchDepartments();
      setDepartmentSavedFlash((current) => ({ ...current, [departmentId]: true }));
      window.setTimeout(() => {
        setDepartmentSavedFlash((current) => ({ ...current, [departmentId]: false }));
      }, 2000);
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to update department";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  async function saveDepartmentOrder() {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/departments/reorder", {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          orderedDepartmentIds: departments.map((department) => department.id),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        departments?: AdminDepartment[];
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save department order.");
      }

      if (payload.departments) {
        setDepartments(payload.departments);
      }

      setDepartmentOrderDirty(false);
      setMessage("Department order saved.");
      await fetchDepartments();
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to save department order";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  async function performDeleteDepartment(departmentId: string) {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/departments/${departmentId}`, {
        method: "DELETE",
        headers,
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to delete department.");
      }

      setMessage("Department deleted.");
      setConfirmDialog(null);
      await fetchDepartments();
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to delete department";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  async function performDeleteUser(userId: string) {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/users/${userId}`, {
        method: "DELETE",
        headers,
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to delete user.");
      }

      setMessage("User deleted.");
      setConfirmDialog(null);
      await fetchUsers();
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to delete user";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  async function saveAllDirtyDepartments(departmentIds: string[]) {
    setBusy(true);
    setError(null);
    setMessage(null);
    setConfirmDialog(null);

    try {
      const headers = await getAuthHeaders();
      const toSave = departments.filter((d) => departmentIds.includes(d.id));

      const results = await Promise.allSettled(
        toSave.map((department) => {
          const name = (departmentNameUpdates[department.id] ?? department.name).trim();
          const rawColor = departmentColorUpdates[department.id] ?? department.color_hex;
          const colorHex = normalizeColorHex(rawColor) ?? DEFAULT_DEPARTMENT_COLORS[0];
          return fetch(`/api/departments/${department.id}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ name, colorHex }),
          });
        }),
      );

      const failCount = results.filter((r) => r.status === "rejected").length;
      if (failCount > 0) {
        throw new Error(`${failCount} department(s) failed to save.`);
      }

      const flashUpdate: Record<string, boolean> = {};
      for (const id of departmentIds) {
        flashUpdate[id] = true;
      }
      setDepartmentSavedFlash((current) => ({ ...current, ...flashUpdate }));
      window.setTimeout(() => {
        setDepartmentSavedFlash((current) => {
          const next = { ...current };
          for (const id of departmentIds) {
            delete next[id];
          }
          return next;
        });
      }, 2000);

      setMessage(`${toSave.length} department(s) updated.`);
      await fetchDepartments();
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to save departments";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDialogAction() {
    if (!confirmDialog) {
      return;
    }

    if (confirmDialog.kind === "delete-user") {
      await performDeleteUser(confirmDialog.userId);
      return;
    }

    if (confirmDialog.kind === "save-all-departments") {
      await saveAllDirtyDepartments(confirmDialog.departmentIds);
      return;
    }

    if (confirmDialog.kind === "delete-suggested-tool") {
      await performDeleteSuggestedTool(confirmDialog.toolId);
      return;
    }

    await performDeleteDepartment(confirmDialog.departmentId);
  }

  const syncWorkInstructionListMaxHeight = useCallback(() => {
    if (
      typeof window === "undefined" ||
      workInstructionsCollapsed ||
      workInstructions.length <= 10
    ) {
      setWorkInstructionListMaxHeight(null);
      return;
    }

    const listElement = workInstructionListRef.current;
    if (!listElement) {
      setWorkInstructionListMaxHeight(null);
      return;
    }

    const firstCard = listElement.querySelector<HTMLElement>("[data-work-instruction-card='true']");
    if (!firstCard) {
      setWorkInstructionListMaxHeight(null);
      return;
    }

    const computedStyles = window.getComputedStyle(listElement);
    const rawGap = computedStyles.rowGap || computedStyles.gap || "0";
    const rowGap = Number.parseFloat(rawGap);
    const resolvedRowGap = Number.isFinite(rowGap) ? rowGap : 0;
    const maxHeight = firstCard.getBoundingClientRect().height * 10 + resolvedRowGap * 9 + 2;

    setWorkInstructionListMaxHeight(Math.ceil(maxHeight));
  }, [workInstructions.length, workInstructionsCollapsed]);

  useEffect(() => {
    syncWorkInstructionListMaxHeight();
  }, [syncWorkInstructionListMaxHeight]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onResize = () => syncWorkInstructionListMaxHeight();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [syncWorkInstructionListMaxHeight]);

  function toggleWorkInstructionSelection(instructionId: string, selected: boolean) {
    setWorkInstructionSelection((current) => ({
      ...current,
      [instructionId]: selected,
    }));
  }

  function selectAllWorkInstructions() {
    setWorkInstructionSelection(() => {
      const next: Record<string, boolean> = {};
      for (const instruction of workInstructions) {
        next[instruction.id] = true;
      }
      return next;
    });
  }

  function clearWorkInstructionSelection() {
    setWorkInstructionSelection({});
  }

  function openWorkInstructionActionConfirm(action: WorkInstructionConfirmAction) {
    const selectedInstructionIds = workInstructions
      .filter((instruction) => workInstructionSelection[instruction.id])
      .map((instruction) => instruction.id);

    if (selectedInstructionIds.length === 0) {
      setError("Select at least one work instruction first.");
      return;
    }

    const selectedById = new Map(
      workInstructions
        .filter((instruction) => selectedInstructionIds.includes(instruction.id))
        .map((instruction) => [instruction.id, instruction] as const),
    );

    const archiveInstructionIds = selectedInstructionIds.filter((instructionId) => {
      const instruction = selectedById.get(instructionId);
      if (!instruction) {
        return false;
      }

      return !instruction.isArchived;
    });
    const deleteInstructionIds = selectedInstructionIds.filter((instructionId) => {
      const instruction = selectedById.get(instructionId);
      if (!instruction) {
        return false;
      }

      return instruction.isArchived;
    });
    const requestedArchiveIds =
      action === "archive" || action === "archive_and_delete"
        ? archiveInstructionIds
        : [];
    const requestedDeleteIds =
      action === "permanent_delete" || action === "archive_and_delete"
        ? deleteInstructionIds
        : [];
    const requestedInstructionIds = new Set<string>([
      ...requestedArchiveIds,
      ...requestedDeleteIds,
    ]);

    const skippedInstructionIds = selectedInstructionIds.filter(
      (instructionId) => !requestedInstructionIds.has(instructionId),
    );

    const eligibleCount = requestedArchiveIds.length + requestedDeleteIds.length;
    if (
      action === "archive_and_delete" &&
      (requestedArchiveIds.length === 0 || requestedDeleteIds.length === 0)
    ) {
      setError(
        "Archive + Delete requires selecting at least one active and one archived instruction.",
      );
      return;
    }

    if (eligibleCount === 0) {
      if (action === "archive") {
        setError("All selected instructions are already archived.");
      } else if (action === "archive_and_delete") {
        setError(
          "Archive + Delete requires selecting at least one active and one archived instruction.",
        );
      } else {
        setError("Permanent delete only applies to archived instructions.");
      }
      return;
    }

    setError(null);
    setWorkInstructionActionConfirm({
      action,
      selectedInstructionIds,
      archiveInstructionIds: requestedArchiveIds,
      deleteInstructionIds: requestedDeleteIds,
      skippedInstructionIds,
    });
  }

  async function performWorkInstructionBulkAction() {
    if (!workInstructionActionConfirm) {
      return;
    }

    setWorkInstructionBusy(true);
    setError(null);
    setMessage(null);

    try {
      const headers = await getAuthHeaders();
      const callWorkInstructionBulkAction = async (
        action: WorkInstructionBulkAction,
        instructionIds: string[],
      ) => {
        if (instructionIds.length === 0) {
          return null;
        }

        const response = await fetch("/api/admin/work-instructions", {
          method: "POST",
          headers,
          body: JSON.stringify({
            action,
            instructionIds,
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as WorkInstructionBulkActionResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to update work instructions.");
        }

        return payload;
      };

      if (workInstructionActionConfirm.action === "archive") {
        const archivePayload = await callWorkInstructionBulkAction(
          "archive",
          workInstructionActionConfirm.archiveInstructionIds,
        );
        const archivedCount = archivePayload?.archiveInstructionIds?.length ?? 0;
        const skippedCount =
          (archivePayload?.skippedAlreadyArchivedIds?.length ?? 0) +
          (workInstructionActionConfirm.skippedInstructionIds.length ?? 0) +
          (archivePayload?.missingInstructionIds?.length ?? 0);
        setMessage(
          skippedCount > 0
            ? `Archived ${archivedCount} work instruction(s). Skipped ${skippedCount}.`
            : `Archived ${archivedCount} work instruction(s).`,
        );
      } else if (workInstructionActionConfirm.action === "permanent_delete") {
        const deletePayload = await callWorkInstructionBulkAction(
          "permanent_delete",
          workInstructionActionConfirm.deleteInstructionIds,
        );
        const deletedCount = deletePayload?.deleteInstructionIds?.length ?? 0;
        const skippedCount =
          (deletePayload?.skippedNotArchivedIds?.length ?? 0) +
          (workInstructionActionConfirm.skippedInstructionIds.length ?? 0) +
          (deletePayload?.missingInstructionIds?.length ?? 0);
        setMessage(
          skippedCount > 0
            ? `Permanently deleted ${deletedCount} work instruction(s). Skipped ${skippedCount}.`
            : `Permanently deleted ${deletedCount} work instruction(s).`,
        );
      } else {
        const archivePayload = await callWorkInstructionBulkAction(
          "archive",
          workInstructionActionConfirm.archiveInstructionIds,
        );
        const deletePayload = await callWorkInstructionBulkAction(
          "permanent_delete",
          workInstructionActionConfirm.deleteInstructionIds,
        );
        const archivedCount = archivePayload?.archiveInstructionIds?.length ?? 0;
        const deletedCount = deletePayload?.deleteInstructionIds?.length ?? 0;
        const skippedCount =
          (archivePayload?.skippedAlreadyArchivedIds?.length ?? 0) +
          (deletePayload?.skippedNotArchivedIds?.length ?? 0) +
          (archivePayload?.missingInstructionIds?.length ?? 0) +
          (deletePayload?.missingInstructionIds?.length ?? 0) +
          (workInstructionActionConfirm.skippedInstructionIds.length ?? 0);
        setMessage(
          skippedCount > 0
            ? `Archived ${archivedCount} and permanently deleted ${deletedCount} work instruction(s). Skipped ${skippedCount}.`
            : `Archived ${archivedCount} and permanently deleted ${deletedCount} work instruction(s).`,
        );
      }

      setWorkInstructionActionConfirm(null);
      clearWorkInstructionSelection();
      await fetchWorkInstructions();
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to update work instructions.";
      setError(normalizedMessage);
    } finally {
      setWorkInstructionBusy(false);
    }
  }

  const dirtyDepartments = departments.filter((department) => {
    const nameUpdate = departmentNameUpdates[department.id] ?? department.name;
    const colorUpdate = departmentColorUpdates[department.id] ?? department.color_hex;
    const nameDirty = nameUpdate.trim() !== department.name.trim();
    const savedColor = normalizeColorHex(department.color_hex) ?? DEFAULT_DEPARTMENT_COLORS[0];
    const currentColor = normalizeColorHex(colorUpdate) ?? DEFAULT_DEPARTMENT_COLORS[0];
    return nameDirty || currentColor !== savedColor;
  });
  const suggestedToolAlphabetOptions = useMemo(
    () => ["All", "#", ...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index))],
    [],
  );
  const filteredSuggestedTools = useMemo(() => {
    const normalizedSearch = suggestedToolSearch.trim().toLowerCase();

    return [...suggestedTools]
      .filter((tool) => {
        if (!showInactiveSuggestedTools && !tool.isActive) {
          return false;
        }

        if (
          suggestedToolAlphabetFilter !== "All" &&
          getToolAlphabetBucket(tool.name) !== suggestedToolAlphabetFilter
        ) {
          return false;
        }

        if (
          normalizedSearch &&
          !tool.name.trim().toLowerCase().includes(normalizedSearch)
        ) {
          return false;
        }

        return true;
      })
      .sort((first, second) => first.name.localeCompare(second.name));
  }, [
    showInactiveSuggestedTools,
    suggestedToolAlphabetFilter,
    suggestedToolSearch,
    suggestedTools,
  ]);
  const suggestedToolActiveCount = useMemo(
    () => suggestedTools.filter((tool) => tool.isActive).length,
    [suggestedTools],
  );
  const sortedWorkInstructions = useMemo(
    () =>
      [...workInstructions].sort((first, second) => {
        if (second.viewCount !== first.viewCount) {
          return second.viewCount - first.viewCount;
        }

        if (first.partId !== second.partId) {
          return first.partId.localeCompare(second.partId);
        }

        return first.itemTitle.localeCompare(second.itemTitle);
      }),
    [workInstructions],
  );
  const selectedWorkInstructionIds = useMemo(
    () =>
      sortedWorkInstructions
        .filter((instruction) => workInstructionSelection[instruction.id])
        .map((instruction) => instruction.id),
    [sortedWorkInstructions, workInstructionSelection],
  );
  const selectedWorkInstructionArchivedCount = useMemo(
    () =>
      sortedWorkInstructions.filter(
        (instruction) =>
          workInstructionSelection[instruction.id] && instruction.isArchived,
      ).length,
    [sortedWorkInstructions, workInstructionSelection],
  );
  const selectedWorkInstructionActiveCount =
    selectedWorkInstructionIds.length - selectedWorkInstructionArchivedCount;
  const allWorkInstructionsSelected =
    sortedWorkInstructions.length > 0 &&
    selectedWorkInstructionIds.length === sortedWorkInstructions.length;

  return (
    <div className="grid gap-5">
      {message ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-200">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">Instruction Review Window</h2>
          <button
            type="button"
            disabled={reviewSettingsBusy}
            onClick={() => {
              void fetchInstructionReviewSettings();
              setReviewActivityReloadToken((current) => current + 1);
            }}
            className="rounded-lg border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100/70 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800/70"
          >
            {reviewSettingsBusy ? "Working..." : "Reload"}
          </button>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Only instructions outside this range, or flagged Needs Review, appear in the
          dashboard review queue.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">
            <span>Days before re-check is required</span>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={3}
              value={reviewWindowDaysInput}
              onChange={(event) => {
                setReviewWindowDaysInput(event.target.value.replace(/\D/g, "").slice(0, 3));
                if (reviewWindowInputHasError) {
                  setReviewWindowInputHasError(false);
                }
              }}
              className={getInputClass(reviewWindowInputHasError)}
            />
          </label>

          <button
            type="button"
            disabled={reviewSettingsBusy}
            onClick={() => void saveInstructionReviewSettings()}
            className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {reviewSettingsBusy ? "Saving..." : "Save Review Window"}
          </button>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Active range: {reviewWindowDaysSaved} day
          {reviewWindowDaysSaved === 1 ? "" : "s"}.
          {reviewWindowUpdatedAt ? (
            <>
              {" "}
              Last updated <LocalDateTime value={reviewWindowUpdatedAt} mode="dateTime" />.
            </>
          ) : null}
        </p>

        <InstructionReviewActivityChart
          getAuthHeaders={getAuthHeaders}
          reloadToken={reviewActivityReloadToken}
        />
      </div>

      <div
        onClick={(event) => {
          if (isInteractiveClickTarget(event.target)) {
            return;
          }

          setWorkInstructionsCollapsed((current) => !current);
        }}
        className={cn(
          "grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7",
          "cursor-pointer",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setWorkInstructionsCollapsed((current) => !current)}
            className="flex items-center gap-1.5 text-lg font-bold transition hover:opacity-80"
          >
            {workInstructionsCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
            Work Instruction Management
          </button>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5 text-xs font-semibold text-cyan-800 dark:text-cyan-200">
              {sortedWorkInstructions.length} total
            </span>
            <button
              type="button"
              disabled={workInstructionBusy}
              onClick={() => void fetchWorkInstructions()}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300/70 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100/70 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800/70"
            >
              <RefreshCw size={12} className={workInstructionBusy ? "animate-spin" : ""} />
              Reload
            </button>
          </div>
        </div>

        {!workInstructionsCollapsed ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Prune instructions with bulk archive or permanent delete. The list includes active
            and archived instructions, sorted by total views.
          </p>
        ) : null}

        {!workInstructionsCollapsed ? (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-300/70 bg-white/70 p-3 text-xs dark:border-slate-700 dark:bg-slate-900/50">
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                Selected {selectedWorkInstructionIds.length}/{sortedWorkInstructions.length}
              </span>
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-200">
                {selectedWorkInstructionActiveCount} active
              </span>
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-200">
                {selectedWorkInstructionArchivedCount} archived
              </span>
              <button
                type="button"
                disabled={workInstructionBusy || sortedWorkInstructions.length === 0}
                onClick={() => {
                  if (allWorkInstructionsSelected) {
                    clearWorkInstructionSelection();
                  } else {
                    selectAllWorkInstructions();
                  }
                }}
                className="rounded-lg border border-slate-300/80 bg-white/80 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:bg-slate-800/70"
              >
                {allWorkInstructionsSelected ? "Clear Selection" : "Select All"}
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={workInstructionBusy || selectedWorkInstructionActiveCount === 0}
                onClick={() => openWorkInstructionActionConfirm("archive")}
                className="inline-flex items-center gap-1 rounded-xl border border-cyan-500/40 bg-cyan-500/12 px-3 py-1.5 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-cyan-100"
              >
                <Archive size={13} />
                Archive Selected ({selectedWorkInstructionActiveCount})
              </button>
              <button
                type="button"
                disabled={workInstructionBusy || selectedWorkInstructionArchivedCount === 0}
                onClick={() => openWorkInstructionActionConfirm("permanent_delete")}
                className="inline-flex items-center gap-1 rounded-xl border border-rose-500/45 bg-rose-500/12 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-200"
              >
                <Trash2 size={13} />
                Delete Permanently ({selectedWorkInstructionArchivedCount})
              </button>
              <button
                type="button"
                disabled={
                  workInstructionBusy ||
                  selectedWorkInstructionActiveCount === 0 ||
                  selectedWorkInstructionArchivedCount === 0
                }
                onClick={() => openWorkInstructionActionConfirm("archive_and_delete")}
                className="inline-flex items-center gap-1 rounded-xl border border-amber-500/45 bg-amber-500/12 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-amber-200"
              >
                <Archive size={13} />
                <Trash2 size={13} />
                Archive + Delete ({selectedWorkInstructionActiveCount}/
                {selectedWorkInstructionArchivedCount})
              </button>
            </div>

            {sortedWorkInstructions.length === 0 ? (
              <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                No work instructions found.
              </p>
            ) : (
              <div
                ref={workInstructionListRef}
                className={cn(
                  "grid gap-2",
                  sortedWorkInstructions.length > 10 ? "overflow-y-auto pr-1" : "",
                )}
                style={
                  workInstructionListMaxHeight !== null
                    ? { maxHeight: `${workInstructionListMaxHeight}px` }
                    : undefined
                }
              >
                {sortedWorkInstructions.map((instruction) => {
                  const selected = Boolean(workInstructionSelection[instruction.id]);
                  const isFork =
                    Boolean(instruction.forkRootInstructionId) &&
                    Number.isInteger(instruction.forkNumber) &&
                    Number(instruction.forkNumber) > 0;
                  const departmentSwatch =
                    normalizeColorHex(instruction.departmentColorHex ?? "") ??
                    DEFAULT_DEPARTMENT_COLORS[0];

                  return (
                    <div
                      key={instruction.id}
                      data-work-instruction-card="true"
                      className={cn(
                        "grid gap-1 rounded-xl border px-2.5 py-2 text-xs transition",
                        selected
                          ? "border-cyan-500/45 bg-cyan-500/10"
                          : "border-slate-300/70 bg-white/80 dark:border-slate-700 dark:bg-slate-900/60",
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <label className="inline-flex min-w-0 cursor-pointer items-start gap-2">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(event) =>
                              toggleWorkInstructionSelection(
                                instruction.id,
                                event.target.checked,
                              )
                            }
                            className="mt-[2px] h-4 w-4 rounded border-slate-400 text-cyan-600 focus:ring-cyan-500"
                          />
                          <span className="grid min-w-0 gap-0.5">
                            <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {instruction.partId} - {instruction.itemTitle}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: departmentSwatch }}
                              />
                              {instruction.departmentName}
                            </span>
                          </span>
                        </label>
                        <div className="flex flex-wrap items-center gap-1">
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              instruction.isArchived
                                ? "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-200"
                                : "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
                            )}
                          >
                            {instruction.isArchived ? "Archived" : "Active"}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-800 dark:text-cyan-100">
                            <Eye size={11} />
                            {instruction.viewCount.toLocaleString()} views
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                        <span>Rev {instruction.revision}</span>
                        {isFork ? <span>Fork #{instruction.forkNumber}</span> : null}
                        <span>
                          Updated <LocalDateTime value={instruction.updatedAt} mode="dateTime" />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : null}
      </div>

      <div
        onClick={(event) => {
          if (isInteractiveClickTarget(event.target)) {
            return;
          }

          setSuggestedToolsCollapsed((current) => !current);
        }}
        className={cn(
          "grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7",
          "cursor-pointer",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setSuggestedToolsCollapsed((current) => !current)}
            className="flex items-center gap-1.5 text-lg font-bold transition hover:opacity-80"
          >
            {suggestedToolsCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
            Common Tools
          </button>
          <span className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5 text-xs font-semibold text-cyan-800 dark:text-cyan-200">
            {suggestedToolActiveCount}/{suggestedTools.length}
          </span>
        </div>

        {!suggestedToolsCollapsed ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Manage the reusable common tools list used on instruction create, edit, and fork
            screens. Browse alphabetically, filter by name, and hide tools from future search.
          </p>
        ) : null}

        {!suggestedToolsCollapsed ? (
          <>
            {canCreateSuggestedToolTaxonomy ? (
              <form
                noValidate
                onSubmit={handleCreateSuggestedTool}
                className="grid gap-2 md:max-w-3xl md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
              >
                <label className="grid gap-1 text-sm">
                  <span>Add New Common Tool</span>
                  <input
                    value={newSuggestedToolName}
                    onChange={(event) => {
                      setNewSuggestedToolName(event.target.value);
                      if (newSuggestedToolNameHasError && event.target.value.trim()) {
                        setNewSuggestedToolNameHasError(false);
                      }
                    }}
                    placeholder="Torque wrench, caliper, bore scope..."
                    className={getInputClass(newSuggestedToolNameHasError)}
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {busy ? "Working..." : "Add Tool"}
                </button>
              </form>
            ) : (
              <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                You can browse common tools, but only editors can add new tools.
              </p>
            )}

            <div className="grid gap-2 rounded-2xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50">
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <label className="grid gap-1 text-sm">
                  <span>Filter by Name</span>
                  <input
                    value={suggestedToolSearch}
                    onChange={(event) => setSuggestedToolSearch(event.target.value)}
                    placeholder="Search common tools..."
                    className={getInputClass(false)}
                  />
                </label>
                <label className="inline-flex items-center gap-2 rounded-xl border border-slate-300/80 bg-white/80 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={showInactiveSuggestedTools}
                    onChange={(event) => setShowInactiveSuggestedTools(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-400 text-cyan-600 focus:ring-cyan-500"
                  />
                  Show Hidden
                </label>
              </div>

              <div className="flex flex-wrap gap-1">
                {suggestedToolAlphabetOptions.map((letter) => (
                  <button
                    key={letter}
                    type="button"
                    onClick={() => setSuggestedToolAlphabetFilter(letter)}
                    className={cn(
                      "rounded-lg border px-2 py-1 text-xs font-semibold transition",
                      suggestedToolAlphabetFilter === letter
                        ? "border-cyan-500/50 bg-cyan-500/20 text-cyan-800 dark:text-cyan-100"
                        : "border-slate-300/80 bg-white/80 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:bg-slate-800",
                    )}
                  >
                    {letter}
                  </button>
                ))}
              </div>
            </div>

            {filteredSuggestedTools.length === 0 ? (
              <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                No common tools match your filter.
              </p>
            ) : (
              <div className="grid gap-2">
                {filteredSuggestedTools.map((tool) => (
                  <div
                    key={tool.id}
                    className="grid gap-2 rounded-xl border border-slate-300/70 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/60 md:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="grid gap-1">
                      {editingSuggestedToolId === tool.id ? (
                        <input
                          value={editingSuggestedToolName}
                          onChange={(event) => {
                            setEditingSuggestedToolName(event.target.value);
                            if (editingSuggestedToolNameHasError && event.target.value.trim()) {
                              setEditingSuggestedToolNameHasError(false);
                            }
                          }}
                          className={getInputClass(editingSuggestedToolNameHasError)}
                        />
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {tool.name}
                          </p>
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              tool.isActive
                                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200"
                                : "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-200",
                            )}
                          >
                            {tool.isActive ? "Active" : "Hidden"}
                          </span>
                        </div>
                      )}
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Updated <LocalDateTime value={tool.updatedAt} mode="dateTime" />
                      </p>
                    </div>

                    {canManageSuggestedToolTaxonomy ? (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {editingSuggestedToolId === tool.id ? (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                void handleSaveSuggestedToolEdit(tool.id);
                              }}
                              className="rounded-lg border border-cyan-500/40 px-2.5 py-1 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-cyan-200"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setEditingSuggestedToolId(null);
                                setEditingSuggestedToolName("");
                                setEditingSuggestedToolNameHasError(false);
                              }}
                              className="rounded-lg border border-slate-400/45 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-200/70 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800/70"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setEditingSuggestedToolId(tool.id);
                              setEditingSuggestedToolName(tool.name);
                              setEditingSuggestedToolNameHasError(false);
                              setError(null);
                            }}
                            className="rounded-lg border border-cyan-500/35 px-2.5 py-1 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-cyan-200"
                          >
                            Edit
                          </button>
                        )}

                        {tool.isActive ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setConfirmDialog({
                                kind: "delete-suggested-tool",
                                toolId: tool.id,
                                title: `Hide common tool "${tool.name}"?`,
                                description:
                                  "This removes it from future common-tool searches. Existing instruction tool lists keep this entry.",
                                confirmLabel: "Hide Tool",
                              })
                            }
                            className="rounded-lg border border-rose-500/40 px-2.5 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-300"
                          >
                            Delete
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              void handleRestoreSuggestedTool(tool.id);
                            }}
                            className="rounded-lg border border-emerald-500/40 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-300"
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>

      <div
        onClick={(event) => {
          if (isInteractiveClickTarget(event.target)) {
            return;
          }

          setDepartmentsCollapsed((current) => !current);
        }}
        className={cn(
          "grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7",
          "cursor-pointer",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setDepartmentsCollapsed((v) => !v)}
            className="flex items-center gap-1.5 text-lg font-bold transition hover:opacity-80"
          >
            {departmentsCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
            Department Management
          </button>
          <div className="flex flex-wrap items-center gap-2">
            {dirtyDepartments.length >= 2 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirmDialog({
                    kind: "save-all-departments",
                    departmentIds: dirtyDepartments.map((d) => d.id),
                    title: `Save ${dirtyDepartments.length} department changes?`,
                    description: "The following departments have unsaved changes.",
                    confirmLabel: `Save All (${dirtyDepartments.length})`,
                  });
                }}
                className="rounded-lg border border-amber-500/45 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-300"
              >
                Save All ({dirtyDepartments.length})
              </button>
            )}
            <button
              type="button"
              disabled={busy || !departmentOrderDirty}
              onClick={() => void saveDepartmentOrder()}
              className="rounded-lg border border-cyan-500/35 px-3 py-1 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-cyan-200"
            >
              Save Order
            </button>
          </div>
        </div>
        {!departmentsCollapsed && (
          <p className="text-xs text-slate-500 dark:text-slate-300">
            Drag and drop to reorder, or double-click the order number to type a position.
            Press Enter to move. Esc or blur cancels.
          </p>
        )}

        {!departmentsCollapsed && (
        <form
          noValidate
          onSubmit={handleCreateDepartment}
          className="grid gap-2 md:max-w-2xl md:grid-cols-[minmax(0,1fr)_160px_auto] md:items-end"
        >
          <label className="grid flex-1 gap-1 text-sm">
            <span>Department Name</span>
            <input
              value={newDepartmentName}
              onChange={(event) => {
                setNewDepartmentName(event.target.value);
                if (newDepartmentNameHasError && event.target.value.trim()) {
                  setNewDepartmentNameHasError(false);
                }
              }}
              className={getInputClass(newDepartmentNameHasError)}
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span>Location Color</span>
            <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950">
              <input
                type="color"
                value={normalizeColorHex(newDepartmentColor) ?? DEFAULT_DEPARTMENT_COLORS[0]}
                onChange={(event) => {
                  setNewDepartmentColor(event.target.value.toUpperCase());
                  if (newDepartmentColorHasError) {
                    setNewDepartmentColorHasError(false);
                  }
                }}
                className="h-8 w-10 cursor-pointer rounded border border-slate-400 bg-transparent p-0"
              />
              <input
                value={newDepartmentColor}
                maxLength={7}
                onChange={(event) => {
                  setNewDepartmentColor(event.target.value.toUpperCase());
                  if (newDepartmentColorHasError) {
                    setNewDepartmentColorHasError(false);
                  }
                }}
                className={cn(
                  "w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs uppercase dark:border-slate-700 dark:bg-slate-950",
                  newDepartmentColorHasError ? "border-rose-500 ring-2 ring-rose-500/30" : "",
                )}
              />
            </div>
          </label>

          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy ? "Working..." : "Add Department"}
          </button>
        </form>
        )}

        {!departmentsCollapsed && (departments.length === 0 ? (
          <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
            No departments found.
          </p>
        ) : (
          <div className="grid gap-2">
            {departments.map((department, index) => {
              const departmentColor =
                normalizeColorHex(
                  departmentColorUpdates[department.id] ?? department.color_hex,
                ) ?? DEFAULT_DEPARTMENT_COLORS[0];
              const savedColor =
                normalizeColorHex(department.color_hex) ?? DEFAULT_DEPARTMENT_COLORS[0];
              const isDirty =
                (departmentNameUpdates[department.id] ?? department.name).trim() !==
                  department.name.trim() || departmentColor !== savedColor;
              const isFlashing = !!departmentSavedFlash[department.id];

              return (
                <div
                  key={department.id}
                  onDragEnter={() => {
                    if (draggedDepartmentId && draggedDepartmentId !== department.id) {
                      setDragOverDepartmentId(department.id);
                    }
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                  }}
                  onDragLeave={() => {
                    if (dragOverDepartmentId === department.id) {
                      setDragOverDepartmentId(null);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceDepartmentId =
                      draggedDepartmentId || event.dataTransfer.getData("text/plain");
                    setDragOverDepartmentId(null);
                    setDraggedDepartmentId(null);
                    if (sourceDepartmentId) {
                      reorderDepartments(sourceDepartmentId, department.id);
                    }
                  }}
                  style={{
                    borderColor: colorWithAlpha(departmentColor, 0.45),
                    backgroundColor: colorWithAlpha(departmentColor, 0.14),
                  }}
                  className={cn(
                    "flex flex-col gap-2 rounded-xl border p-3 transition md:flex-row md:items-center",
                    dragOverDepartmentId === department.id ? "ring-2 ring-cyan-500/35" : "",
                    draggedDepartmentId === department.id ? "opacity-70" : "",
                  )}
                >
                  <div
                    draggable={!busy}
                    onDragStart={(event) => {
                      setDraggedDepartmentId(department.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", department.id);
                    }}
                    onDragEnd={() => {
                      setDraggedDepartmentId(null);
                      setDragOverDepartmentId(null);
                    }}
                    className="flex cursor-grab items-center gap-1 text-slate-500 active:cursor-grabbing dark:text-slate-300"
                  >
                    <GripVertical size={16} />
                    {editingDepartmentOrderId === department.id ? (
                      <input
                        autoFocus
                        inputMode="numeric"
                        value={editingDepartmentOrderValue}
                        onChange={(event) =>
                          setEditingDepartmentOrderValue(
                            event.target.value.replace(/\D/g, "").slice(0, 3),
                          )
                        }
                        onBlur={cancelDepartmentOrderEdit}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitDepartmentOrderEdit(department.id);
                            return;
                          }

                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelDepartmentOrderEdit();
                          }
                        }}
                        className="w-10 rounded-md border border-cyan-500/45 bg-white px-1 py-0.5 text-center text-xs font-semibold text-slate-900 outline-none ring-2 ring-cyan-500/20 dark:bg-slate-950 dark:text-slate-100"
                        aria-label={`Order for ${department.name}`}
                      />
                    ) : (
                      <button
                        type="button"
                        onDoubleClick={() => startDepartmentOrderEdit(department.id, index + 1)}
                        className="w-6 rounded px-0.5 text-center text-xs font-semibold transition hover:bg-white/20"
                        title="Double-click to type order"
                      >
                        {index + 1}
                      </button>
                    )}
                  </div>

                  <div className="grid flex-1 gap-2 md:grid-cols-[minmax(0,1fr)_220px]">
                    <input
                      value={departmentNameUpdates[department.id] ?? department.name}
                      onChange={(event) => {
                        setDepartmentNameUpdates((current) => ({
                          ...current,
                          [department.id]: event.target.value,
                        }));

                        if (
                          departmentNameUpdateErrors[department.id] &&
                          event.target.value.trim()
                        ) {
                          setDepartmentNameUpdateErrors((current) => ({
                            ...current,
                            [department.id]: false,
                          }));
                        }
                      }}
                      className={cn(
                        "w-full rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950",
                        departmentNameUpdateErrors[department.id]
                          ? "border-rose-500 ring-2 ring-rose-500/30"
                          : "",
                      )}
                    />

                    <div className="grid gap-1 text-xs">
                      <span className="font-semibold text-slate-600 dark:text-slate-300">
                        Card Color
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={departmentColor}
                          onChange={(event) => {
                            const nextColor = event.target.value.toUpperCase();
                            setDepartmentColorUpdates((current) => ({
                              ...current,
                              [department.id]: nextColor,
                            }));

                            if (departmentColorUpdateErrors[department.id]) {
                              setDepartmentColorUpdateErrors((current) => ({
                                ...current,
                                [department.id]: false,
                              }));
                            }
                          }}
                          className="h-8 w-10 cursor-pointer rounded border border-slate-400 bg-transparent p-0"
                        />
                        <input
                          value={departmentColorUpdates[department.id] ?? department.color_hex}
                          maxLength={7}
                          onChange={(event) => {
                            const nextColor = event.target.value.toUpperCase();
                            setDepartmentColorUpdates((current) => ({
                              ...current,
                              [department.id]: nextColor,
                            }));

                            if (
                              departmentColorUpdateErrors[department.id] &&
                              normalizeColorHex(nextColor)
                            ) {
                              setDepartmentColorUpdateErrors((current) => ({
                                ...current,
                                [department.id]: false,
                              }));
                            }
                          }}
                          className={cn(
                            "w-full rounded-md border border-slate-300 bg-white px-2 py-1 uppercase dark:border-slate-700 dark:bg-slate-950",
                            departmentColorUpdateErrors[department.id]
                              ? "border-rose-500 ring-2 ring-rose-500/30"
                              : "",
                          )}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void updateDepartment(department.id)}
                      className={cn(
                        "rounded-lg border px-3 py-1 transition",
                        isFlashing
                          ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : isDirty
                            ? "border-amber-500/50 bg-amber-500/15 font-semibold text-amber-700 dark:text-amber-300"
                            : "border-cyan-500/30 text-cyan-700 hover:bg-cyan-500/10 dark:text-cyan-300",
                      )}
                    >
                      {isFlashing ? "Saved!" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmDialog({
                          kind: "delete-department",
                          departmentId: department.id,
                          title: `Delete department "${department.name}"?`,
                          description:
                            "This only works when no work instructions are assigned to it. If this department is in use, keep it and rename it.",
                          confirmLabel: "Delete Department",
                        })
                      }
                      className="rounded-lg border border-rose-500/40 px-3 py-1 text-rose-700 transition hover:bg-rose-500/10 dark:text-rose-300"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div
        onClick={(event) => {
          if (isInteractiveClickTarget(event.target)) {
            return;
          }

          setUsersCollapsed((current) => !current);
        }}
        className={cn(
          "grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:p-7",
          "cursor-pointer",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setUsersCollapsed((v) => !v)}
            className="flex items-center gap-1.5 text-lg font-bold transition hover:opacity-80"
          >
            {usersCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
            User Management
          </button>
        </div>

        {!usersCollapsed && (
          <div className="grid gap-5">
            <form
              noValidate
              onSubmit={handleCreateUser}
              className="grid gap-3 md:grid-cols-2"
            >
              <h2 className="col-span-full text-lg font-bold">Create User</h2>
        <label className="grid gap-1 text-sm">
          <span>Full Name</span>
          <input
            value={newName}
            onChange={(event) => {
              setNewName(event.target.value);
              if (createUserFieldErrors.fullName && event.target.value.trim()) {
                setCreateUserFieldErrors((current) => ({ ...current, fullName: false }));
              }
            }}
            className={getInputClass(createUserFieldErrors.fullName)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Email</span>
          <input
            type="email"
            value={newEmail}
            onChange={(event) => {
              setNewEmail(event.target.value);
              if (createUserFieldErrors.email && event.target.value.trim()) {
                setCreateUserFieldErrors((current) => ({ ...current, email: false }));
              }
            }}
            className={getInputClass(createUserFieldErrors.email)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Employee ID</span>
          <input
            inputMode="numeric"
            pattern="[0-9]{1,6}"
            maxLength={6}
            value={newEmployeeId}
            onChange={(event) => {
              const normalized = normalizeEmployeeId(event.target.value);
              setNewEmployeeId(normalized);
              if (createUserFieldErrors.employeeId && normalized) {
                setCreateUserFieldErrors((current) => ({ ...current, employeeId: false }));
              }
            }}
            className={getInputClass(createUserFieldErrors.employeeId)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>PIN (6 digits)</span>
          <PinInput
            value={newPin}
            onChange={(value) => {
              setNewPin(value);
              if (createUserFieldErrors.pin && value) {
                setCreateUserFieldErrors((current) => ({ ...current, pin: false }));
              }
            }}
            className={cn(
              "tracking-[0.3em]",
              createUserFieldErrors.pin ? "border-rose-500 ring-2 ring-rose-500/30" : "",
            )}
          />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          <span>Role</span>
          <select
            value={newRole}
            onChange={(event) => setNewRole(event.target.value as AppRole)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70 md:col-span-2"
        >
          {busy ? "Working..." : "Create User"}
        </button>
            </form>

            <div className="border-t border-slate-200/70 dark:border-slate-700/70" />

            <div className="overflow-hidden rounded-xl">
              <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/10 text-left dark:bg-white/10">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Employee ID</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Auto Sign Out</th>
                <th className="px-3 py-2">PIN Reset</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const employeeDraft = employeeIdUpdates[user.id] ?? user.employee_id ?? "";
                const employeeCurrent = user.employee_id ?? "";
                const employeeDirty = normalizeEmployeeId(employeeDraft) !== employeeCurrent;
                const employeeSavedFlash = Boolean(
                  userSettingSavedFlash[getUserSettingSavedKey(user.id, "employeeId")],
                );

                const roleDraft = roleUpdates[user.id] ?? user.role;
                const roleDirty = roleDraft !== user.role;
                const roleSavedFlash = Boolean(
                  userSettingSavedFlash[getUserSettingSavedKey(user.id, "role")],
                );

                const timeoutCurrent =
                  user.inactivity_timeout_minutes === null
                    ? "never"
                    : Number.isInteger(user.inactivity_timeout_minutes)
                      ? String(user.inactivity_timeout_minutes)
                      : "15";
                const timeoutDraft = inactivityTimeoutUpdates[user.id] ?? timeoutCurrent;
                const timeoutDirty =
                  timeoutDraft.trim().toLowerCase() !== timeoutCurrent.trim().toLowerCase();
                const timeoutSavedFlash = Boolean(
                  userSettingSavedFlash[getUserSettingSavedKey(user.id, "inactivityTimeout")],
                );

                const pinDraft = pinUpdates[user.id] ?? "";
                const pinDirty = pinDraft.trim().length > 0;
                const pinSavedFlash = Boolean(
                  userSettingSavedFlash[getUserSettingSavedKey(user.id, "pin")],
                );

                return (
                <tr key={user.id} className="border-t border-slate-200/70 dark:border-slate-800">
                  <td className="px-3 py-2 font-medium">{user.full_name}</td>
                  <td className="px-3 py-2">{user.email}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <input
                          value={employeeDraft}
                          onChange={(event) =>
                            setEmployeeIdUpdates((current) => ({
                              ...current,
                              [user.id]: normalizeEmployeeId(event.target.value),
                            }))
                          }
                          inputMode="numeric"
                          pattern="[0-9]{1,6}"
                          maxLength={6}
                          className={cn(
                            "rounded-lg border border-slate-300 bg-white px-2 py-1 transition dark:border-slate-700 dark:bg-slate-950",
                            employeeDirty
                              ? "border-emerald-500/55 ring-2 ring-emerald-500/20"
                              : "",
                          )}
                        />
                        <SavedRibbonOverlay visible={employeeSavedFlash} />
                      </div>
                      <button
                        type="button"
                        disabled={busy || !employeeDirty}
                        onClick={() => void updateEmployeeId(user.id)}
                        className={cn(
                          "rounded-lg border px-2 py-1 transition disabled:cursor-not-allowed disabled:opacity-60",
                          employeeDirty
                            ? "border-emerald-500/55 bg-emerald-500/15 font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                            : "border-cyan-500/30 text-cyan-700 hover:bg-cyan-500/10 dark:text-cyan-300",
                        )}
                      >
                        Save
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <select
                          value={roleDraft}
                          onChange={(event) =>
                            setRoleUpdates((current) => ({
                              ...current,
                              [user.id]: event.target.value as AppRole,
                            }))
                          }
                          className={cn(
                            "rounded-lg border border-slate-300 bg-white px-2 py-1 transition dark:border-slate-700 dark:bg-slate-950",
                            roleDirty
                              ? "border-emerald-500/55 ring-2 ring-emerald-500/20"
                              : "",
                          )}
                        >
                          {ROLE_OPTIONS.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                        <SavedRibbonOverlay visible={roleSavedFlash} />
                      </div>
                      <button
                        type="button"
                        disabled={busy || !roleDirty}
                        onClick={() => void updateRole(user.id)}
                        className={cn(
                          "rounded-lg border px-2 py-1 transition disabled:cursor-not-allowed disabled:opacity-60",
                          roleDirty
                            ? "border-emerald-500/55 bg-emerald-500/15 font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                            : "border-cyan-500/30 text-cyan-700 hover:bg-cyan-500/10 dark:text-cyan-300",
                        )}
                      >
                        Save
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <input
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={timeoutDraft}
                          onChange={(event) =>
                            setInactivityTimeoutUpdates((current) => ({
                              ...current,
                              [user.id]: event.target.value,
                            }))
                          }
                          placeholder="never or minutes"
                          className={cn(
                            "w-36 rounded-lg border border-slate-300 bg-white px-2 py-1 transition dark:border-slate-700 dark:bg-slate-950",
                            timeoutDirty
                              ? "border-emerald-500/55 ring-2 ring-emerald-500/20"
                              : "",
                          )}
                        />
                        <SavedRibbonOverlay visible={timeoutSavedFlash} />
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setInactivityTimeoutUpdates((current) => ({
                            ...current,
                            [user.id]: "never",
                          }))
                        }
                        className="rounded-lg border border-slate-400/45 px-2 py-1 text-slate-700 transition hover:bg-slate-500/10 dark:text-slate-200"
                      >
                        Never
                      </button>
                      <button
                        type="button"
                        disabled={busy || !timeoutDirty}
                        onClick={() => void updateInactivityTimeout(user.id)}
                        className={cn(
                          "rounded-lg border px-2 py-1 transition disabled:cursor-not-allowed disabled:opacity-60",
                          timeoutDirty
                            ? "border-emerald-500/55 bg-emerald-500/15 font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                            : "border-cyan-500/30 text-cyan-700 hover:bg-cyan-500/10 dark:text-cyan-300",
                        )}
                      >
                        Save
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <PinInput
                          value={pinDraft}
                          onChange={(value) =>
                            setPinUpdates((current) => ({
                              ...current,
                              [user.id]: value,
                            }))
                          }
                          className={cn(
                            "w-28 rounded-lg px-2 py-1 tracking-[0.25em] transition",
                            pinDirty ? "border-emerald-500/55 ring-2 ring-emerald-500/20" : "",
                          )}
                        />
                        <SavedRibbonOverlay visible={pinSavedFlash} />
                      </div>
                      <button
                        type="button"
                        disabled={busy || !pinDirty}
                        onClick={() => void updatePin(user.id)}
                        className={cn(
                          "rounded-lg border px-2 py-1 transition disabled:cursor-not-allowed disabled:opacity-60",
                          pinDirty
                            ? "border-emerald-500/55 bg-emerald-500/15 font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                            : "border-cyan-500/30 text-cyan-700 hover:bg-cyan-500/10 dark:text-cyan-300",
                        )}
                      >
                        Set PIN
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <LocalDateTime value={user.created_at} mode="date" />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={busy || currentUserId === user.id}
                      onClick={() =>
                        setConfirmDialog({
                          kind: "delete-user",
                          userId: user.id,
                          title: `Delete user ${user.email}?`,
                          description: "This permanently removes their account.",
                          confirmLabel: "Delete User",
                        })
                      }
                      className="rounded-lg border border-rose-500/40 px-2 py-1 text-rose-700 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-300"
                      title={
                        currentUserId === user.id
                          ? "You cannot delete your own account."
                          : undefined
                      }
                    >
                      Delete User
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        @keyframes userSettingSavedRibbonSweep {
          0% {
            transform: translateX(-52%);
            opacity: 0;
          }
          14% {
            opacity: 1;
          }
          65% {
            opacity: 1;
          }
          100% {
            transform: translateX(52%);
            opacity: 0;
          }
        }

        .user-setting-saved-ribbon-layer {
          animation: userSettingSavedRibbonSweep 2.2s cubic-bezier(0.2, 0.9, 0.25, 1) forwards;
          filter: saturate(1.15);
        }

        @keyframes userSettingSavedRibbonTextSweep {
          0% {
            transform: translateX(-52%);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          82% {
            opacity: 1;
          }
          100% {
            transform: translateX(52%);
            opacity: 0;
          }
        }

        .user-setting-saved-ribbon-text {
          animation: userSettingSavedRibbonTextSweep 4.95s cubic-bezier(0.2, 0.9, 0.25, 1)
            forwards;
          text-shadow: 0 1px 0 rgba(255, 255, 255, 0.35);
        }
      `}</style>

      {workInstructionActionConfirm && portalReady
        ? createPortal(
            <div
              className="app-modal-shell fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm dark:bg-slate-950/70"
              role="presentation"
              onClick={() => setWorkInstructionActionConfirm(null)}
            >
              <article
                role="dialog"
                aria-modal="true"
                aria-label="Confirm work instruction action"
                onClick={(event) => event.stopPropagation()}
                className="grid w-full max-w-md gap-4 rounded-2xl border border-slate-300/80 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-950"
              >
                <div className="grid gap-1">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {workInstructionActionConfirm.action === "archive"
                      ? "Archive selected work instructions?"
                      : workInstructionActionConfirm.action === "permanent_delete"
                        ? "Permanently delete selected work instructions?"
                        : "Archive active and delete archived instructions?"}
                  </h3>
                  {workInstructionActionConfirm.action === "archive_and_delete" ? (
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      Active selections will be archived; archived selections will be permanently
                      deleted.
                    </p>
                  ) : null}
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    Selected: {workInstructionActionConfirm.selectedInstructionIds.length}. Will
                    archive: {workInstructionActionConfirm.archiveInstructionIds.length}. Will
                    delete: {workInstructionActionConfirm.deleteInstructionIds.length}.
                  </p>
                  {workInstructionActionConfirm.skippedInstructionIds.length > 0 ? (
                    <p className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-200">
                      {workInstructionActionConfirm.skippedInstructionIds.length} selected
                      instruction(s) will be skipped due to status rules.
                    </p>
                  ) : null}
                  {workInstructionActionConfirm.action !== "archive" ? (
                    <p className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-2 text-xs text-rose-700 dark:text-rose-200">
                      Permanent delete removes records from the database and cannot be undone.
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setWorkInstructionActionConfirm(null)}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={workInstructionBusy}
                    onClick={() => void performWorkInstructionBulkAction()}
                    className={cn(
                      "rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-70",
                      workInstructionActionConfirm.action === "archive"
                        ? "border-cyan-500/45 bg-cyan-500/15 text-cyan-800 hover:bg-cyan-500/25 dark:text-cyan-100"
                        : workInstructionActionConfirm.action === "permanent_delete"
                          ? "border-rose-500/45 bg-rose-500/15 text-rose-700 hover:bg-rose-500/25 dark:text-rose-100"
                          : "border-amber-500/45 bg-amber-500/15 text-amber-800 hover:bg-amber-500/25 dark:text-amber-100",
                    )}
                  >
                    {workInstructionBusy
                      ? "Working..."
                      : workInstructionActionConfirm.action === "archive"
                        ? "Archive Selected"
                        : workInstructionActionConfirm.action === "permanent_delete"
                          ? "Delete Permanently"
                          : "Archive + Delete"}
                  </button>
                </div>
              </article>
            </div>,
            document.body,
          )
        : null}

      {confirmDialog && portalReady
        ? createPortal(
            <div className="app-modal-shell fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
              <div
                className={cn(
                  "grid w-full max-w-md gap-4 rounded-2xl border p-5 shadow-2xl",
                  confirmDialog.kind === "save-all-departments"
                    ? "border-cyan-500/40 bg-slate-950/95"
                    : "border-rose-500/40 bg-slate-950/95",
                )}
              >
                <div className="grid gap-1">
                  <h3 className="text-lg font-bold text-slate-100">{confirmDialog.title}</h3>
                  <p className="text-sm text-slate-300">{confirmDialog.description}</p>
                  {confirmDialog.kind === "save-all-departments" && (
                    <ul className="mt-2 grid gap-1.5">
                      {confirmDialog.departmentIds.map((id) => {
                        const dept = departments.find((d) => d.id === id);
                        if (!dept) return null;
                        const newName = (departmentNameUpdates[id] ?? dept.name).trim();
                        const newColor =
                          normalizeColorHex(departmentColorUpdates[id] ?? dept.color_hex) ??
                          DEFAULT_DEPARTMENT_COLORS[0];
                        const nameChanged = newName !== dept.name.trim();
                        const colorChanged =
                          newColor !==
                          (normalizeColorHex(dept.color_hex) ?? DEFAULT_DEPARTMENT_COLORS[0]);
                        return (
                          <li key={id} className="flex items-center gap-2 text-xs text-slate-300">
                            <span
                              className="h-3 w-3 flex-shrink-0 rounded-full"
                              style={{ backgroundColor: newColor }}
                            />
                            <span>
                              {nameChanged ? (
                                <>
                                  <span className="opacity-50 line-through">{dept.name}</span>
                                  {" -> "}
                                  <span className="font-semibold text-slate-100">{newName}</span>
                                </>
                              ) : (
                                <span>{dept.name}</span>
                              )}
                              {colorChanged && (
                                <span className="ml-1 text-amber-400">(color changed)</span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDialog(null)}
                    className="rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void confirmDialogAction()}
                    className={cn(
                      "rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
                      confirmDialog.kind === "save-all-departments"
                        ? "border-cyan-500/45 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
                        : "border-rose-500/45 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25",
                    )}
                  >
                    {busy ? "Working..." : confirmDialog.confirmLabel}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

