"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

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
  created_at: string;
}

interface AdminDepartment {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface CreateUserFieldErrors {
  fullName: boolean;
  email: boolean;
  employeeId: boolean;
  password: boolean;
  pin: boolean;
}

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
    };

const ROLE_OPTIONS: AppRole[] = ["user", "admin", "system_admin"];

const DEFAULT_CREATE_USER_FIELD_ERRORS: CreateUserFieldErrors = {
  fullName: false,
  email: false,
  employeeId: false,
  password: false,
  pin: false,
};

function getInputClass(hasError: boolean) {
  return cn(
    "rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950",
    hasError ? "border-rose-500 ring-2 ring-rose-500/30" : "",
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

  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [newDepartmentNameHasError, setNewDepartmentNameHasError] = useState(false);
  const [departmentNameUpdates, setDepartmentNameUpdates] = useState<
    Record<string, string>
  >({});
  const [departmentNameUpdateErrors, setDepartmentNameUpdateErrors] = useState<
    Record<string, boolean>
  >({});

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newEmployeeId, setNewEmployeeId] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("user");
  const [createUserFieldErrors, setCreateUserFieldErrors] = useState<CreateUserFieldErrors>(
    DEFAULT_CREATE_USER_FIELD_ERRORS,
  );

  const [pinUpdates, setPinUpdates] = useState<Record<string, string>>({});
  const [roleUpdates, setRoleUpdates] = useState<Record<string, AppRole>>({});
  const [employeeIdUpdates, setEmployeeIdUpdates] = useState<Record<string, string>>({});
  const [portalReady, setPortalReady] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

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

      setDepartments(payload.departments ?? []);
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to load departments";
      setError(normalizedMessage);
    } finally {
      setBusy(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    void (async () => {
      await Promise.all([fetchUsers(), fetchDepartments()]);
    })();
  }, [fetchDepartments, fetchUsers]);

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      setCurrentUserId(user?.id ?? null);
    })();
  }, [supabase]);

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
      const normalizedPassword = newPassword.trim();
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

      if (normalizedPassword.length < 8) {
        setCreateUserFieldErrors((current) => ({ ...current, password: true }));
        throw new Error("Password must be at least 8 characters.");
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
          password: normalizedPassword,
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
      setNewPassword("");
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
      setEmployeeIdUpdates((current) => ({
        ...current,
        [userId]: employeeId,
      }));
      await fetchUsers();
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to update employee ID";
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

    try {
      const name = newDepartmentName.trim();
      if (!name) {
        setNewDepartmentNameHasError(true);
        throw new Error("Department name is required.");
      }

      const headers = await getAuthHeaders();
      const response = await fetch("/api/departments", {
        method: "POST",
        headers,
        body: JSON.stringify({ name }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to create department.");
      }

      setMessage("Department created.");
      setNewDepartmentName("");
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

    try {
      const rawName =
        departmentNameUpdates[departmentId] ??
        departments.find((department) => department.id === departmentId)?.name ??
        "";
      const name = rawName.trim();

      if (!name) {
        setDepartmentNameUpdateErrors((current) => ({
          ...current,
          [departmentId]: true,
        }));
        throw new Error("Department name is required.");
      }

      const headers = await getAuthHeaders();
      const response = await fetch(`/api/departments/${departmentId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ name }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update department.");
      }

      setMessage(
        "Department renamed. Associated work instructions now show the new department name.",
      );
      await fetchDepartments();
    } catch (caughtError) {
      const normalizedMessage =
        caughtError instanceof Error ? caughtError.message : "Unable to update department";
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

  async function confirmDialogAction() {
    if (!confirmDialog) {
      return;
    }

    if (confirmDialog.kind === "delete-user") {
      await performDeleteUser(confirmDialog.userId);
      return;
    }

    await performDeleteDepartment(confirmDialog.departmentId);
  }

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
        <h2 className="text-lg font-bold">Departments</h2>
        <p className="text-xs text-slate-500 dark:text-slate-300">
          Departments can always be renamed, even when instructions already use them.
        </p>

        <form
          noValidate
          onSubmit={handleCreateDepartment}
          className="flex flex-col gap-2 md:max-w-lg md:flex-row md:items-end"
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
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy ? "Working..." : "Add Department"}
          </button>
        </form>

        {departments.length === 0 ? (
          <p className="rounded-2xl border border-slate-300/70 bg-white/70 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
            No departments found.
          </p>
        ) : (
          <div className="grid gap-2">
            {departments.map((department) => (
              <div
                key={department.id}
                className="flex flex-col gap-2 rounded-xl border border-slate-300/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-950/70 md:flex-row md:items-center"
              >
                <input
                  value={departmentNameUpdates[department.id] ?? department.name}
                  onChange={(event) => {
                    setDepartmentNameUpdates((current) => ({
                      ...current,
                      [department.id]: event.target.value,
                    }));

                    if (departmentNameUpdateErrors[department.id] && event.target.value.trim()) {
                      setDepartmentNameUpdateErrors((current) => ({
                        ...current,
                        [department.id]: false,
                      }));
                    }
                  }}
                  className={cn(
                    "w-full rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950 md:max-w-md",
                    departmentNameUpdateErrors[department.id]
                      ? "border-rose-500 ring-2 ring-rose-500/30"
                      : "",
                  )}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void updateDepartment(department.id)}
                    className="rounded-lg border border-cyan-500/30 px-3 py-1 text-cyan-700 transition hover:bg-cyan-500/10 dark:text-cyan-300"
                  >
                    Save
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
            ))}
          </div>
        )}
      </div>

      <form
        noValidate
        onSubmit={handleCreateUser}
        className="grid gap-3 rounded-3xl border border-white/30 bg-white/80 p-5 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 md:grid-cols-2 md:p-7"
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
          <span>Password</span>
          <input
            minLength={8}
            type="password"
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
              if (createUserFieldErrors.password && event.target.value.trim()) {
                setCreateUserFieldErrors((current) => ({ ...current, password: false }));
              }
            }}
            className={getInputClass(createUserFieldErrors.password)}
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

      <div className="overflow-hidden rounded-3xl border border-white/30 bg-white/80 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/10 text-left dark:bg-white/10">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Employee ID</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">PIN Reset</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-slate-200/70 dark:border-slate-800">
                  <td className="px-3 py-2 font-medium">{user.full_name}</td>
                  <td className="px-3 py-2">{user.email}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={employeeIdUpdates[user.id] ?? user.employee_id ?? ""}
                        onChange={(event) =>
                          setEmployeeIdUpdates((current) => ({
                            ...current,
                            [user.id]: normalizeEmployeeId(event.target.value),
                          }))
                        }
                        inputMode="numeric"
                        pattern="[0-9]{1,6}"
                        maxLength={6}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
                      />
                      <button
                        type="button"
                        onClick={() => void updateEmployeeId(user.id)}
                        className="rounded-lg border border-cyan-500/30 px-2 py-1 text-cyan-700 transition hover:bg-cyan-500/10 dark:text-cyan-300"
                      >
                        Save
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={roleUpdates[user.id] ?? user.role}
                        onChange={(event) =>
                          setRoleUpdates((current) => ({
                            ...current,
                            [user.id]: event.target.value as AppRole,
                          }))
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void updateRole(user.id)}
                        className="rounded-lg border border-cyan-500/30 px-2 py-1 text-cyan-700 transition hover:bg-cyan-500/10 dark:text-cyan-300"
                      >
                        Save
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <PinInput
                        value={pinUpdates[user.id] ?? ""}
                        onChange={(value) =>
                          setPinUpdates((current) => ({
                            ...current,
                            [user.id]: value,
                          }))
                        }
                        className="w-28 rounded-lg px-2 py-1 tracking-[0.25em]"
                      />
                      <button
                        type="button"
                        onClick={() => void updatePin(user.id)}
                        className="rounded-lg border border-cyan-500/30 px-2 py-1 text-cyan-700 transition hover:bg-cyan-500/10 dark:text-cyan-300"
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
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {confirmDialog && portalReady
        ? createPortal(
            <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
              <div className="grid w-full max-w-md gap-4 rounded-2xl border border-rose-500/40 bg-slate-950/95 p-5 shadow-2xl">
                <div className="grid gap-1">
                  <h3 className="text-lg font-bold text-slate-100">{confirmDialog.title}</h3>
                  <p className="text-sm text-slate-300">{confirmDialog.description}</p>
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
                    className="rounded-xl border border-rose-500/45 bg-rose-500/15 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-60"
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
