// 집안일 항목(chores) CRUD.
// 클라이언트는 매 요청에 anon_key를 함께 보내고, 서버는 users 테이블에서 조회해 user_id를 확인한다.
// (mTLS 재검증은 verify-user 최초 로그인 시에만 수행하고, 이후 일반 CRUD는 생략 — anon_key 유출 시
// 트레이드오프가 있으나 이 서비스 규모에서는 허용 가능한 수준으로 판단)
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const MAX_ACTIVE_CHORES = 19;

type ChoreType = "general" | "one_time";
type RepeatMode = "fixed_date" | "interval";

interface ChoreInput {
  name: string;
  type: ChoreType;
  repeat_mode?: RepeatMode;
  interval_value?: number;
  interval_unit?: "day" | "week";
  fixed_unit?: "month" | "year";
  fixed_month?: number;
  fixed_day?: number;
  start_date: string;
}

function validateChoreInput(input: unknown): { ok: true; value: ChoreInput } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "요청 본문이 올바르지 않아요." };
  }
  const body = input as Record<string, unknown>;

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return { ok: false, error: "name이 필요해요." };
  }
  if (body.type !== "general" && body.type !== "one_time") {
    return { ok: false, error: "type은 general/one_time 중 하나여야 해요." };
  }
  if (typeof body.start_date !== "string") {
    return { ok: false, error: "start_date가 필요해요." };
  }

  if (body.type === "general") {
    if (body.repeat_mode !== "fixed_date" && body.repeat_mode !== "interval") {
      return { ok: false, error: "general 유형은 repeat_mode(fixed_date/interval)가 필요해요." };
    }
    if (body.repeat_mode === "interval") {
      if (typeof body.interval_value !== "number" || body.interval_value <= 0) {
        return { ok: false, error: "interval 방식은 interval_value(양수)가 필요해요." };
      }
      if (body.interval_unit !== "day" && body.interval_unit !== "week") {
        return { ok: false, error: "interval 방식은 interval_unit(day/week)이 필요해요." };
      }
    }
    if (body.repeat_mode === "fixed_date") {
      if (body.fixed_unit !== "month" && body.fixed_unit !== "year") {
        return { ok: false, error: "fixed_date 방식은 fixed_unit(month/year)이 필요해요." };
      }
      if (body.fixed_unit === "year" && typeof body.fixed_month !== "number") {
        return { ok: false, error: "매년 반복은 fixed_month가 필요해요." };
      }
      if (typeof body.fixed_day !== "number") {
        return { ok: false, error: "fixed_date 방식은 fixed_day가 필요해요." };
      }
    }
  }

  return { ok: true, value: body as unknown as ChoreInput };
}

export default {
  fetch: withSupabase({ auth: ["publishable"] }, async (req, ctx) => {
    const url = new URL(req.url);
    // 커스텀 헤더(x-anon-key)는 Supabase Edge Function의 CORS preflight에서
    // 누락되는 알려진 이슈가 있어(플랫폼 인프라가 Access-Control-Allow-Headers를
    // 잘라냄), 헤더 대신 쿼리 파라미터로 전달받는다.
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

    // GET /chores — 내 집안일 목록 조회 (기본: 활성 항목만)
    if (req.method === "GET") {
      const includeInactive = url.searchParams.get("includeInactive") === "true";
      let query = ctx.supabaseAdmin.from("chores").select("*").eq("user_id", userId);
      if (!includeInactive) query = query.eq("is_active", true);

      const { data, error } = await query.order("created_at", { ascending: true });
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ chores: data });
    }

    // POST /chores — 신규 등록
    if (req.method === "POST") {
      const body = await req.json();
      const validated = validateChoreInput(body);
      if (!validated.ok) {
        return Response.json({ error: validated.error }, { status: 400 });
      }

      const { count, error: countError } = await ctx.supabaseAdmin
        .from("chores")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_active", true);

      if (countError) return Response.json({ error: countError.message }, { status: 500 });
      if ((count ?? 0) >= MAX_ACTIVE_CHORES) {
        return Response.json(
          { error: `집안일은 최대 ${MAX_ACTIVE_CHORES}개까지 등록할 수 있어요.` },
          { status: 400 },
        );
      }

      const { data, error } = await ctx.supabaseAdmin
        .from("chores")
        .insert({ ...validated.value, user_id: userId })
        .select("*")
        .single();

      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ chore: data }, { status: 201 });
    }

    // PATCH /chores?id=... — 수정 (활성/비활성 전환 포함)
    if (req.method === "PATCH") {
      const id = url.searchParams.get("id");
      if (!id) return Response.json({ error: "id 쿼리 파라미터가 필요해요." }, { status: 400 });

      const body = await req.json();

      const { data, error } = await ctx.supabaseAdmin
        .from("chores")
        .update(body)
        .eq("id", id)
        .eq("user_id", userId)
        .select("*")
        .single();

      if (error) return Response.json({ error: error.message }, { status: 500 });

      // 반복 규칙이 바뀐 경우, 옛 규칙으로 이미 생성된 미래 미완료 예정은 더 이상 맞지 않으므로
      // 지운다. 다음 occurrences 조회 시 ensureOccurrencesUpTo가 새 규칙으로 재생성한다.
      const SCHEDULE_FIELDS = [
        "type",
        "repeat_mode",
        "interval_value",
        "interval_unit",
        "fixed_unit",
        "fixed_month",
        "fixed_day",
        "start_date",
      ];
      const scheduleChanged = Object.keys(body).some((key) => SCHEDULE_FIELDS.includes(key));
      if (scheduleChanged) {
        const today = new Date().toISOString().slice(0, 10);
        await ctx.supabaseAdmin
          .from("chore_occurrences")
          .delete()
          .eq("chore_id", id)
          .eq("status", "pending")
          .gte("scheduled_date", today);
      }

      return Response.json({ chore: data });
    }

    // DELETE /chores?id=... — 완전 삭제
    if (req.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return Response.json({ error: "id 쿼리 파라미터가 필요해요." }, { status: 400 });

      const { error } = await ctx.supabaseAdmin.from("chores").delete().eq("id", id).eq("user_id", userId);
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return new Response(null, { status: 204 });
    }

    return Response.json({ error: "지원하지 않는 메서드예요." }, { status: 405 });
  }),
};
