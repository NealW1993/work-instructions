import type { AppRole } from "@/lib/types";

/*
 * Who may create and maintain accounts: system admins only.
 *
 * System admins list accounts, create them, change roles, reset PINs and employee IDs, change
 * sign-out timeouts, and deactivate or delete accounts (the last active system admin stays protected
 * in the database). Admins and users cannot manage or list accounts. Admins keep their other
 * administration tools, such as departments, quality metrics and exports.
 */
export function canManageAccounts(requesterRole: AppRole): boolean {
  return requesterRole === "system_admin";
}

export const ACCOUNT_MANAGEMENT_DENIED = "Only a system admin can create or change user accounts.";
