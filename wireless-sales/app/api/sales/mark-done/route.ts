import { MARK_DONE_FIELDS, MARK_DONE_LABEL, type MarkDoneResponse } from "@/lib/mark-done-api";
import { parseSaleTarget } from "@/lib/sale-target";
import { markCellDone } from "@/lib/server/mark-done";
import { COLUMN_LETTER } from "@/lib/sheet-columns";
import { cellText } from "@/lib/sheet-record";

/*
 * 검수관리 판매 상세 "검수완료"(G열)·"수납완료"(H열) API: 그 칸 하나만 O 로 저장.
 * 식별·안전장치는 lib/server/mark-done.ts (카드실적 등록완료와 같은 방식).
 */

function reply(body: MarkDoneResponse, status: number) {
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
  const field = MARK_DONE_FIELDS.find((f) => f === input.field) as "inspected" | "paid" | undefined;
  const before = typeof input.before === "string" && input.before.length <= 20 ? input.before : null;
  if (!target || !field || before === null) {
    return reply({ ok: false, message: "처리할 판매 건 정보가 올바르지 않습니다." }, 400);
  }
  const label = MARK_DONE_LABEL[field];
  if (cellText(before).toUpperCase() === "O") {
    return reply({ ok: false, message: `이미 ${label}(${COLUMN_LETTER[field]} = O)된 판매입니다. 화면을 새로고침해 주세요.` }, 409);
  }
  const result = await markCellDone(target, field, before, label);
  if (!result.ok) return reply({ ok: false, message: result.message }, result.status);
  return reply(
    { ok: true, message: `${label}되었습니다. (${COLUMN_LETTER[field]}열 = O)`, row: result.row, no: result.no, values: result.values },
    200,
  );
}
