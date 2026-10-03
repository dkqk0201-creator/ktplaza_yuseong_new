import { formatCtn } from "@/lib/format";
import { dateText } from "@/lib/sale-display";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 카드실적 미검수 안내 — 직원에게 카카오톡으로 보낼 글.
 * CTN 은 전체 번호(010-1234-5678)를 쓴다 (카드실적 화면에서만).
 */

/**
 * 카드실적 대상 여부: 장표 정상 구조 기준 AE열 '제카' = "O" 인 판매만.
 * (AE=O / AF=카드사명 / AG=카드실적 검수(등록))
 */
export function isCardTarget(sale: SheetSale): boolean {
  return sale.jeca.trim().toUpperCase() === "O";
}

/** 화면·카톡에 보여줄 카드 종류 = AF열 값 (예: 우리) */
export function cardName(sale: SheetSale): string {
  return sale.cardType.trim() || "-";
}

const TITLE = "[카드실적 미검수 안내]";
const CLOSING = "카드실적 검수 확인 부탁드립니다.";

function ctnText(sale: SheetSale): string {
  return sale.ctn ? formatCtn(sale.ctn) : "-";
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
    `카드 : ${cardName(sale)}`,
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
          `${i + 1}. ${sale.customer || "-"} / ${dateText(sale.activatedAt)} / ${cardName(sale)} / ${ctnText(sale)}`,
      ),
    ].join("\n");
  });
  return [TITLE, "", ...blocks.flatMap((b) => [b, ""]), CLOSING].join("\n");
}
