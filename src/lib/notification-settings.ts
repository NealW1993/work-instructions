export type NotificationDeliveryPreference = "system" | "email" | "both";

export interface NotificationSettings {
  newInstructions: NotificationDeliveryPreference;
  instructionApprovals: NotificationDeliveryPreference;
  pendingApprovals: NotificationDeliveryPreference;
  documentApprovals: NotificationDeliveryPreference;
  groupRequests: NotificationDeliveryPreference;
  formulaApprovals: NotificationDeliveryPreference;
}

export type NotificationSettingKey = keyof NotificationSettings;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  newInstructions: "both",
  instructionApprovals: "both",
  pendingApprovals: "both",
  documentApprovals: "both",
  groupRequests: "both",
  formulaApprovals: "both",
};

function normalizeDeliveryPreference(
  value: unknown,
  fallback: NotificationDeliveryPreference,
): NotificationDeliveryPreference {
  if (value === "system" || value === "email" || value === "both") {
    return value;
  }

  if (typeof value === "boolean") {
    return value ? "both" : "system";
  }

  return fallback;
}

export function normalizeNotificationSettings(value: unknown): NotificationSettings {
  const settings =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    newInstructions: normalizeDeliveryPreference(
      settings.newInstructions,
      DEFAULT_NOTIFICATION_SETTINGS.newInstructions,
    ),
    instructionApprovals: normalizeDeliveryPreference(
      settings.instructionApprovals,
      DEFAULT_NOTIFICATION_SETTINGS.instructionApprovals,
    ),
    pendingApprovals: normalizeDeliveryPreference(
      settings.pendingApprovals,
      DEFAULT_NOTIFICATION_SETTINGS.pendingApprovals,
    ),
    documentApprovals: normalizeDeliveryPreference(
      settings.documentApprovals,
      DEFAULT_NOTIFICATION_SETTINGS.documentApprovals,
    ),
    groupRequests: normalizeDeliveryPreference(
      settings.groupRequests,
      DEFAULT_NOTIFICATION_SETTINGS.groupRequests,
    ),
    formulaApprovals: normalizeDeliveryPreference(
      settings.formulaApprovals,
      DEFAULT_NOTIFICATION_SETTINGS.formulaApprovals,
    ),
  };
}

export function getNotificationSettingsFromUserSettings(value: unknown) {
  const userSettings =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return normalizeNotificationSettings(userSettings.notifications);
}

export function shouldSendSystemNotification(
  settings: NotificationSettings,
  key: NotificationSettingKey,
) {
  const preference = settings[key];
  return preference === "system" || preference === "both";
}

export function shouldSendEmailNotification(
  settings: NotificationSettings,
  key: NotificationSettingKey,
) {
  const preference = settings[key];
  return preference === "email" || preference === "both";
}
