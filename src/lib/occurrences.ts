import type { ChoreType } from './chores';

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export interface Occurrence {
  id: string;
  chore_id: string;
  scheduled_date: string;
  status: 'pending' | 'done';
  completed_date: string | null;
  completion_type: 'regular' | 'manual' | null;
  reminder_count: number;
  // 캘린더 월간 조회에서만 채워짐: 그 chore의 가장 최근 완료건에만 존재 (그 외에는 undefined/null)
  next_scheduled_date?: string | null;
  chores: {
    id: string;
    name: string;
    type: ChoreType;
    user_id: string;
  };
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

// 탭 이동 시 react-router가 MainPage를 매번 언마운트/재마운트하면서 같은 데이터를
// 처음부터 다시 불러오는 게 체감 지연의 원인이었다. 마지막 응답을 모듈 스코프에 캐시해두고
// 재진입 시 먼저 즉시 보여준 뒤 백그라운드로 새로고침하는 용도. 앱 종료 시 캐시도 사라짐.
export const todayOccurrencesCache = new Map<string, Occurrence[]>();
export const weekOccurrencesCache = new Map<string, Occurrence[]>();

export async function fetchTodayOccurrences(anonKey: string): Promise<Occurrence[]> {
  const res = await fetch(
    `${FUNCTIONS_URL}/occurrences?anonKey=${encodeURIComponent(anonKey)}&range=today`,
    { headers },
  );
  const { occurrences } = await parseOrThrow<{ occurrences: Occurrence[] }>(res);
  todayOccurrencesCache.set(anonKey, occurrences);
  return occurrences;
}

export async function fetchWeekOccurrences(anonKey: string): Promise<Occurrence[]> {
  const res = await fetch(
    `${FUNCTIONS_URL}/occurrences?anonKey=${encodeURIComponent(anonKey)}&range=week`,
    { headers },
  );
  const { occurrences } = await parseOrThrow<{ occurrences: Occurrence[] }>(res);
  weekOccurrencesCache.set(anonKey, occurrences);
  return occurrences;
}

export interface ChoreHistoryItem {
  id: string;
  completed_date: string;
  completion_type: 'regular' | 'manual';
}

export async function fetchChoreHistory(anonKey: string, choreId: string): Promise<ChoreHistoryItem[]> {
  const res = await fetch(
    `${FUNCTIONS_URL}/occurrences?anonKey=${encodeURIComponent(anonKey)}&range=history&choreId=${encodeURIComponent(choreId)}`,
    { headers },
  );
  const { occurrences } = await parseOrThrow<{ occurrences: ChoreHistoryItem[] }>(res);
  return occurrences;
}

// 월 단위로 캐시 키를 나눈다 (anonKey:month) — 캘린더는 월 이동마다 다른 데이터를 보여줘야 하므로.
export const monthOccurrencesCache = new Map<string, Occurrence[]>();

export async function fetchMonthOccurrences(anonKey: string, month: string): Promise<Occurrence[]> {
  const res = await fetch(
    `${FUNCTIONS_URL}/occurrences?anonKey=${encodeURIComponent(anonKey)}&range=month&month=${month}`,
    { headers },
  );
  const { occurrences } = await parseOrThrow<{ occurrences: Occurrence[] }>(res);
  monthOccurrencesCache.set(`${anonKey}:${month}`, occurrences);
  return occurrences;
}

export async function addManualOccurrence(
  anonKey: string,
  choreId: string,
  date: string,
): Promise<Occurrence> {
  const res = await fetch(`${FUNCTIONS_URL}/occurrences?anonKey=${encodeURIComponent(anonKey)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ choreId, date }),
  });
  const { occurrence } = await parseOrThrow<{ occurrence: Occurrence }>(res);
  return occurrence;
}

export async function deleteManualOccurrence(anonKey: string, occurrenceId: string): Promise<void> {
  const res = await fetch(`${FUNCTIONS_URL}/occurrences?anonKey=${encodeURIComponent(anonKey)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ occurrenceId, deleteManual: true }),
  });
  await parseOrThrow<{ ok: boolean }>(res);
}

export async function setOccurrenceCompleted(
  anonKey: string,
  occurrenceId: string,
  completed: boolean,
  completedDate?: string,
): Promise<Occurrence> {
  const res = await fetch(`${FUNCTIONS_URL}/occurrences?anonKey=${encodeURIComponent(anonKey)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ occurrenceId, completed, completedDate }),
  });
  const { occurrence } = await parseOrThrow<{ occurrence: Occurrence }>(res);
  return occurrence;
}
