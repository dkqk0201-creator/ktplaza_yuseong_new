import type { Budget } from "@/lib/budget";

/*
 * 예산관리 "고불비사용" (화면·서버 공용, 비밀값 없음).
 * 기록은 같은 스프레드시트의 별도 시트 "고불비사용내역" 에만 저장한다 (Apps Script gobulbi.gs).
 * 월별 무선장표(N·U·AB·AC 수식·판매정보)는 건드리지 않는다.
 *
 * 계산 (선택한 월, 지급일 기준, 삭제된 내역 제외):
 *   고불비사용 합계 = 그 달 고불비사용 금액 합계
 *   현금예산        = AB열 합계 − 고불비사용 합계      ← 차감은 여기서 한 번만
 *   총 매장 예산    = 고객혜택 잔여금액 + 스팟예산 + 차감 후 현금예산
 *   → 총 매장 예산 = 장표 AC 합계 − 고불비사용 합계 (화면에서 검증)
 */

export const GOBULBI_SHEET = "고불비사용내역";
/** gobulbi.gs 가 모든 응답에 붙이는 표시 (다른 코드의 응답과 구분) */
export const GOBULBI_HANDLER = "ws-gobulbi";
export const GOBULBI_CONTENT_MAX = 100;
export const GOBULBI_AMOUNT_MAX = 10_000_000;
export const GOBULBI_SELLER_MAX = 20;
export const GOBULBI_ENDPOINT = "/api/budget/gobulbi";

export interface GobulbiItem {
  id: string;
  /** 지급일 YYYY-MM-DD (등록 시 자동, 수정 불가) */
  payDate: string;
  content: string;
  amount: number;
  seller: string;
  createdAt: string;
  updatedAt: string;
}

export interface GobulbiMonth {
  month: string;
  items: GobulbiItem[];
  total: number;
  /** 형식이 잘못돼 합계에 넣지 못한 행 수 (구글시트에서 직접 고친 경우 등) */
  invalidRows: number;
}

/** 수정·삭제 때 함께 보내는 "화면에서 본 값" (시트 값과 다르면 Apps Script 가 거부) */
export interface GobulbiBefore {
  content: string;
  amount: number;
  seller: string;
  updatedAt: string;
}

export const beforeOf = (item: GobulbiItem): GobulbiBefore => ({
  content: item.content,
  amount: item.amount,
  seller: item.seller,
  updatedAt: item.updatedAt,
});

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const GOBULBI_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** 입력 확인 (화면·서버 공통). 문제 없으면 null */
export function gobulbiContentError(content: string): string | null {
  const t = content.trim();
  if (!t) return "내용을 입력해 주세요.";
  if (t.length > GOBULBI_CONTENT_MAX) return `내용은 ${GOBULBI_CONTENT_MAX}자 이하로 입력해 주세요.`;
  if (/[\r\n\t]/.test(t)) return "내용은 한 줄로 입력해 주세요.";
  return null;
}

export function gobulbiAmountError(amount: unknown): string | null {
  if (
    typeof amount !== "number" ||
    !Number.isInteger(amount) ||
    amount < 1 ||
    amount > GOBULBI_AMOUNT_MAX
  ) {
    return `금액은 1원 이상 ${GOBULBI_AMOUNT_MAX.toLocaleString("ko-KR")}원 이하의 정수로 입력해 주세요.`;
  }
  return null;
}

export function gobulbiSellerError(seller: string, staff: readonly string[]): string | null {
  return staff.includes(seller.trim()) ? null : "판매자를 직원 목록에서 선택해 주세요.";
}

/** 금액 입력 글자 → 원. "50,000" "50000원" "5만" 허용. 해석 못 하면 null */
export function parseGobulbiAmount(text: string): number | null {
  const t = text.replace(/[\s,]/g, "").replace(/원$/, "");
  const man = /^(\d+(?:\.\d+)?)만$/.exec(t);
  if (man) {
    const v = Number(man[1]) * 10000;
    return Number.isInteger(v) ? v : null;
  }
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** 새 고유 ID (입력창을 열 때 한 번 만든다 → 다시 눌러도 같은 ID 라 중복 저장되지 않음) */
export function newGobulbiId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function str(v: unknown, max = 200): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/** Apps Script 응답의 기록 1건 → GobulbiItem (형식이 틀리면 null) */
export function parseGobulbiItem(v: unknown): GobulbiItem | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const amount = typeof o.amount === "number" && Number.isFinite(o.amount) ? o.amount : null;
  const id = str(o.id, 64);
  const payDate = str(o.payDate, 10);
  if (!GOBULBI_ID_RE.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(payDate) || amount === null) return null;
  return {
    id,
    payDate,
    content: str(o.content, GOBULBI_CONTENT_MAX + 50),
    amount,
    seller: str(o.seller, GOBULBI_SELLER_MAX + 10),
    createdAt: str(o.createdAt, 30),
    updatedAt: str(o.updatedAt, 30),
  };
}

/** 지급일 → 개통일순과 같은 오름차순 (같은 날은 등록 순) */
export function sortGobulbi(items: GobulbiItem[]): GobulbiItem[] {
  return [...items].sort((a, b) =>
    a.payDate !== b.payDate
      ? a.payDate < b.payDate
        ? -1
        : 1
      : a.createdAt < b.createdAt
        ? -1
        : a.createdAt > b.createdAt
          ? 1
          : 0,
  );
}

export interface BudgetWithGobulbi {
  /** AB열 합계 (차감 전) */
  cashBefore: number;
  gobulbi: number;
  /** AB열 합계 − 고불비사용 합계 */
  cash: number;
  /** 고객혜택 잔여 + 스팟 + 차감 후 현금예산 */
  total: number;
}

/**
 * 고불비사용 차감. 차감은 현금예산에서 한 번만 하고, 총 매장 예산은 차감된 현금예산을 더하기만 한다.
 * (budget.total 에서 다시 빼지 않는다)
 */
export function applyGobulbi(budget: Budget, gobulbiTotal: number): BudgetWithGobulbi {
  const cash = budget.cash - gobulbiTotal;
  return {
    cashBefore: budget.cash,
    gobulbi: gobulbiTotal,
    cash,
    total: budget.benefitRemaining + budget.spot + cash,
  };
}

/** 장표 AC열 합계 − 고불비사용 = 웹앱 총 매장 예산 인지 (차이 = 고불비사용 합계) */
export function checkAgainstSheetAc(acTotal: number, applied: BudgetWithGobulbi) {
  const expected = acTotal - applied.gobulbi;
  return { acTotal, expected, ok: expected === applied.total, diff: acTotal - applied.total };
}

/** 선택한 월이 이번 달(한국 시간)인지 — 신규 등록은 이번 달만 */
export function isCurrentMonth(month: string, today: string): boolean {
  return month === today.slice(0, 7);
}
