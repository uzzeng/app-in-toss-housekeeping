const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export type ChoreType = 'general' | 'annual_fixed' | 'one_time';
export type RepeatMode = 'fixed_date' | 'interval';
export type IntervalUnit = 'day' | 'week';
export type FixedUnit = 'month' | 'year';

export interface Chore {
  id: string;
  user_id: string;
  name: string;
  type: ChoreType;
  repeat_mode: RepeatMode | null;
  interval_value: number | null;
  interval_unit: IntervalUnit | null;
  fixed_unit: FixedUnit | null;
  fixed_month: number | null;
  fixed_day: number | null;
  start_date: string;
  is_active: boolean;
  board_slot_index: number | null;
  created_at: string;
  updated_at: string;
}

export interface ChoreInput {
  name: string;
  type: ChoreType;
  repeat_mode?: RepeatMode;
  interval_value?: number;
  interval_unit?: IntervalUnit;
  fixed_unit?: FixedUnit;
  fixed_month?: number;
  fixed_day?: number;
  start_date: string;
}

// x-anon-key 같은 커스텀 헤더는 Supabase Edge Function의 CORS preflight에서
// 누락되는 알려진 이슈가 있어(https://github.com/supabase/supabase/issues/41334),
// 헤더 대신 쿼리 파라미터로 anonKey를 전달한다.
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

export async function fetchChores(anonKey: string): Promise<Chore[]> {
  // 집안일 리스트(관리) 화면에서는 비활성 항목도 계속 보여야 "다시 활성화" 조작이 가능하므로
  // includeInactive=true로 항상 전체 조회한다.
  const res = await fetch(
    `${FUNCTIONS_URL}/chores?anonKey=${encodeURIComponent(anonKey)}&includeInactive=true`,
    { headers },
  );
  const { chores } = await parseOrThrow<{ chores: Chore[] }>(res);
  return chores;
}

export async function createChore(anonKey: string, input: ChoreInput): Promise<Chore> {
  const res = await fetch(`${FUNCTIONS_URL}/chores?anonKey=${encodeURIComponent(anonKey)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  const { chore } = await parseOrThrow<{ chore: Chore }>(res);
  return chore;
}

export async function updateChore(
  anonKey: string,
  id: string,
  patch: Partial<ChoreInput> & { is_active?: boolean },
): Promise<Chore> {
  const res = await fetch(
    `${FUNCTIONS_URL}/chores?id=${id}&anonKey=${encodeURIComponent(anonKey)}`,
    { method: 'PATCH', headers, body: JSON.stringify(patch) },
  );
  const { chore } = await parseOrThrow<{ chore: Chore }>(res);
  return chore;
}

export async function deleteChore(anonKey: string, id: string): Promise<void> {
  const res = await fetch(
    `${FUNCTIONS_URL}/chores?id=${id}&anonKey=${encodeURIComponent(anonKey)}`,
    { method: 'DELETE', headers },
  );
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `삭제가 실패했어요 (${res.status})`);
  }
}
