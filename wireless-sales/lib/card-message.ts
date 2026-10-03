import { formatCtn } from "@/lib/format";
import { dateText } from "@/lib/sale-display";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 카드실적 미검수 안내 — 직원에게 카카오톡으로 보낼 글.
 * CTN 은 전체 번호(010-1234-5678)를 쓴다 (카드실적 화면에서만).
 */

/** 카드실적 대상 아님으로 보는 AE열 값 */
const NOT_CARD = new Set(["", "X", "-"]);

/**
 * 카드실적 대상 여부: AE열 '제카' 값만 본다 (AF열은 판정에 쓰지 않는다).
 * X·빈칸·"-" 가 아니면 대상 (예: 우리, 신한, 현대, O).
 */
export function isCardTarget(sale: SheetSale): boolean {
  return !NOT_CARD.has(sale.jeca.trim().toUpperCase());
}

/**
 * 화면·카톡에 보여줄 카드 종류 = AE열 제카 값 (예: 우리).
 * 예전 방식으로 AE 에 "O" 만 있고 카드 이름이 AF열에 있는 판매는 AF 값을 보여준다.
 */
export function cardName(sale: SheetSale): string {
  const jeca = sale.jeca.trim();
  if (jeca.toUpperCase() === "O") {
    const af = sale.cardType.trim();
    return af && !NOT_CARD.has(af.toUpperCase()) ? af : "O";
  }
  return jeca || "-";
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
