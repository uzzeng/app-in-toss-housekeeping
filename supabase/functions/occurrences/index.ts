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
  interval_unit: "day" | "week" | "month" | null;
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

// "오늘" 날짜는 KST 자정 기준이어야 한다 — UTC 기준으로 계산하면 KST 00:00~08:59 사이에
// 실제 날짜보다 하루 이른 값이 나와 occurrence 생성/완료 판단이 어긋난다.
function todayKst(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return toDateOnly(kst);
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

// interval(상대 주기, 개월) 전용: 기준일(from)로부터 n개월 후를 계산하되, 목표 "일"은 항상
// targetDay(보통 chore.start_date의 일)를 그대로 사용한다. from 자체의 일(day)을 목표로 삼으면
// 말일 보정이 한 번 일어난 뒤(예: 1/31 -> 2/28) 그 보정값(28)이 다음 계산의 목표로 굳어버려서,
// 원래 목표였던 31이 영구히 사라지는 버그가 있었다(7/31 -> 8/31 -> 9/30(보정) -> 10/30(!) 처럼
// 계속 앞으로 줄어듦). 목표 일이 그 달에 없으면 nextFixedDate와 동일하게 그 달의 마지막 날로 보정.
function addMonths(from: string, months: number, targetDay: number): string {
  const fromDate = new Date(`${from}T00:00:00Z`);
  let year = fromDate.getUTCFullYear();
  let month = fromDate.getUTCMonth() + 1 + months;
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  const day = Math.min(targetDay, lastDayOfMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// chore와 "이미 있는 occurrence 중 가장 최근 것"을 바탕으로 다음 생성해야 할 예정일을 계산.
// 없으면 start_date를 최초 예정일로 사용.
// monthTargetDay: interval(개월) 전용 — "매달 며칠에 맞출지"의 기준. 이 값은 호출부에서 한 번만
// 정해서 이후 같은 chore의 모든 후속 회차 계산에 그대로 재사용해야 한다. PRD 규칙상 완료 처리는
// 다음 주기의 새 기준점이 되므로(예: 7/31 예정을 8/6에 완료하면 다음은 9/6, 그다음도 10/6...),
// 완료된 적이 있으면 그 완료일의 일을, 없으면 start_date의 일을 기준으로 삼는다. 매 회차마다
// "직전 occurrence의 실제 날짜"에서 다시 뽑으면, 말일 보정(예: 9월엔 31일 없음)이 한 번 일어난
// 뒤 그 보정값이 다음 목표로 굳어버려 원래 목표 일이 영구히 사라지는 버그가 생긴다.
function computeNextScheduledDate(
  chore: Chore,
  lastOccurrenceDate: string | null,
  monthTargetDay: number,
): string | null {
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
  if (chore.interval_unit === "month") {
    return addMonths(lastOccurrenceDate, chore.interval_value ?? 1, monthTargetDay);
  }
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
  await ensureOccurrencesUpToBatch(supabaseAdmin, [chore], untilDate, today);
}

// 여러 chore를 대상으로 "가장 최근 occurrence"를 한 번의 쿼리로 모아 가져오고,
// 새로 생성해야 할 occurrence도 한 번의 insert로 모아서 처리한다. chore 개수만큼
// 순차/병렬 DB 왕복이 발생하던 것을 쿼리 2회(조회 1 + insert 1)로 줄이기 위한 배치 버전.
async function ensureOccurrencesUpToBatch(
  supabaseAdmin: SupabaseAdminLike,
  chores: Chore[],
  untilDate: string,
  today: string,
) {
  if (chores.length === 0) return;

  const choreIds = chores.map((c) => c.id);
  const { data: existingList } = await supabaseAdmin
    .from("chore_occurrences")
    .select("chore_id, scheduled_date, status, completed_date")
    .in("chore_id", choreIds)
    .order("scheduled_date", { ascending: false });

  const latestByChore = new Map<
    string,
    { scheduled_date: string; status: string; completed_date: string | null }
  >();
  for (const row of (existingList ?? []) as Array<{
    chore_id: string;
    scheduled_date: string;
    status: string;
    completed_date: string | null;
  }>) {
    if (!latestByChore.has(row.chore_id)) latestByChore.set(row.chore_id, row);
  }

  const toInsert: { chore_id: string; scheduled_date: string }[] = [];

  for (const chore of chores) {
    const latest = latestByChore.get(chore.id);

    // 다음 회차 계산의 기준일: 완료된 적이 있으면 완료일, 미완료 회차가 있으면 그 예정일,
    // 아무것도 없으면 null(start_date부터 시작). 미완료 회차가 미래에 있어도(아직 안 지났어도)
    // 그 다음 회차들을 untilDate까지는 계속 미리 생성해야 캘린더에서 다음 달로 넘어가도
    // 예정이 비어 보이지 않는다 — 여기서 생성을 멈추지 않는다.
    const baseIsCompletion = latest?.status === "done";
    const baseDate = latest ? (baseIsCompletion ? latest.completed_date : latest.scheduled_date) : null;

    // interval(개월)의 매달 기준일 — 완료된 적이 있으면 그 완료일의 일을, 없으면 start_date의
    // 일을 이 chore의 모든 후속 회차 계산에 고정으로 재사용한다 (함수 상단 주석 참고).
    const monthTargetDay = Number(
      (baseIsCompletion && baseDate ? baseDate : chore.start_date).slice(8, 10),
    );

    let cursor = computeNextScheduledDate(chore, baseDate, monthTargetDay);
    let guard = 0;
    while (cursor && cursor <= untilDate && guard < 60) {
      toInsert.push({ chore_id: chore.id, scheduled_date: cursor });
      if (chore.type === "one_time") break;
      cursor = computeNextScheduledDate(chore, cursor, monthTargetDay);
      guard += 1;
    }
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
      const today = todayKst();

      if (rangeParam === "overdueCount") {
        // 홈 화면 말풍선용: 예정일이 지났는데 아직 완료하지 않은 항목 개수.
        // count:"exact"+head:true는 중첩 관계(chores!inner) 필터와 조합 시 신뢰할 수 없어
        // id만 선택해 length로 센다 (range=month 등 다른 조회에서 이미 검증된 패턴과 동일).
        const { data, error } = await ctx.supabaseAdmin
          .from("chore_occurrences")
          .select("id, chores!inner(user_id, is_active)")
          .eq("chores.user_id", userId)
          .eq("chores.is_active", true)
          .eq("status", "pending")
          .lt("scheduled_date", today);

        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ overdueCount: (data ?? []).length });
      }

      if (rangeParam === "overdue") {
        // 홈 화면 "밀린 집안일" 탭용: 예정일이 지났는데 아직 완료하지 않은 항목 전체를
        // 가장 오래 밀린 순(scheduled_date 오름차순)으로 반환. overdueCount와 동일한 조건.
        const { data, error } = await ctx.supabaseAdmin
          .from("chore_occurrences")
          .select("*, chores!inner(id, name, type, user_id, is_active)")
          .eq("chores.user_id", userId)
          .eq("chores.is_active", true)
          .eq("status", "pending")
          .lt("scheduled_date", today)
          .order("scheduled_date", { ascending: true });

        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ occurrences: data });
      }

      if (rangeParam === "history") {
        const choreId = url.searchParams.get("choreId");
        if (!choreId) {
          return Response.json({ error: "choreId 쿼리 파라미터가 필요해요." }, { status: 400 });
        }

        const { data: chore, error: choreError } = await ctx.supabaseAdmin
          .from("chores")
          .select("id")
          .eq("id", choreId)
          .eq("user_id", userId)
          .single();

        if (choreError || !chore) {
          return Response.json({ error: "해당 집안일을 찾을 수 없어요." }, { status: 404 });
        }

        // 완료 이력 전체를 최신순으로 반환 — 3개월 평균/간격 계산은 프론트에서 처리
        const { data, error } = await ctx.supabaseAdmin
          .from("chore_occurrences")
          .select("id, completed_date, completion_type")
          .eq("chore_id", choreId)
          .eq("status", "done")
          .order("completed_date", { ascending: false });

        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ occurrences: data });
      }

      if (rangeParam === "month") {
        const monthWindow = monthRange(url.searchParams.get("month"));
        if (!monthWindow) {
          return Response.json({ error: "month 파라미터가 필요해요 (형식: YYYY-MM)." }, { status: 400 });
        }

        // 과거 달이라도 생성을 건너뛰지 않는다 — start_date가 과거로 수정되거나(예: 최초 시작일을
        // 지난달로 변경) chore_id의 occurrence가 아직 하나도 없는 상태에서 과거 달을 조회하면,
        // "과거 달은 스킵"하는 최적화가 그 chore의 최초 occurrence를 영원히 생성하지 못하게 막는
        // 버그가 있었다(예: 8월에 시작일을 7월로 수정해도 7월 캘린더에 아무것도 안 뜸).
        const { data: activeChores, error: choresError } = await ctx.supabaseAdmin
          .from("chores")
          .select("*")
          .eq("user_id", userId)
          .eq("is_active", true);

        if (choresError) return Response.json({ error: choresError.message }, { status: 500 });

        await ensureOccurrencesUpToBatch(ctx.supabaseAdmin, (activeChores ?? []) as Chore[], monthWindow.end, today);

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

        // 다음 예정일 표시: chore별 "가장 최근 완료건"에만, 이미 생성돼 있는 다음 occurrence(미완료)의
        // 예정일을 새로 계산하지 않고 그대로 붙여서 보여준다.
        const doneList = (doneData ?? []) as Array<{ id: string; chore_id: string; completed_date: string }>;
        const choreIds = [...new Set(doneList.map((o) => o.chore_id))];

        const latestDoneIdByChore = new Map<string, string>();
        const nextScheduledByChore = new Map<string, string>();

        if (choreIds.length > 0) {
          const [{ data: allDoneForChores }, { data: allPendingForChores }] = await Promise.all([
            ctx.supabaseAdmin
              .from("chore_occurrences")
              .select("id, chore_id, completed_date")
              .in("chore_id", choreIds)
              .eq("status", "done")
              .order("completed_date", { ascending: false }),
            ctx.supabaseAdmin
              .from("chore_occurrences")
              .select("chore_id, scheduled_date")
              .in("chore_id", choreIds)
              .eq("status", "pending")
              .order("scheduled_date", { ascending: true }),
          ]);

          for (const row of (allDoneForChores ?? []) as Array<{ id: string; chore_id: string }>) {
            if (!latestDoneIdByChore.has(row.chore_id)) latestDoneIdByChore.set(row.chore_id, row.id);
          }
          for (const row of (allPendingForChores ?? []) as Array<{ chore_id: string; scheduled_date: string }>) {
            if (!nextScheduledByChore.has(row.chore_id)) nextScheduledByChore.set(row.chore_id, row.scheduled_date);
          }
        }

        const combined = [
          ...doneList.map((o) => ({
            ...o,
            next_scheduled_date:
              latestDoneIdByChore.get(o.chore_id) === o.id ? nextScheduledByChore.get(o.chore_id) ?? null : null,
          })),
          ...(pendingData ?? []),
        ];
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

      await ensureOccurrencesUpToBatch(ctx.supabaseAdmin, (activeChores ?? []) as Chore[], untilDate, today);

      let query = ctx.supabaseAdmin
        .from("chore_occurrences")
        .select("*, chores!inner(id, name, type, user_id, is_active)")
        .eq("chores.user_id", userId)
        .eq("chores.is_active", true);

      if (range === "today") {
        // 오늘 할 일 박스: 미완료는 예정일 기준, 완료는 완료일 기준(캘린더와 동일한 PRD 규칙)으로
        // 오늘에 속하는 항목만 보여준다. 완료 항목도 오늘 한 것이면 남겨서 재탭으로 해제할 수 있게 하고,
        // 예정일이 오늘이어도 미리 끝낸 항목은 제외한다. 체크 표시 구분은 프론트엔드가 한다.
        query = query.or(
          `and(status.eq.pending,scheduled_date.eq.${today}),and(status.eq.done,completed_date.eq.${today})`,
        );
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
      const { occurrenceId, completed, completedDate, choreId, date, deleteManual } = body as {
        occurrenceId?: string;
        completed?: boolean;
        completedDate?: string;
        choreId?: string;
        date?: string;
        deleteManual?: boolean;
      };

      // 수기 입력 삭제: 완전 삭제 + 파생된 다음 예정(미완료)도 함께 삭제 후, 남은 가장 최근 완료건
      // 기준으로 다음 예정을 다시 생성해 "수기 입력이 없었던 것처럼" 복원한다.
      if (deleteManual === true) {
        if (typeof occurrenceId !== "string") {
          return Response.json({ error: "occurrenceId가 필요해요." }, { status: 400 });
        }

        const { data: occurrence, error: occError } = await ctx.supabaseAdmin
          .from("chore_occurrences")
          .select("*, chores!inner(id, user_id)")
          .eq("id", occurrenceId)
          .single();

        if (occError || !occurrence || occurrence.chores.user_id !== userId) {
          return Response.json({ error: "해당 항목을 찾을 수 없어요." }, { status: 404 });
        }

        if (occurrence.completion_type !== "manual") {
          return Response.json({ error: "수기 입력 항목만 삭제할 수 있어요." }, { status: 400 });
        }

        const targetChoreId = occurrence.chores.id as string;

        await ctx.supabaseAdmin
          .from("chore_occurrences")
          .delete()
          .eq("chore_id", targetChoreId)
          .eq("status", "pending")
          .gt("scheduled_date", occurrence.scheduled_date);

        await ctx.supabaseAdmin.from("chore_occurrences").delete().eq("id", occurrenceId);

        const { data: chore, error: choreError } = await ctx.supabaseAdmin
          .from("chores")
          .select("*")
          .eq("id", targetChoreId)
          .single();

        if (choreError || !chore) return Response.json({ error: "해당 집안일을 찾을 수 없어요." }, { status: 404 });

        const today = todayKst();
        if (chore.is_active) {
          await ensureOccurrencesUpTo(ctx.supabaseAdmin, chore as Chore, addDays(today, 35), today);
        }

        return Response.json({ ok: true });
      }

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
        const today = todayKst();
        await ensureOccurrencesUpTo(ctx.supabaseAdmin, chore as Chore, addDays(today, 35), today);

        return Response.json({ occurrence: data });
      }

      if (typeof occurrenceId !== "string") {
        return Response.json({ error: "occurrenceId가 필요해요." }, { status: 400 });
      }

      // 소유권 확인 (다음 예정 재계산에 필요한 chore 전체 정보까지 함께 조회)
      const { data: occurrence, error: occError } = await ctx.supabaseAdmin
        .from("chore_occurrences")
        .select("*, chores!inner(*)")
        .eq("id", occurrenceId)
        .single();

      if (occError || !occurrence || occurrence.chores.user_id !== userId) {
        return Response.json({ error: "해당 항목을 찾을 수 없어요." }, { status: 404 });
      }

      const shouldComplete = completed !== false;
      const today = todayKst();

      // 수기 입력은 완전 삭제만 가능하고 체크 해제로 미완료로 되돌릴 수 없다 (PRD 규칙).
      if (!shouldComplete && occurrence.completion_type === "manual") {
        return Response.json({ error: "수기 입력은 완료 취소할 수 없어요. 삭제해 주세요." }, { status: 400 });
      }

      if (shouldComplete && completedDate !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(completedDate)) {
          return Response.json({ error: "completedDate 형식이 올바르지 않아요 (YYYY-MM-DD)." }, { status: 400 });
        }
        if (completedDate > today) {
          return Response.json({ error: "미래 날짜는 완료일로 지정할 수 없어요." }, { status: 400 });
        }
      }

      // completion_type은 최초 완료 시점에 정해지는 값이라 재토글로 바뀌면 안 된다.
      // 이미 manual로 기록된 항목(체크 해제 후 재체크 등)은 그 값을 유지하고,
      // 처음 완료 처리되는 항목만 regular로 채운다.
      const patch = shouldComplete
        ? {
            status: "done",
            completed_date: completedDate ?? today,
            completion_type: occurrence.completion_type ?? "regular",
          }
        : { status: "pending", completed_date: null, completion_type: null };

      const { data, error } = await ctx.supabaseAdmin
        .from("chore_occurrences")
        .update(patch)
        .eq("id", occurrenceId)
        .select("*")
        .single();

      if (error) return Response.json({ error: error.message }, { status: 500 });

      // 완료 처리는 다음 주기의 새 기준점이 된다(PRD 규칙). 이 occurrence보다 이후에 이미
      // 생성돼 있던 미완료 예정은 옛 기준으로 계산된 것이라 더 이상 맞지 않으므로 지우고,
      // 방금 완료한 날짜를 기준으로 다시 계산한다. (캘린더를 미리 넘겨봐서 다음 회차가 이미
      // 만들어져 있으면, 그 다음 회차가 "최신"으로 잡혀 재계산이 씹히는 버그의 수정)
      //
      // 체크 해제도 대칭적으로 되돌려야 한다: 완료 처리 때 새로 생성됐던 다음 회차(옛 기준일
      // 기준)는 더 이상 맞지 않으므로 지우고, 다시 미완료로 돌아간 이 occurrence의 예정일을
      // 기준으로 재계산한다. 그렇지 않으면 체크 해제 후에도 "취소 시점" 기준으로 계산된 다음
      // 예정이 그대로 남아, 원래 예정일이 아니라 취소하기 전 완료일 기준으로 계속 잡히는 버그가 생긴다.
      await ctx.supabaseAdmin
        .from("chore_occurrences")
        .delete()
        .eq("chore_id", occurrence.chore_id)
        .eq("status", "pending")
        .gt("scheduled_date", occurrence.scheduled_date);

      if (occurrence.chores.is_active) {
        await ensureOccurrencesUpTo(ctx.supabaseAdmin, occurrence.chores as Chore, addDays(today, 35), today);
      }

      return Response.json({ occurrence: data });
    }

    return Response.json({ error: "지원하지 않는 메서드예요." }, { status: 405 });
  }),
};
