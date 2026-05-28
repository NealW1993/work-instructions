import { GroupsClient } from "@/components/groups/groups-client";
import type {
  AccessGroupItem,
  AccessGroupJoinRequestItem,
  AccessGroupProfileOption,
} from "@/components/groups/groups-client";
import { requireAuthenticatedUser } from "@/lib/auth";
import { hasFullAccess, isSystemAdmin } from "@/lib/roles";

interface AccessGroupRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

interface MembershipRow {
  group_id: string;
  user_id: string;
}

interface JoinRequestRow {
  id: string;
  group_id: string;
  requester_user_id: string;
  request_note: string | null;
  created_at: string;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
}

export default async function GroupsPage() {
  const { supabase, profile } = await requireAuthenticatedUser();
  const canApproveRequests = hasFullAccess(profile.role);
  const [
    { data: groupRows },
    { data: membershipRows },
    { data: joinRequestRows },
    { data: profileRows },
  ] = await Promise.all([
    supabase
      .from("access_groups")
      .select("id, name, slug, description")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("access_group_memberships")
      .select("group_id, user_id")
      .range(0, 9999),
    supabase
      .from("access_group_join_requests")
      .select("id, group_id, requester_user_id, request_note, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .range(0, 9999),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
  ]);

  const memberships = (membershipRows ?? []) as MembershipRow[];
  const pendingRequests = (joinRequestRows ?? []) as JoinRequestRow[];
  const profiles = ((profileRows ?? []) as ProfileRow[]).map(
    (entry): AccessGroupProfileOption => ({
      id: entry.id,
      full_name: entry.full_name ?? "",
      email: entry.email ?? "",
    }),
  );
  const profileNameById = new Map(
    profiles.map((entry) => [entry.id, entry.full_name || entry.email || "Unknown"]),
  );
  const groupNameById = new Map(
    ((groupRows ?? []) as AccessGroupRow[]).map((group) => [group.id, group.name]),
  );
  const userGroupIds = new Set(
    memberships
      .filter((membership) => membership.user_id === profile.id)
      .map((membership) => membership.group_id),
  );
  const pendingRequestByGroupId = new Map(
    pendingRequests
      .filter((request) => request.requester_user_id === profile.id)
      .map((request) => [request.group_id, request.id]),
  );

  const groups = ((groupRows ?? []) as AccessGroupRow[]).map(
    (group): AccessGroupItem => ({
      id: group.id,
      name: group.name,
      slug: group.slug,
      description: group.description ?? "",
      member_count: memberships.filter((membership) => membership.group_id === group.id).length,
      is_member: userGroupIds.has(group.id),
      pending_request_id: pendingRequestByGroupId.get(group.id) ?? null,
    }),
  );

  const requestItems = pendingRequests.map(
    (request): AccessGroupJoinRequestItem => ({
      id: request.id,
      group_id: request.group_id,
      group_name: groupNameById.get(request.group_id) ?? "Unknown Group",
      requester_user_id: request.requester_user_id,
      requester_name: profileNameById.get(request.requester_user_id) ?? "Unknown User",
      request_note: request.request_note ?? "",
      created_at: request.created_at,
    }),
  );

  return (
    <GroupsClient
      groups={groups}
      pendingRequests={requestItems}
      profiles={profiles}
      isSystemAdmin={isSystemAdmin(profile.role)}
      canApproveRequests={canApproveRequests}
    />
  );
}
