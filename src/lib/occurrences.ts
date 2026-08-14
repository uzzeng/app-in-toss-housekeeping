const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export interface Occurrence {
  id: string;
  chore_id: string;
  scheduled_date: string;
  status: 'pending' | 'done';
  completed_date: string | null;
  completion_type: 'regular' | 'manual' | null;
  reminder_count: number;
  chores: {
    id: string;
    name: string;
    type: string;
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

export async function setOccurrenceCompleted(
  anonKey: string,
  occurrenceId: string,
  completed: boolean,
): Promise<Occurrence> {
  const res = await fetch(`${FUNCTIONS_URL}/occurrences?anonKey=${encodeURIComponent(anonKey)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ occurrenceId, completed }),
  });
  const { occurrence } = await parseOrThrow<{ occurrence: Occurrence }>(res);
  return occurrence;
}
