import type { SheetSale } from "@/lib/sheet-record";

/*
 * 모델정책(S열) 정책명.
 * - S열에는 금액만 저장한다. 정책명은 장표에 쓰지 않고 Apps Script 숨김 보조 시트 "웹앱참고" 에
 *   판매 건별(키 = 월 시트 | 개통일 | CTN | 고객명) 참고내용 항목 modelPolicyName 으로 보관한다.
 *   행 번호·No. 를 쓰지 않으므로 날짜 정렬·No. 다시 매기기로 행이 움직여도 다른 고객에 붙지 않는다.
 * - 판매 1건 = S열 금액 1개 = 정책명 1개 (자유 입력, 목록·자동완성 없음).
 * - 같은 키(개통일·CTN·고객명)를 가진 판매가 2건 이상이면 정책명을 붙이지 않는다 (조회·수정 모두).
 */

export const POLICY_NAME_FIELD = "modelPolicyName";
export const POLICY_NAME_MAX = 100;
export const NO_POLICY_NAME_LABEL = "정책명 없음";

/** 입력 정리: 앞뒤 공백 제거, 연속 공백·줄바꿈은 공백 하나 */
export function cleanPolicyName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** 정책명 입력 검사. 문제가 없으면 null */
export function policyNameError(value: string): string | null {
  return cleanPolicyName(value).length > POLICY_NAME_MAX
    ? `정책명은 ${POLICY_NAME_MAX}자까지 입력할 수 있습니다.`
    : null;
}

/** 판매에 연결된 정책명 ("" = 없음) */
export function policyNameOf(sale: Pick<SheetSale, "notes">): string {
  return cleanPolicyName(sale.notes?.[POLICY_NAME_FIELD] ?? "");
}

/** 정책명 연결 키 (Apps Script notes.gs wsNoteKey_ 와 같은 기준, 월 시트 제외) */
export function policyLinkKey(
  sale: Pick<SheetSale, "activatedAt" | "ctn" | "customer">,
): string {
  const ctn = sale.ctn.replace(/\D/g, "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sale.activatedAt) || !ctn) return "";
  return `${sale.activatedAt}|${ctn}|${sale.customer}`;
}

/** 모델정책 정산 대상: S열 금액이 0 이 아니거나 정책명이 있는 판매 */
export function isModelPolicySale(sale: SheetSale): boolean {
  return (
    (sale.modelPolicy !== null && sale.modelPolicy !== 0) ||
    policyNameOf(sale) !== ""
  );
}

export interface PolicyEntry {
  sale: SheetSale;
  /** S열 금액 (빈칸·"-" 는 0) */
  amount: number;
  /** 연결 키가 없거나(개통일·CTN 없음) 같은 키 판매가 2건 이상 → 정책명을 붙일 수 없음 */
  unlinkable: boolean;
}

export interface PolicyGroup {
  /** 정책명 ("" = 정책명 없음) */
  name: string;
  label: string;
  count: number;
  amount: number;
  entries: PolicyEntry[];
}

export interface PolicyReport {
  /** 정책명이 있는 묶음 (정책명 가나다순) */
  named: PolicyGroup[];
  /** 정책명이 없는 판매 (S열 금액이 있는데 정책명이 없는 판매 포함, 누락 없이) */
  unnamed: PolicyGroup;
  /** 전체 대상 (건수·S열 금액 합계) */
  total: { count: number; amount: number };
  /** 정책명을 붙일 수 없는 판매 수 */
  unlinkableCount: number;
}

/** 정책명 묶음 키: 띄어쓰기·대소문자 무시 (화면에는 처음 나온 글자 그대로) */
export function policyGroupKey(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

function byDate(a: PolicyEntry, b: PolicyEntry): number {
  return (
    a.sale.activatedAt.localeCompare(b.sale.activatedAt) || a.sale.row - b.sale.row
  );
}

export function buildPolicyReport(sales: readonly SheetSale[]): PolicyReport {
  const keyCount = new Map<string, number>();
  for (const s of sales) {
    const k = policyLinkKey(s);
    if (k) keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
  }
  const groups = new Map<string, PolicyGroup>();
  const unnamed: PolicyGroup = {
    name: "",
    label: NO_POLICY_NAME_LABEL,
    count: 0,
    amount: 0,
    entries: [],
  };
  let totalCount = 0;
  let totalAmount = 0;
  let unlinkableCount = 0;
  // 장표 행 순서로 (같은 정책명의 화면 표시는 장표에서 처음 나온 글자)
  for (const sale of [...sales].sort((a, b) => a.row - b.row)) {
    if (!isModelPolicySale(sale)) continue;
    const linkKey = policyLinkKey(sale);
    const unlinkable = !linkKey || (keyCount.get(linkKey) ?? 0) > 1;
    const entry: PolicyEntry = { sale, amount: sale.modelPolicy ?? 0, unlinkable };
    const name = policyNameOf(sale);
    let group = unnamed;
    if (name) {
      const key = policyGroupKey(name);
      group = groups.get(key) ?? {
        name,
        label: name,
        count: 0,
        amount: 0,
        entries: [],
      };
      groups.set(key, group);
    }
    group.entries.push(entry);
    group.count += 1;
    group.amount += entry.amount;
    totalCount += 1;
    totalAmount += entry.amount;
    if (unlinkable) unlinkableCount += 1;
  }
  const named = [...groups.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "ko"),
  );
  for (const g of [...named, unnamed]) g.entries.sort(byDate);
  return {
    named,
    unnamed,
    total: { count: totalCount, amount: totalAmount },
    unlinkableCount,
  };
}

/** 정책명 검색: 공백·대소문자 무시 부분 일치 */
export function matchPolicyName(name: string, query: string): boolean {
  const q = query.replace(/\s+/g, "").toLowerCase();
  if (!q) return true;
  return name.replace(/\s+/g, "").toLowerCase().includes(q);
}
