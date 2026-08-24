const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export type ChoreType = 'general' | 'one_time';
export type RepeatMode = 'fixed_date' | 'interval';
export type IntervalUnit = 'day' | 'week';
export type FixedUnit = 'month' | 'year';

export const CHORE_TYPE_LABEL: Record<ChoreType, string> = {
  general: '일반 반복형',
  one_time: '수시 등록형',
};

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
  sort_order: number;
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

// 탭 이동 시 페이지가 매번 언마운트/재마운트되며 같은 데이터를 처음부터 다시 불러오는 걸
// 피하려고 마지막 응답을 모듈 스코프에 캐시해둔다. 재진입 시 먼저 즉시 보여준 뒤
// 백그라운드로 새로고침하는 용도. 앱 종료 시 캐시도 사라짐.
export const choresCache = new Map<string, Chore[]>();

export async function fetchChores(anonKey: string): Promise<Chore[]> {
  // 집안일 리스트(관리) 화면에서는 비활성 항목도 계속 보여야 "다시 활성화" 조작이 가능하므로
  // includeInactive=true로 항상 전체 조회한다.
  const res = await fetch(
    `${FUNCTIONS_URL}/chores?anonKey=${encodeURIComponent(anonKey)}&includeInactive=true`,
    { headers },
  );
  const { chores } = await parseOrThrow<{ chores: Chore[] }>(res);
  choresCache.set(anonKey, chores);
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

// 정렬 모드에서 확정한 순서(ids, 원하는 순서대로 나열)를 한 번에 서버에 반영한다.
export async function reorderChores(anonKey: string, ids: string[]): Promise<void> {
  const res = await fetch(
    `${FUNCTIONS_URL}/chores?anonKey=${encodeURIComponent(anonKey)}&reorder=true`,
    { method: 'POST', headers, body: JSON.stringify({ ids }) },
  );
  await parseOrThrow<{ ok: boolean }>(res);
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
