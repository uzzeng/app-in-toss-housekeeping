// 사용자 알림 설정(notification_time/reminder_time/reminder_time_enabled/reminder_days) 조회/수정.
// GET   /user-settings — 현재 설정 조회
// PATCH /user-settings — 설정 수정 (재알림 일수 등은 다음 스캔부터 즉시 반영되므로 별도 소급 처리 불필요 —
//   send-reminders가 매번 users 테이블에서 최신값을 읽기 때문)
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

interface SettingsInput {
  notification_time?: string;
  notification_time_enabled?: boolean;
  reminder_time?: string;
  reminder_time_enabled?: boolean;
  reminder_days?: number;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function validateSettingsInput(input: unknown): { ok: true; value: SettingsInput } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "요청 본문이 올바르지 않아요." };
  }
  const body = input as Record<string, unknown>;
  const value: SettingsInput = {};

  if (body.notification_time !== undefined) {
    if (typeof body.notification_time !== "string" || !TIME_RE.test(body.notification_time)) {
      return { ok: false, error: "notification_time 형식이 올바르지 않아요 (HH:MM)." };
    }
    value.notification_time = body.notification_time;
  }
  if (body.notification_time_enabled !== undefined) {
    if (typeof body.notification_time_enabled !== "boolean") {
      return { ok: false, error: "notification_time_enabled는 boolean이어야 해요." };
    }
    value.notification_time_enabled = body.notification_time_enabled;
  }
  if (body.reminder_time !== undefined) {
    if (typeof body.reminder_time !== "string" || !TIME_RE.test(body.reminder_time)) {
      return { ok: false, error: "reminder_time 형식이 올바르지 않아요 (HH:MM)." };
    }
    value.reminder_time = body.reminder_time;
  }
  if (body.reminder_time_enabled !== undefined) {
    if (typeof body.reminder_time_enabled !== "boolean") {
      return { ok: false, error: "reminder_time_enabled는 boolean이어야 해요." };
    }
    value.reminder_time_enabled = body.reminder_time_enabled;
  }
  if (body.reminder_days !== undefined) {
    if (typeof body.reminder_days !== "number" || !Number.isInteger(body.reminder_days) || body.reminder_days < 0) {
      return { ok: false, error: "reminder_days는 0 이상의 정수여야 해요." };
    }
    value.reminder_days = body.reminder_days;
  }

  return { ok: true, value };
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
      .select(
        "id, notification_time, notification_time_enabled, reminder_time, reminder_time_enabled, reminder_days",
      )
      .eq("anon_key", anonKey)
      .single();

    if (userError || !user) {
      return Response.json({ error: "사용자를 찾을 수 없어요. 먼저 로그인해 주세요." }, { status: 401 });
    }

    if (req.method === "GET") {
      return Response.json({ settings: user });
    }

    if (req.method === "PATCH") {
      const body = await req.json();
      const validated = validateSettingsInput(body);
      if (!validated.ok) {
        return Response.json({ error: validated.error }, { status: 400 });
      }

      const { data, error } = await ctx.supabaseAdmin
        .from("users")
        .update(validated.value)
        .eq("id", user.id)
        .select(
        "id, notification_time, notification_time_enabled, reminder_time, reminder_time_enabled, reminder_days",
      )
        .single();

      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ settings: data });
    }

    return Response.json({ error: "지원하지 않는 메서드예요." }, { status: 405 });
  }),
};
