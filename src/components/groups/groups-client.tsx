"use client";

import { CheckCircle2, Loader2, Plus, UserPlus, UsersRound, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { DisclosureSection } from "@/components/ui/disclosure-section";
import { FloatingStatusNotices } from "@/components/ui/floating-status-notices";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

export interface AccessGroupItem {
  id: string;
  name: string;
  slug: string;
  description: string;
  member_count: number;
  is_member: boolean;
  pending_request_id: string | null;
}

export interface AccessGroupJoinRequestItem {
  id: string;
  group_id: string;
  group_name: string;
  requester_user_id: string;
  requester_name: string;
  request_note: string;
  created_at: string;
}

export interface AccessGroupProfileOption {
  id: string;
  full_name: string;
  email: string;
}

interface GroupsClientProps {
  groups: AccessGroupItem[];
  pendingRequests: AccessGroupJoinRequestItem[];
  profiles: AccessGroupProfileOption[];
  isSystemAdmin: boolean;
  canApproveRequests: boolean;
  loadFailed?: boolean;
}

export function GroupsClient({
  groups,
  pendingRequests,
  profiles,
  isSystemAdmin,
  canApproveRequests,
  loadFailed = false,
}: GroupsClientProps) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState(groups[0]?.id ?? "");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actionInFlight = useRef(false);
  const [query, setQuery] = useState("");
  const [membershipFilter, setMembershipFilter] = useState("all");
  const [visibleCount, setVisibleCount] = useState(12);
  const filteredGroups = groups.filter((group) =>
    (membershipFilter !== "mine" || group.is_member) &&
    `${group.name} ${group.description}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const activeGroupId = groups.some((group) => group.id === selectedGroupId) ? selectedGroupId : groups[0]?.id ?? "";

  async function getAuthHeaders() {
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
  }

  async function runAction(key: string, action: () => Promise<string>) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusyKey(key);
    setError(null);
    setMessage(null);

    try {
      const nextMessage = await action();
      setMessage(nextMessage);
      router.refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Action failed.");
    } finally {
      actionInFlight.current = false;
      setBusyKey(null);
    }
  }

  async function createGroup() {
    await runAction("create-group", async () => {
      const response = await fetch("/api/groups", {
        method: "POST",
        headers: await getAuthHeaders(),
        body: JSON.stringify({ name: groupName, description: groupDescription }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to create group.");
      }
      setGroupName("");
      setGroupDescription("");
      return "Group created.";
    });
  }

  async function requestJoin(groupId: string) {
    await runAction(`join:${groupId}`, async () => {
      const response = await fetch(`/api/groups/${groupId}/join-requests`, {
        method: "POST",
        headers: await getAuthHeaders(),
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to request group access.");
      }
      return "Join request submitted.";
    });
  }

  async function decideRequest(requestId: string, status: "approved" | "rejected") {
    await runAction(`${status}:${requestId}`, async () => {
      const response = await fetch(`/api/groups/join-requests/${requestId}`, {
        method: "PATCH",
        headers: await getAuthHeaders(),
        body: JSON.stringify({ status }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update request.");
      }
      return status === "approved" ? "Join request approved." : "Join request rejected.";
    });
  }

  async function assignMember() {
    if (!activeGroupId || !selectedUserId) {
      setError("Choose a group and user.");
      return;
    }

    await runAction("assign-member", async () => {
      const response = await fetch(`/api/groups/${activeGroupId}/members`, {
        method: "POST",
        headers: await getAuthHeaders(),
        body: JSON.stringify({ userId: selectedUserId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to assign user.");
      }
      setSelectedUserId("");
      return "User assigned to group.";
    });
  }

  return (
    <div className="grid gap-4">
      <FloatingStatusNotices
        notices={[
          message && {
            id: "groups-message",
            tone: "success",
            message,
            onDismiss: () => setMessage(null),
          },
          error && {
            id: "groups-error",
            tone: "error",
            message: error,
            onDismiss: () => setError(null),
          },
        ]}
      />
      <header className="rounded-2xl border border-white/30 bg-white/80 p-5 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-950 dark:text-slate-50">
              Groups
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Request access, approve group membership, and assign users to controlled-document groups.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-500/35 bg-cyan-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-cyan-800 dark:text-cyan-100">
            <UsersRound size={14} />
            {groups.length} groups
          </span>
        </div>
      </header>

      {loadFailed ? <p role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200">Some group information could not be loaded. Refresh the page to retry before changing memberships.</p> : null}

      <div className={cn("grid items-start gap-4", isSystemAdmin || canApproveRequests ? "xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]" : "")}>
        <section className="grid content-start gap-3 rounded-2xl border border-slate-300/70 bg-white/85 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/75">
          <h2 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">
            Available Groups
          </h2>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input type="search" aria-label="Search groups" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(12); }} placeholder="Find a group…" className="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
            <select aria-label="Group membership filter" value={membershipFilter} onChange={(event) => { setMembershipFilter(event.target.value); setVisibleCount(12); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="all">All groups</option><option value="mine">My groups</option></select>
          </div>
          <p role="status" className="text-xs text-slate-500 dark:text-slate-400">{filteredGroups.length} group{filteredGroups.length === 1 ? "" : "s"}</p>
          <div className="grid items-start gap-3 md:grid-cols-2">
            {filteredGroups.slice(0, visibleCount).map((group) => (
              <article
                key={group.id}
                className="grid content-start gap-3 rounded-xl border border-slate-300/70 bg-white/75 p-4 dark:border-slate-700 dark:bg-slate-900/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 title={group.name} className="break-words font-semibold text-slate-950 dark:text-slate-50">
                      {group.name}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {group.member_count} member{group.member_count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      group.is_member
                        ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                        : group.pending_request_id
                          ? "border-amber-500/45 bg-amber-500/15 text-amber-800 dark:text-amber-200"
                          : "border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-300",
                    )}
                  >
                    {group.is_member ? "Member" : group.pending_request_id ? "Pending" : "Open"}
                  </span>
                </div>
                {group.description ? (
                  <p className="text-sm text-slate-600 dark:text-slate-300">{group.description}</p>
                ) : null}
                {!group.is_member && !group.pending_request_id ? (
                  <button
                    type="button"
                    disabled={busyKey !== null || loadFailed}
                    onClick={() => void requestJoin(group.id)}
                    className="inline-flex w-fit items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-cyan-100"
                  >
                    {busyKey === `join:${group.id}` ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <UserPlus size={14} />
                    )}
                    Request to Join
                  </button>
                ) : null}
              </article>
            ))}
          </div>
          {filteredGroups.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">{groups.length === 0 ? "No groups have been created yet." : "No groups match your search and membership filter."}</p> : null}
          {filteredGroups.length > visibleCount ? <button type="button" onClick={() => setVisibleCount((count) => count + 12)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700">Show more groups</button> : null}
        </section>

        <aside className="grid h-fit gap-4">
          {isSystemAdmin ? (
            <DisclosureSection title="Create group" description="Organize controlled content access.">
              <input
                aria-label="New group name"
                maxLength={120}
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Group name"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
              />
              <textarea
                aria-label="Group description"
                value={groupDescription}
                onChange={(event) => setGroupDescription(event.target.value)}
                placeholder="Description"
                rows={3}
                className="resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
              />
              <button
                type="button"
                disabled={busyKey !== null || loadFailed || !groupName.trim()}
                onClick={() => void createGroup()}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-cyan-100"
              >
                {busyKey === "create-group" ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                Create Group
              </button>
            </DisclosureSection>
          ) : null}

          {isSystemAdmin ? (
            <DisclosureSection title="Assign user" description="Grant a user membership in a group.">
              <select
                aria-label="Group to assign"
                value={activeGroupId}
                onChange={(event) => setSelectedGroupId(event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="User to assign"
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="">Choose user</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.full_name || profile.email}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busyKey !== null || loadFailed || !activeGroupId || !selectedUserId}
                onClick={() => void assignMember()}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-100"
              >
                {busyKey === "assign-member" ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
                Assign
              </button>
            </DisclosureSection>
          ) : null}

          {canApproveRequests ? (
            <section className="grid gap-3 rounded-2xl border border-slate-300/70 bg-white/85 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/75">
              <h2 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">
                Pending Requests
              </h2>
              {pendingRequests.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No pending requests.</p>
              ) : (
                <div className="grid gap-2">
                  {pendingRequests.map((request) => (
                    <article
                      key={request.id}
                      className="grid gap-2 rounded-lg border border-slate-300/70 bg-white/70 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/50"
                    >
                      <div>
                        <p className="font-bold text-slate-950 dark:text-slate-50">
                          {request.requester_name}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {request.group_name}
                        </p>
                      </div>
                      {request.request_note ? (
                        <p className="text-xs text-slate-600 dark:text-slate-300">
                          {request.request_note}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busyKey !== null || loadFailed}
                          onClick={() => void decideRequest(request.id, "approved")}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-100"
                        >
                          <CheckCircle2 size={13} />
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={busyKey !== null || loadFailed}
                          onClick={() => void decideRequest(request.id, "rejected")}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-800 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-100"
                        >
                          <XCircle size={13} />
                          Reject
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
