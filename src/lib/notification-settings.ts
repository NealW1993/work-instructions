export interface NotificationSettings {
  newInstructions: boolean;
  instructionApprovals: boolean;
  pendingApprovals: boolean;
  documentApprovals: boolean;
  groupRequests: boolean;
  formulaApprovals: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  newInstructions: true,
  instructionApprovals: true,
  pendingApprovals: true,
  documentApprovals: true,
  groupRequests: true,
  formulaApprovals: true,
};

export function normalizeNotificationSettings(value: unknown): NotificationSettings {
  const settings =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    newInstructions:
      typeof settings.newInstructions === "boolean"
        ? settings.newInstructions
        : DEFAULT_NOTIFICATION_SETTINGS.newInstructions,
    instructionApprovals:
      typeof settings.instructionApprovals === "boolean"
        ? settings.instructionApprovals
        : DEFAULT_NOTIFICATION_SETTINGS.instructionApprovals,
    pendingApprovals:
      typeof settings.pendingApprovals === "boolean"
        ? settings.pendingApprovals
        : DEFAULT_NOTIFICATION_SETTINGS.pendingApprovals,
    documentApprovals:
      typeof settings.documentApprovals === "boolean"
        ? settings.documentApprovals
        : DEFAULT_NOTIFICATION_SETTINGS.documentApprovals,
    groupRequests:
      typeof settings.groupRequests === "boolean"
        ? settings.groupRequests
        : DEFAULT_NOTIFICATION_SETTINGS.groupRequests,
    formulaApprovals:
      typeof settings.formulaApprovals === "boolean"
        ? settings.formulaApprovals
        : DEFAULT_NOTIFICATION_SETTINGS.formulaApprovals,
  };
}

export function getNotificationSettingsFromUserSettings(value: unknown) {
  const userSettings =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return normalizeNotificationSettings(userSettings.notifications);
}
