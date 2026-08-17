// 집안일 예정일(occurrence) 계산/조회/완료 처리.
// - GET  /occurrences?range=today|week — 오늘 할 일 / 앞으로 7일 예정 조회 (조회 전 각 chore의 "다음 occurrence"가 없으면 생성)
// - GET  /occurrences?range=month&month=YYYY-MM — 캘린더용 월간 조회 (완료는 completed_date, 미완료는 scheduled_date가 해당 월에 속하면 표시)
// - POST /occurrences/complete { occurrenceId, completedDate? } — 완료 처리 (재탭 시 해제 가능하도록 토글)
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

interface Chore {
  id: string;
  user_id: string;
  name: string;
  type: "general" | "one_time";
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

// "YYYY-MM" 형태의 month 파라미터가 유효한지 확인하고 [월초, 월말] 날짜를 반환
function monthRange(monthParam: string | null): { start: string; end: string } | null {
  if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) return null;
  const [year, month] = monthParam.split("-").map(Number);
  if (month < 1 || month > 12) return null;
  const start = `${monthParam}-01`;
  const end = `${monthParam}-${String(lastDayOfMonth(year, month)).padStart(2, "0")}`;
  return { start, end };
}

function lastDayOfMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

// general/fixed_date 전용: 기준일 이후(포함) 가장 빠른 "매달/매년 지정일"을 계산
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
      const rangeParam = url.searchParams.get("range");
      const today = toDateOnly(new Date());

      if (rangeParam === "month") {
        const monthWindow = monthRange(url.searchParams.get("month"));
        if (!monthWindow) {
          return Response.json({ error: "month 파라미터가 필요해요 (형식: YYYY-MM)." }, { status: 400 });
        }

        // 캘린더는 지나간 달을 조회할 수도 있으므로, occurrence 생성은 오늘 이후(현재/미래) 달에만 수행.
        if (monthWindow.end >= today) {
          const { data: activeChores, error: choresError } = await ctx.supabaseAdmin
            .from("chores")
            .select("*")
            .eq("user_id", userId)
            .eq("is_active", true);

          if (choresError) return Response.json({ error: choresError.message }, { status: 500 });

          await Promise.all(
            ((activeChores ?? []) as Chore[]).map((chore) =>
              ensureOccurrencesUpTo(ctx.supabaseAdmin, chore, monthWindow.end, today),
            ),
          );
        }

        // 완료 항목은 completed_date 기준, 미완료 항목은 scheduled_date 기준으로 그 달에 속하면 표시 (PRD 규칙)
        const [{ data: doneData, error: doneError }, { data: pendingData, error: pendingError }] = await Promise.all([
          ctx.supabaseAdmin
            .from("chore_occurrences")
            .select("*, chores!inner(id, name, type, user_id)")
            .eq("chores.user_id", userId)
            .eq("status", "done")
            .gte("completed_date", monthWindow.start)
            .lte("completed_date", monthWindow.end),
          ctx.supabaseAdmin
            .from("chore_occurrences")
            .select("*, chores!inner(id, name, type, user_id)")
            .eq("chores.user_id", userId)
            .eq("status", "pending")
            .gte("scheduled_date", monthWindow.start)
            .lte("scheduled_date", monthWindow.end),
        ]);

        if (doneError) return Response.json({ error: doneError.message }, { status: 500 });
        if (pendingError) return Response.json({ error: pendingError.message }, { status: 500 });

        const combined = [...(doneData ?? []), ...(pendingData ?? [])];
        return Response.json({ occurrences: combined });
      }

      const range = rangeParam === "week" ? "week" : "today";
      const untilDate = range === "week" ? addDays(today, 7) : today;

      const { data: activeChores, error: choresError } = await ctx.supabaseAdmin
        .from("chores")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true);

      if (choresError) return Response.json({ error: choresError.message }, { status: 500 });

      await Promise.all(
        ((activeChores ?? []) as Chore[]).map((chore) =>
          ensureOccurrencesUpTo(ctx.supabaseAdmin, chore, untilDate, today),
        ),
      );

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
      const { occurrenceId, completed, choreId, date } = body as {
        occurrenceId?: string;
        completed?: boolean;
        choreId?: string;
        date?: string;
      };

      // 수기 입력: 특정 날짜에 "예정에 없이" 완료한 집안일을 새 occurrence로 기록한다.
      // (캘린더에서 날짜를 선택하고 "이날 한 집안일 추가"로 진입하는 경로)
      if (typeof choreId === "string" && typeof date === "string") {
        const { data: chore, error: choreError } = await ctx.supabaseAdmin
          .from("chores")
          .select("*")
          .eq("id", choreId)
          .eq("user_id", userId)
          .eq("is_active", true)
          .single();

        if (choreError || !chore) {
          return Response.json({ error: "해당 집안일을 찾을 수 없어요." }, { status: 404 });
        }

        const { data, error } = await ctx.supabaseAdmin
          .from("chore_occurrences")
          .insert({
            chore_id: choreId,
            scheduled_date: date,
            status: "done",
            completed_date: date,
            completion_type: "manual",
          })
          .select("*, chores!inner(id, name, type, user_id)")
          .single();

        if (error) return Response.json({ error: error.message }, { status: 500 });

        // 수기 입력 날짜 이후로 이미 생성돼 있던 미완료 예정 건은 이 날짜를 기준으로 다시 계산해야
        // 맞으므로 지우고, ensureOccurrencesUpTo가 새 기준일(date)로 다음 회차를 재생성하게 한다.
        await ctx.supabaseAdmin
          .from("chore_occurrences")
          .delete()
          .eq("chore_id", choreId)
          .eq("status", "pending")
          .gt("scheduled_date", date);

        // range=month 조회 시 캘린더에서 바로 다음 회차가 보이도록 넉넉히(약 한 달) 재계산한다.
        const today = toDateOnly(new Date());
        await ensureOccurrencesUpTo(ctx.supabaseAdmin, chore as Chore, addDays(today, 35), today);

        return Response.json({ occurrence: data });
      }

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
