// mTLS 지원 여부만 확인하는 최소 테스트 함수.
// 앱인토스 식별키 검증 API(mTLS 필요)를 호출해보고 성공/실패를 그대로 반환한다.
import "@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async () => {
  // .env 파일을 통해 저장된 값은 리터럴 "\n"(백슬래시+n)으로 개행을 표현하므로
  // 실제 줄바꿈 문자로 되돌려준다.
  const cert = Deno.env.get("APPS_IN_TOSS_MTLS_CERT")?.replaceAll("\\n", "\n");
  const key = Deno.env.get("APPS_IN_TOSS_MTLS_KEY")?.replaceAll("\\n", "\n");

  if (!cert || !key) {
    return Response.json(
      { ok: false, step: "env", message: "APPS_IN_TOSS_MTLS_CERT/KEY secret이 설정되지 않았어요." },
      { status: 500 },
    );
  }

  const debug = {
    certLength: cert.length,
    certStartsWith: cert.slice(0, 27),
    certEndsWith: cert.slice(-25),
    keyLength: key.length,
    keyStartsWith: key.slice(0, 27),
    keyEndsWith: key.slice(-25),
  };

  try {
    // @ts-expect-error Deno.createHttpClient는 unstable API라 타입 정의에 없을 수 있음
    const client = Deno.createHttpClient({ cert, key });

    const res = await fetch(
      "https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss/users/anon-key/verify",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-anon-key": "dummy-key-for-mtls-connectivity-test",
        },
        // @ts-expect-error client 옵션은 Deno 확장 fetch 옵션
        client,
      },
    );

    const body = await res.text();
    return Response.json({ ok: true, step: "fetch", status: res.status, body });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        step: "fetch",
        message: error instanceof Error ? error.message : String(error),
        debug,
      },
      { status: 500 },
    );
  }
});
