import type { UpdateSaleTarget } from "@/lib/update-sale-api";

/*
 * 판매 1건 식별값 검사 (판매 수정·카드실적 등록완료 공용 규칙).
 * Apps Script 는 행 번호만 믿지 않고 No.(B)·개통일(C)·고객(D)·CTN(E) 이 이 값과 모두 같을 때만 고친다.
 * UMNP 판매는 No. 가 빈칸이다 (그때도 개통일·고객·CTN 은 반드시 맞아야 함).
 */
export function parseSaleTarget(input: unknown): UpdateSaleTarget | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.length <= max ? v.trim() : null;
  const sheet = str(raw.sheet, 3);
  const no = str(raw.no, 10);
  const activatedAt = str(raw.activatedAt, 20);
  const customer = str(raw.customer, 50);
  const ctn = str(raw.ctn, 20);
  const row = raw.row;
  if (
    sheet === null ||
    !/^(1[0-2]|[1-9])월$/.test(sheet) ||
    typeof row !== "number" ||
    !Number.isInteger(row) ||
    row < 9 ||
    row > 5000 ||
    no === null ||
    activatedAt === null ||
    customer === null ||
    ctn === null ||
    (customer === "" && ctn === "")
  ) {
    return null;
  }
  return { sheet, row, no, activatedAt, customer, ctn };
}
