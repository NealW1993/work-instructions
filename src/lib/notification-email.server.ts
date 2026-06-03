import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sendUserNotificationEmail } from "@/lib/mailer";
import {
  getNotificationSettingsFromUserSettings,
  shouldSendEmailNotification,
  type NotificationSettingKey,
} from "@/lib/notification-settings";
import type { AppRole } from "@/lib/types";

interface NotificationEmailProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole;
  is_active: boolean;
  user_settings: unknown;
}

interface NotificationEmailPayload {
  settingKey: NotificationSettingKey;
  title: string;
  body: string;
  href?: string | null;
  actorName?: string | null;
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

async function sendToProfiles(
  profiles: NotificationEmailProfile[],
  payload: NotificationEmailPayload,
) {
  await Promise.all(
    profiles.map(async (profile) => {
      if (!profile.is_active || !profile.email?.trim()) {
        return;
      }

      const settings = getNotificationSettingsFromUserSettings(profile.user_settings);
      if (!shouldSendEmailNotification(settings, payload.settingKey)) {
        return;
      }

      try {
        await sendUserNotificationEmail({
          to: profile.email,
          recipientName: profile.full_name,
          title: payload.title,
          body: payload.body,
          href: payload.href,
          actorName: payload.actorName,
        });
      } catch (error) {
        console.warn("Unable to send notification email.", {
          recipientUserId: profile.id,
          title: payload.title,
          error,
        });
      }
    }),
  );
}

export async function sendNotificationEmailsToUsers(
  supabaseAdmin: SupabaseClient,
  options: NotificationEmailPayload & {
    recipientUserIds: string[];
  },
) {
  const recipientUserIds = uniqueIds(options.recipientUserIds);
  if (recipientUserIds.length === 0) {
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email, full_name, role, is_active, user_settings")
    .in("id", recipientUserIds);

  if (error) {
    console.warn("Unable to read notification email recipients.", error);
    return;
  }

  await sendToProfiles((data ?? []) as NotificationEmailProfile[], options);
}

export async function sendNotificationEmailsToRoles(
  supabaseAdmin: SupabaseClient,
  options: NotificationEmailPayload & {
    roles: AppRole[];
    excludeUserIds?: string[];
  },
) {
  const roles = Array.from(new Set(options.roles));
  if (roles.length === 0) {
    return;
  }

  let query = supabaseAdmin
    .from("profiles")
    .select("id, email, full_name, role, is_active, user_settings")
    .eq("is_active", true)
    .in("role", roles);

  const excludedIds = uniqueIds(options.excludeUserIds ?? []);
  if (excludedIds.length > 0) {
    query = query.not("id", "in", `(${excludedIds.join(",")})`);
  }

  const { data, error } = await query;

  if (error) {
    console.warn("Unable to read role notification email recipients.", error);
    return;
  }

  await sendToProfiles((data ?? []) as NotificationEmailProfile[], options);
}
