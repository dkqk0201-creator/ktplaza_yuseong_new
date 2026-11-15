import { requireAuth } from "@/lib/server/auth";
import { getSalesConfig } from "@/lib/server/sales-config";

/*
 * 판매 설정 조회 (점장 전용 — 로그인 확인부터).
 *   GET /api/settings/config → { ok, inflows, campaigns, inflowVersion, campaignVersion, fallback? }
 * 유입경로 항목·캠페인 목록 (고객 정보 없음). 간편등록·판매 수정·유입·캠페인 분석 화면이 함께 쓴다.
 */
export async function GET(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  const config = await getSalesConfig({ fresh: true });
  return Response.json({ ok: true, ...config }, { headers: { "Cache-Control": "no-store" } });
}
