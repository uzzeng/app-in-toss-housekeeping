// 알림 발송 스케줄러 (pg_cron이 매분 호출).
// PRD 규칙: "최초알림 vs 재알림"은 발송 시간대(알림시간/리마인드시간)가 아니라 그 occurrence가
// 오늘 처음 예정에 도래했는지(scheduled_date = 오늘) 며칠째 미완료로 남아있는지(scheduled_date < 오늘)로 구분됨.
// 같은 최초알림 대상이라도 알림 시간(08:00)과 리마인드 시간(21:00) 둘 다에 발송됨 — 리마인드 토글은
// "그 시각에 보낼지"만 결정하고 최초/재알림 문구 자체를 바꾸지 않음.
// 대상 occurrence: scheduled_date <= 오늘 && status = pending && (오늘 - scheduled_date) <= reminder_days
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const SEND_MESSAGE_URL =
  "https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss/messenger/send-message";

const TEMPLATE_DAILY = "housekeeping-daily";
const TEMPLATE_REMIND = "housekeeping-remind";

interface UserRow {
  id: string;
  anon_key: string;
  notification_time: string; // "HH:MM:SS"
  notification_time_enabled: boolean;
  reminder_time: string;
  reminder_time_enabled: boolean;
  reminder_days: number;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / 86_400_000);
}

// "오늘" 판단이 KST 자정 기준이어야 하므로(UTC 기준이면 KST 00:00~08:59에 하루 어긋남),
// UTC 시각에 9시간을 더한 뒤 UTC 게터로 읽어 KST의 날짜/시:분을 얻는다.
function nowKst(): Date {
  const now = new Date();
  return new Date(now.getTime() + 9 * 60 * 60 * 1000);
}

function kstDateOnly(kst: Date): string {
  return kst.toISOString().slice(0, 10);
}

function kstHm(kst: Date): string {
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function hmOf(timeStr: string): string {
  return timeStr.slice(0, 5); // "HH:MM:SS" -> "HH:MM"
}

function getMtlsClient() {
  const cert = Deno.env.get("APPS_IN_TOSS_MTLS_CERT")?.replaceAll("\\n", "\n");
  const key = Deno.env.get("APPS_IN_TOSS_MTLS_KEY")?.replaceAll("\\n", "\n");

  if (!cert || !key) {
    throw new Error("APPS_IN_TOSS_MTLS_CERT/KEY secret이 설정되지 않았어요.");
  }

  // @ts-expect-error Deno.createHttpClient는 unstable API라 타입 정의에 없을 수 있음
  return Deno.createHttpClient({ cert, key });
}

async function sendMessage(anonKey: string, templateSetCode: string, count: number): Promise<boolean> {
  const client = getMtlsClient();
  const res = await fetch(SEND_MESSAGE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-anon-key": anonKey,
    },
    body: JSON.stringify({ templateSetCode, context: { count } }),
    // @ts-expect-error client 옵션은 Deno 확장 fetch 옵션
    client,
  });
  const body = await res.text();
  console.log(`sendMessage ${templateSetCode} status=${res.status} body=${body}`);
  return res.ok;
}

interface SupabaseAdminLike {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

async function processUser(supabaseAdmin: SupabaseAdminLike, user: UserRow, today: string, nowHm: string) {
  const isDailyTime = user.notification_time_enabled && hmOf(user.notification_time) === nowHm;
  const isRemindTime = user.reminder_time_enabled && hmOf(user.reminder_time) === nowHm;

  if (!isDailyTime && !isRemindTime) return;

  const { data: pendingOccurrences, error: pendingError } = await supabaseAdmin
    .from("chore_occurrences")
    .select("id, scheduled_date, reminder_count, chores!inner(user_id, is_active)")
    .eq("chores.user_id", user.id)
    .eq("chores.is_active", true)
    .eq("status", "pending")
    .lte("scheduled_date", today);

  if (pendingError) console.log(`pendingOccurrences query error: ${pendingError.message}`);

  const dailyRows: Array<{ id: string; reminder_count: number }> = [];
  const remindRows: Array<{ id: string; reminder_count: number }> = [];

  for (const o of (pendingOccurrences ?? []) as Array<{
    id: string;
    scheduled_date: string;
    reminder_count: number;
  }>) {
    const elapsed = daysBetween(o.scheduled_date, today);
    if (elapsed > user.reminder_days) continue; // 재알림 일수 소진 — 알림 대상 아님(항목은 그대로 미완료 유지)
    if (elapsed === 0) dailyRows.push(o);
    else remindRows.push(o);
  }

  console.log(
    `user=${user.id} today=${today} isDailyTime=${isDailyTime} isRemindTime=${isRemindTime} pendingCount=${(pendingOccurrences ?? []).length} dailyRows=${dailyRows.length} remindRows=${remindRows.length}`,
  );

  // 알림 시간이든 리마인드 시간이든, 그 시각에 발송하기로 한 시점이면 최초알림 대상(dailyRows)과
  // 재알림 대상(remindRows)을 유형별로 각각 별개 푸시로 발송 (PRD: 유형이 섞이면 묶지 않고 분리 발송)
  if (isDailyTime || isRemindTime) {
    if (dailyRows.length > 0) {
      const ok = await sendMessage(user.anon_key, TEMPLATE_DAILY, dailyRows.length);
      if (ok) await bumpReminderCount(supabaseAdmin, dailyRows);
    }
    if (remindRows.length > 0) {
      const ok = await sendMessage(user.anon_key, TEMPLATE_REMIND, remindRows.length);
      if (ok) await bumpReminderCount(supabaseAdmin, remindRows);
    }
  }
}

async function bumpReminderCount(
  supabaseAdmin: SupabaseAdminLike,
  rows: Array<{ id: string; reminder_count: number }>,
) {
  await Promise.all(
    rows.map((r) =>
      supabaseAdmin.from("chore_occurrences").update({ reminder_count: r.reminder_count + 1 }).eq("id", r.id),
    ),
  );
}

export default {
  // 크론(서버)만 호출하는 내부 엔드포인트 — secret(service_role) 키 인증 필요
  fetch: withSupabase({ auth: "secret" }, async (_req, ctx) => {
    const kst = nowKst();
    const today = kstDateOnly(kst);
    const nowHm = kstHm(kst);

    const { data: users, error } = await ctx.supabaseAdmin
      .from("users")
      .select(
        "id, anon_key, notification_time, notification_time_enabled, reminder_time, reminder_time_enabled, reminder_days",
      );

    if (error) return Response.json({ error: error.message }, { status: 500 });

    const targets = (users ?? []).filter(
      (u: UserRow) =>
        (u.notification_time_enabled && hmOf(u.notification_time) === nowHm) ||
        (u.reminder_time_enabled && hmOf(u.reminder_time) === nowHm),
    );

    await Promise.all(targets.map((u: UserRow) => processUser(ctx.supabaseAdmin, u, today, nowHm)));

    return Response.json({ processed: targets.length });
  }),
};
