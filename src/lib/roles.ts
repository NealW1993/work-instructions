import type { AppRole } from "@/lib/types";

const FULL_ACCESS_ROLES: AppRole[] = ["admin", "system_admin"];

export function canEditInstructions(role: AppRole): boolean {
  return hasFullAccess(role);
}

export function canCreateInstructions(role: AppRole): boolean {
  return role === "user" || hasFullAccess(role);
}

export function canCreateControlledDocuments(role: AppRole): boolean {
  return role === "user" || hasFullAccess(role);
}

export function canApproveControlledDocuments(role: AppRole): boolean {
  return hasFullAccess(role);
}

export function hasFullAccess(role: AppRole): boolean {
  return FULL_ACCESS_ROLES.includes(role);
}

export function isSystemAdmin(role: AppRole): boolean {
  return role === "system_admin";
}

export function canViewKpis(role: AppRole): boolean {
  return hasFullAccess(role);
}

export function accessLevelLabel(role: AppRole): string {
  return hasFullAccess(role) ? "Full Access" : "Read Only";
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
