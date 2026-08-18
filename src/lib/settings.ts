const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export interface NotificationSettings {
  id: string;
  notification_time: string;
  notification_time_enabled: boolean;
  reminder_time: string;
  reminder_time_enabled: boolean;
  reminder_days: number;
}

export interface NotificationSettingsInput {
  notification_time?: string;
  notification_time_enabled?: boolean;
  reminder_time?: string;
  reminder_time_enabled?: boolean;
  reminder_days?: number;
}

const headers = {
  'content-type': 'application/json',
  apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
};

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `요청이 실패했어요 (${res.status})`);
  }
  return res.json();
}

export async function fetchSettings(anonKey: string): Promise<NotificationSettings> {
  const res = await fetch(`${FUNCTIONS_URL}/user-settings?anonKey=${encodeURIComponent(anonKey)}`, { headers });
  const { settings } = await parseOrThrow<{ settings: NotificationSettings }>(res);
  return settings;
}

export async function updateSettings(
  anonKey: string,
  patch: NotificationSettingsInput,
): Promise<NotificationSettings> {
  const res = await fetch(`${FUNCTIONS_URL}/user-settings?anonKey=${encodeURIComponent(anonKey)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
  const { settings } = await parseOrThrow<{ settings: NotificationSettings }>(res);
  return settings;
}
