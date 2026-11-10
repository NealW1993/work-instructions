import { normalizeUserSettings, type UserSettings } from "@/lib/user-settings";
import { drainResponse } from "@/lib/utils";

interface BrowserSession {
  access_token?: string | null;
}

interface BrowserAuthClient {
  auth: {
    getSession: () => Promise<{ data: { session: BrowserSession | null } }>;
  };
}

async function getBearerToken(supabase: BrowserAuthClient) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const token = session?.access_token?.trim();
  return token ? token : null;
}

export async function fetchCurrentUserSettings(
  supabase: BrowserAuthClient,
): Promise<UserSettings | null> {
  try {
    const token = await getBearerToken(supabase);
    if (!token) {
      return null;
    }

    const response = await fetch("/api/user-settings", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => ({}))) as {
      settings?: unknown;
    };
    return normalizeUserSettings(payload.settings);
  } catch {
    return null;
  }
}

export async function patchCurrentUserSetting(params: {
  supabase: BrowserAuthClient;
  path: string;
  value: unknown;
}): Promise<boolean> {
  try {
    const token = await getBearerToken(params.supabase);
    if (!token) {
      return false;
    }

    const response = await fetch("/api/user-settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        path: params.path,
        value: params.value,
      }),
    });

    await drainResponse(response);
    return response.ok;
  } catch {
    return false;
  }
}
