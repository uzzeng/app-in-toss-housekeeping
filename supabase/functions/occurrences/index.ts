// 집안일 예정일(occurrence) 계산/조회/완료 처리.
// - GET  /occurrences?range=today|week — 오늘 할 일 / 앞으로 7일 예정 조회 (조회 전 각 chore의 "다음 occurrence"가 없으면 생성)
// - POST /occurrences/complete { occurrenceId, completedDate? } — 완료 처리 (재탭 시 해제 가능하도록 토글)
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

interface Chore {
  id: string;
  user_id: string;
  name: string;
  type: "general" | "annual_fixed" | "one_time";
  repeat_mode: "fixed_date" | "interval" | null;
  interval_value: number | null;
  interval_unit: "day" | "week" | null;
  fixed_unit: "month" | "year" | null;
  fixed_month: number | null;
  fixed_day: number | null;
  start_date: string;
  is_active: boolean;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateOnly(d);
}

function lastDayOfMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

// annual_fixed, 그리고 general/fixed_date 공용: 기준일 이후(포함) 가장 빠른 "매달/매년 지정일"을 계산
function nextFixedDate(
  from: string,
  unit: "month" | "year",
  month: number | null,
  day: number,
): string {
  const fromDate = new Date(`${from}T00:00:00Z`);
  const fromY = fromDate.getUTCFullYear();
  const fromM = fromDate.getUTCMonth() + 1;
  const fromD = fromDate.getUTCDate();

  if (unit === "year") {
    const targetMonth = month ?? 1;
    let year = fromY;
    const candidateDay = Math.min(day, lastDayOfMonth(year, targetMonth));
    let candidate = `${year}-${String(targetMonth).padStart(2, "0")}-${String(candidateDay).padStart(2, "0")}`;
    if (candidate < from) {
      year += 1;
      const d2 = Math.min(day, lastDayOfMonth(year, targetMonth));
      candidate = `${year}-${String(targetMonth).padStart(2, "0")}-${String(d2).padStart(2, "0")}`;
    }
    return candidate;
  }

  // unit === "month"
  let year = fromY;
  let m = fromM;
  const candidateDay = Math.min(day, lastDayOfMonth(year, m));
  let candidate = `${year}-${String(m).padStart(2, "0")}-${String(candidateDay).padStart(2, "0")}`;
  if (candidate < from) {
    m += 1;
    if (m > 12) {
      m = 1;
      year += 1;
    }
    const d2 = Math.min(day, lastDayOfMonth(year, m));
    candidate = `${year}-${String(m).padStart(2, "0")}-${String(d2).padStart(2, "0")}`;
  }
  return candidate;
}

// chore와 "이미 있는 occurrence 중 가장 최근 것"을 바탕으로 다음 생성해야 할 예정일을 계산.
// 없으면 start_date를 최초 예정일로 사용.
function computeNextScheduledDate(chore: Chore, lastOccurrenceDate: string | null): string | null {
  if (chore.type === "one_time") {
    return lastOccurrenceDate ? null : chore.start_date;
  }

  if (chore.type === "annual_fixed") {
    const base = lastOccurrenceDate ? addDays(lastOccurrenceDate, 1) : chore.start_date;
    return nextFixedDate(base, "year", chore.fixed_month, chore.fixed_day ?? 1);
  }

  // general
  if (chore.repeat_mode === "fixed_date") {
    const base = lastOccurrenceDate ? addDays(lastOccurrenceDate, 1) : chore.start_date;
    return nextFixedDate(base, chore.fixed_unit ?? "month", chore.fixed_month, chore.fixed_day ?? 1);
  }

  // interval
  if (!lastOccurrenceDate) return chore.start_date;
  const days = chore.interval_unit === "week" ? (chore.interval_value ?? 1) * 7 : chore.interval_value ?? 1;
  return addDays(lastOccurrenceDate, days);
}

// deno 런타임에서 ctx.supabaseAdmin의 정확한 타입을 로컬에서 가져올 수 없어 최소한만 선언
interface SupabaseAdminLike {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

async function ensureOccurrencesUpTo(
  supabaseAdmin: SupabaseAdminLike,
  chore: Chore,
  untilDate: string,
  today: string,
) {
  const { data: existingList } = await supabaseAdmin
    .from("chore_occurrences")
    .select("scheduled_date, status, completed_date")
    .eq("chore_id", chore.id)
    .order("scheduled_date", { ascending: false })
    .limit(1);

  const latest = (existingList ?? [])[0] as
    | { scheduled_date: string; status: string; completed_date: string | null }
    | undefined;

  // 가장 최근 occurrence가 아직 미완료이고, 그 예정일이 아직 지나지 않았다면(오늘 포함 미래)
  // 이미 "해야 할 일"이 잡혀 있는 상태이므로 새로 만들 필요가 없다.
  // 반면 예정일이 이미 지났다면(과거) — "완료 안 해도 다음 예정일은 스케줄대로 도래한다"는
  // PRD 규칙에 따라 그 미완료 건은 그대로 둔 채 다음 회차를 별도로 생성해야 한다.
  if (latest && latest.status === "pending" && latest.scheduled_date >= today) {
    return;
  }

  // 기준일: 완료된 적이 있으면 완료일, 미완료로 지나간 회차가 있으면 그 예정일, 아무것도 없으면 null(start_date부터 시작)
  const baseDate = latest ? (latest.status === "done" ? latest.completed_date : latest.scheduled_date) : null;

  let cursor = computeNextScheduledDate(chore, baseDate);
  const toInsert: { chore_id: string; scheduled_date: string }[] = [];
  let guard = 0;
  while (cursor && cursor <= untilDate && guard < 60) {
    toInsert.push({ chore_id: chore.id, scheduled_date: cursor });
    if (chore.type === "one_time") break;
    cursor = computeNextScheduledDate(chore, cursor);
    guard += 1;
  }

  if (toInsert.length > 0) {
    await supabaseAdmin.from("chore_occurrences").insert(toInsert);
  }
}

export default {
  fetch: withSupabase({ auth: ["publishable"] }, async (req, ctx) => {
    const url = new URL(req.url);
    const anonKey = url.searchParams.get("anonKey");

    if (!anonKey) {
      return Response.json({ error: "anonKey 쿼리 파라미터가 필요해요." }, { status: 401 });
    }

    const { data: user, error: userError } = await ctx.supabaseAdmin
      .from("users")
      .select("id")
      .eq("anon_key", anonKey)
      .single();

    if (userError || !user) {
      return Response.json({ error: "사용자를 찾을 수 없어요. 먼저 로그인해 주세요." }, { status: 401 });
    }

    const userId = user.id as string;

    if (req.method === "GET") {
      const range = url.searchParams.get("range") === "week" ? "week" : "today";
      const today = toDateOnly(new Date());
      const untilDate = range === "week" ? addDays(today, 7) : today;

      const { data: activeChores, error: choresError } = await ctx.supabaseAdmin
        .from("chores")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true);

      if (choresError) return Response.json({ error: choresError.message }, { status: 500 });

      for (const chore of (activeChores ?? []) as Chore[]) {
        await ensureOccurrencesUpTo(ctx.supabaseAdmin, chore, untilDate, today);
      }

      let query = ctx.supabaseAdmin
        .from("chore_occurrences")
        .select("*, chores!inner(id, name, type, user_id, is_active)")
        .eq("chores.user_id", userId)
        .eq("chores.is_active", true);

      if (range === "today") {
        // 오늘 할 일 박스는 완료 여부와 무관하게 오늘 예정된 항목을 모두 보여주고,
        // 프론트엔드가 완료 여부를 체크 표시로 구분한다 (재탭으로 완료 해제 가능해야 하므로).
        query = query.eq("scheduled_date", today);
      } else {
        // 일주일 예정 박스는 PRD상 "앞으로 해야 할 일"만 보여주는 보기 전용이므로 미완료만 조회.
        query = query.eq("status", "pending").gt("scheduled_date", today).lte("scheduled_date", untilDate);
      }

      const { data, error } = await query.order("scheduled_date", { ascending: true });
      if (error) return Response.json({ error: error.message }, { status: 500 });

      return Response.json({ occurrences: data });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const { occurrenceId, completed } = body as { occurrenceId?: string; completed?: boolean };
      if (typeof occurrenceId !== "string") {
        return Response.json({ error: "occurrenceId가 필요해요." }, { status: 400 });
      }

      // 소유권 확인
      const { data: occurrence, error: occError } = await ctx.supabaseAdmin
        .from("chore_occurrences")
        .select("*, chores!inner(user_id)")
        .eq("id", occurrenceId)
        .single();

      if (occError || !occurrence || occurrence.chores.user_id !== userId) {
        return Response.json({ error: "해당 항목을 찾을 수 없어요." }, { status: 404 });
      }

      const shouldComplete = completed !== false;
      const patch = shouldComplete
        ? { status: "done", completed_date: toDateOnly(new Date()), completion_type: "regular" }
        : { status: "pending", completed_date: null, completion_type: null };

      const { data, error } = await ctx.supabaseAdmin
        .from("chore_occurrences")
        .update(patch)
        .eq("id", occurrenceId)
        .select("*")
        .single();

      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ occurrence: data });
    }

    return Response.json({ error: "지원하지 않는 메서드예요." }, { status: 405 });
  }),
};
