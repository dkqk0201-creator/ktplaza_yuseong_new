import type { UpdateSaleTarget } from "@/lib/update-sale-api";

/*
 * 판매 1건 식별값 검사 (판매 수정·카드실적 등록완료 공용 규칙).
 * Apps Script 는 행 번호만 믿지 않는다:
 *   - 판매 ID(B열 메모)가 있는 판매: saleId 가 같고 시트에 그 ID 가 1행뿐이며 No.·개통일이 같을 때만
 *   - 기존 판매(ID 없음): No.·개통일 + 마스킹한 고객명·CTN 이 같고, 같은 고객으로 보이는 판매가 1건일 때만
 * 화면에는 마스킹된 고객명·CTN 만 있으므로 customer·ctn 은 마스킹 값이다.
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
  // 판매 ID (신규 판매만, B열 메모). 형식이 틀리면 거부
  const saleId = parseSaleIdField(raw.saleId);
  if (saleId === null) return null;
  return { sheet, row, no, activatedAt, customer, ctn, ...(saleId ? { saleId } : {}) };
}

const SALE_ID_RE = /^S-[A-Za-z0-9]{12,40}$/;

/** 판매 ID 입력: 없음/빈칸 → "", 형식 오류 → null */
export function parseSaleIdField(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "";
  return typeof value === "string" && SALE_ID_RE.test(value) ? value : null;
}

/** 화면의 판매 1건 → 서버로 보낼 식별값 (판매 ID 가 있으면 함께) */
export function saleTargetOf(
  sheet: string,
  sale: {
    row: number;
    no: string;
    activatedAt: string;
    customer: string;
    ctn: string;
    saleId?: string;
  },
): UpdateSaleTarget {
  return {
    sheet,
    row: sale.row,
    no: sale.no,
    activatedAt: sale.activatedAt,
    customer: sale.customer,
    ctn: sale.ctn,
    ...(sale.saleId ? { saleId: sale.saleId } : {}),
  };
}
