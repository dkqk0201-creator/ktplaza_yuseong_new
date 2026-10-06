import type { CardCheckResponse } from "@/lib/card-check-api";
import { parseSaleTarget } from "@/lib/sale-target";
import { markCellDone } from "@/lib/server/mark-done";
import { cellText } from "@/lib/sheet-record";

/*
 * 카드실적 "등록완료" API: 판매 1건의 AG열(카드실적 검수)만 O 로 저장.
 * 식별·안전장치는 lib/server/mark-done.ts (검수관리 검수완료·수납완료와 같은 방식):
 * - 같은 월 시트·같은 행 + No.·개통일·고객·CTN 이 모두 같을 때만, AG 지금 값 = 화면에서 본 값일 때만
 * - AG 외 다른 칸은 쓰지 않음, 저장 후 값에서 AG = O 확인 뒤에만 성공
 */

function reply(body: CardCheckResponse, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let input: Record<string, unknown>;
  try {
    input = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }
  const target = parseSaleTarget(input.target);
  const before = typeof input.before === "string" && input.before.length <= 20 ? input.before : null;
  if (!target || before === null) {
    return reply({ ok: false, message: "등록완료할 판매 건 정보가 올바르지 않습니다." }, 400);
  }
  if (cellText(before).toUpperCase() === "O") {
    return reply({ ok: false, message: "이미 등록완료(AG = O)된 카드입니다. 화면을 새로고침해 주세요." }, 409);
  }
  const result = await markCellDone(target, "cardChecked", before, "카드 등록완료");
  if (!result.ok) {
    return reply(
      { ok: false, message: result.message.replace(/^저장하지 못했습니다\./, "등록완료를 저장하지 못했습니다.") },
      result.status,
    );
  }
  return reply(
    { ok: true, message: "등록완료되었습니다. (카드실적 검수 AG = O)", row: result.row, values: result.values },
    200,
  );
}
