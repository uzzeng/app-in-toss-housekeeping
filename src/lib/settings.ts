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

// 탭 이동 시 페이지가 매번 언마운트/재마운트되며 같은 데이터를 처음부터 다시 불러오는 걸
// 피하려고 마지막 응답을 모듈 스코프에 캐시해둔다. 재진입 시 먼저 즉시 보여준 뒤
// 백그라운드로 새로고침하는 용도. 앱 종료 시 캐시도 사라짐.
export const settingsCache = new Map<string, NotificationSettings>();

export async function fetchSettings(anonKey: string): Promise<NotificationSettings> {
  const res = await fetch(`${FUNCTIONS_URL}/user-settings?anonKey=${encodeURIComponent(anonKey)}`, { headers });
  const { settings } = await parseOrThrow<{ settings: NotificationSettings }>(res);
  settingsCache.set(anonKey, settings);
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
  settingsCache.set(anonKey, settings);
  return settings;
}
