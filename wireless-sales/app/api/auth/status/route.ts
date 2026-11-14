import { authenticate } from "@/lib/server/auth";

/*
 * 로그인 상태 확인 API (GET). 화면이 처음 열릴 때·다른 탭에서 돌아올 때·절전에서 깨어날 때·5분마다 부른다.
 * - 업무 API 와 같은 인증 확인을 한다 (다른 기기에서 "모든 기기 로그아웃"을 했으면 여기서 401).
 * - 세션을 늘리지 않는다 (자동 확인은 사용자 활동이 아님).
 * - 돌려주는 값은 서버 시각·최대 만료·미사용 만료뿐 (세션 값·비밀값 없음).
 */
export async function GET(request: Request) {
  const result = await authenticate(request);
  if (result.denied) return result.denied;
  return Response.json(
    { ok: true, now: Math.floor(Date.now() / 1000), exp: result.session.exp, idleExp: result.session.idleExp },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
