// 클라이언트가 앱인토스 SDK User.getAnonymousKey()로 받은 익명 식별키(hash)를
// 앱인토스 서버 API로 검증한 뒤, users 테이블에서 조회하거나 새로 생성해 매핑한다.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const ANON_KEY_VERIFY_URL =
  "https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss/users/anon-key/verify";

function getMtlsClient() {
  const cert = Deno.env.get("APPS_IN_TOSS_MTLS_CERT")?.replaceAll("\\n", "\n");
  const key = Deno.env.get("APPS_IN_TOSS_MTLS_KEY")?.replaceAll("\\n", "\n");

  if (!cert || !key) {
    throw new Error("APPS_IN_TOSS_MTLS_CERT/KEY secret이 설정되지 않았어요.");
  }

  // @ts-expect-error Deno.createHttpClient는 unstable API라 타입 정의에 없을 수 있음
  return Deno.createHttpClient({ cert, key });
}

async function verifyAnonKey(anonKey: string): Promise<boolean> {
  const client = getMtlsClient();

  const res = await fetch(ANON_KEY_VERIFY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-anon-key": anonKey,
    },
    // @ts-expect-error client 옵션은 Deno 확장 fetch 옵션
    client,
  });

  if (!res.ok) return false;

  const body = await res.json();
  // 문서 예시는 success: "true"(문자열)였지만 실제 응답은 boolean true로 내려옴 — 둘 다 안전하게 처리
  return body?.resultType === "SUCCESS" && String(body?.success) === "true";
}

export default {
  // publishable(클라이언트) 키로만 호출 가능 — 브라우저/미니앱에서 직접 호출하는 엔드포인트
  fetch: withSupabase({ auth: ["publishable"] }, async (req, ctx) => {
    const { anonKey } = await req.json();

    if (typeof anonKey !== "string" || anonKey.length === 0) {
      return Response.json({ error: "anonKey가 필요해요." }, { status: 400 });
    }

    const isValid = await verifyAnonKey(anonKey);
    if (!isValid) {
      return Response.json({ error: "유효하지 않은 식별키예요." }, { status: 401 });
    }

    // ctx.supabaseAdmin은 RLS를 우회하는 service_role 클라이언트
    const { data, error } = await ctx.supabaseAdmin
      .from("users")
      .upsert({ anon_key: anonKey }, { onConflict: "anon_key" })
      .select("id, notification_time, reminder_time, reminder_time_enabled, reminder_days")
      .single();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ user: data });
  }),
};
