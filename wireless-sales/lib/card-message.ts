import { dateText, maskedCtn } from "@/lib/sale-display";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 카드실적 미검수 안내 — 직원에게 카카오톡으로 보낼 글.
 * CTN 은 화면과 같이 가운데를 가린 번호(010-****-1234)만 쓴다.
 */

const TITLE = "[카드실적 미검수 안내]";
const CLOSING = "카드실적 검수 확인 부탁드립니다.";

function ctnText(sale: SheetSale): string {
  return sale.ctn ? maskedCtn(sale.ctn) : "-";
}

/** 1명 상세보기용 */
export function cardPendingMessage(sale: SheetSale): string {
  return [
    TITLE,
    "",
    `직원 : ${sale.staff || "-"}`,
    `고객 : ${sale.customer || "-"}`,
    `개통일 : ${dateText(sale.activatedAt)}`,
    `CTN : ${ctnText(sale)}`,
    `카드 : ${sale.cardType || "-"}`,
    "",
    CLOSING,
  ].join("\n");
}

/** 여러 명: 직원별로 묶어서 "직원 / 총 N건" + 번호 목록 */
export function cardPendingListMessage(sales: readonly SheetSale[]): string {
  const groups = new Map<string, SheetSale[]>();
  for (const sale of [...sales].sort((a, b) => a.row - b.row)) {
    const staff = sale.staff || "직원 미입력";
    groups.set(staff, [...(groups.get(staff) ?? []), sale]);
  }
  const names = [...groups.keys()].sort((a, b) => a.localeCompare(b, "ko"));
  const blocks = names.map((staff) => {
    const list = groups.get(staff)!;
    return [
      `${staff} / 총 ${list.length}건`,
      "",
      ...list.map(
        (sale, i) =>
          `${i + 1}. ${sale.customer || "-"} / ${dateText(sale.activatedAt)} / ${sale.cardType || "-"} / ${ctnText(sale)}`,
      ),
    ].join("\n");
  });
  return [TITLE, "", ...blocks.flatMap((b) => [b, ""]), CLOSING].join("\n");
}
