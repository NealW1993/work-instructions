import type { AppRole } from "@/lib/types";

const EDITOR_ROLES: AppRole[] = ["admin", "system_admin"];

export function canEditInstructions(role: AppRole): boolean {
  return EDITOR_ROLES.includes(role);
}

export function isSystemAdmin(role: AppRole): boolean {
  return role === "system_admin";
}

export function canViewKpis(role: AppRole): boolean {
  return role === "admin" || role === "system_admin";
}

export function roleLabel(role: AppRole): string {
  if (role === "system_admin") {
    return "System Admin";
  }

  if (role === "admin") {
    return "Admin";
  }

  return "User";
}
