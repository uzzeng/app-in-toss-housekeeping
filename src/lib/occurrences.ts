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

export async function fetchTodayOccurrences(anonKey: string): Promise<Occurrence[]> {
  const res = await fetch(
    `${FUNCTIONS_URL}/occurrences?anonKey=${encodeURIComponent(anonKey)}&range=today`,
    { headers },
  );
  const { occurrences } = await parseOrThrow<{ occurrences: Occurrence[] }>(res);
  return occurrences;
}

export async function fetchWeekOccurrences(anonKey: string): Promise<Occurrence[]> {
  const res = await fetch(
    `${FUNCTIONS_URL}/occurrences?anonKey=${encodeURIComponent(anonKey)}&range=week`,
    { headers },
  );
  const { occurrences } = await parseOrThrow<{ occurrences: Occurrence[] }>(res);
  return occurrences;
}

export async function fetchMonthOccurrences(anonKey: string, month: string): Promise<Occurrence[]> {
  const res = await fetch(
    `${FUNCTIONS_URL}/occurrences?anonKey=${encodeURIComponent(anonKey)}&range=month&month=${month}`,
    { headers },
  );
  const { occurrences } = await parseOrThrow<{ occurrences: Occurrence[] }>(res);
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
