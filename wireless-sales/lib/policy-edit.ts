import type { SheetSale } from "@/lib/sheet-record";
import { isValidDate, normalizeModel } from "@/lib/spot-bulk";

/*
 * 예산관리 "정책 확보 관리" (화면·서버 공용, 비밀값 없음).
 *
 * 카톡 판매보고 "정책" 세 항목 = 간편등록이 장표에 따로 저장하는 세 칸 (lib/quick-report.ts QUICK_FIELDS):
 *   ㄴ고객혜택        → T열 (customerBenefit)
 *   ㄴ그외(스팟제외)  → S열 (modelPolicy, 모델정책 정산이 보는 칸)
 *   ㄴ2ND연계정책     → R열 (securedSecond)
 * 세 칸 모두 예산관리 "고객혜택 확보금액"(P+Q+R+S+T, lib/budget.ts)과 같은 행 N열(=SUM(O:T)) 수식에 들어간다.
 * 따라서 금액을 고치면 판매의 총 확보금액·최종 남은 예산(AC)·매장 총예산이 기존 수식대로 같은 금액만큼 바뀐다.
 * 다른 예산(충청/스팟 O열·사용금액·추가지원금·현금·고불비·기타 예산)에는 더하지 않는다.
 *
 * 조회(이 파일)는 화면에서 판매내역 조회 결과로 계산하고(저장 없음), 저장은 Apps Script(policy-edit.gs)가
 * 잠금 안에서 행·판매 식별값·판매 ID·지금 R·S·T 값을 다시 확인한 뒤에만 한다.
 */

export const POLICY_EDIT_ENDPOINT = "/api/budget/policy";
/** policy-edit.gs 가 모든 응답에 붙이는 표시 */
export const POLICY_EDIT_HANDLER = "ws-policy-edit";
export const POLICY_EDIT_HISTORY_SHEET = "정책확보수정이력";
/** 한 번에 저장할 수 있는 판매 수 (Apps Script WS_POLICY_MAX_ITEMS 와 같아야 함) */
export const POLICY_EDIT_MAX_ITEMS = 200;
export const POLICY_AMOUNT_MAX = 10_000_000;
export const POLICY_MODELS_MAX = 20;
export const POLICY_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** 세 항목 (화면 순서: 카톡 보고 순서) */
export const POLICY_FIELDS = [
  { key: "benefit", saleKey: "customerBenefit", letter: "T", label: "고객혜택" },
  { key: "other", saleKey: "modelPolicy", letter: "S", label: "그외(스팟제외)" },
  { key: "second", saleKey: "securedSecond", letter: "R", label: "2ND연계정책" },
] as const;
export type PolicyKey = (typeof POLICY_FIELDS)[number]["key"];
export type PolicyValues = Record<PolicyKey, number | null>;

export type PolicySale = SheetSale & { sheet: string };

/** 조회 조건 */
export interface PolicyQuery {
  from: string;
  to: string;
  /** 비어 있으면 기간 내 전체 판매 */
  models: string[];
}

export function queryError(q: PolicyQuery): string | null {
  if (!isValidDate(q.from) || !isValidDate(q.to)) return "시작일·종료일을 올바른 날짜로 입력해 주세요.";
  if (q.from > q.to) return "종료일이 시작일보다 앞설 수 없습니다.";
  if (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`) > 92 * 86_400_000) return "기간은 최대 93일까지 지정할 수 있습니다.";
  if (q.models.length > POLICY_MODELS_MAX) return `모델은 ${POLICY_MODELS_MAX}개까지 선택할 수 있습니다.`;
  for (const m of q.models) {
    const n = normalizeModel(m);
    if (!n || n.length > 40) return "모델명을 확인해 주세요.";
  }
  return null;
}

export function saleKeyOf(s: { sheet: string; row: number }): string {
  return `${s.sheet}:${s.row}`;
}

/** 판매의 지금 세 항목 값 (null = 빈칸·"-") */
export function policyValues(sale: SheetSale): PolicyValues {
  return { benefit: sale.customerBenefit, other: sale.modelPolicy, second: sale.securedSecond };
}

export function policyTotal(v: PolicyValues): number {
  return (v.benefit ?? 0) + (v.other ?? 0) + (v.second ?? 0);
}

/** 조회: 개통일이 기간 안(양쪽 포함)이고 모델이 맞는 판매. 개통일을 읽지 못한 판매는 따로 */
export function selectPolicySales(sales: readonly PolicySale[], q: PolicyQuery): { rows: PolicySale[]; invalidDate: PolicySale[] } {
  const models = new Set(q.models.map(normalizeModel).filter(Boolean));
  const rows: PolicySale[] = [];
  const invalidDate: PolicySale[] = [];
  for (const s of sales) {
    if (models.size > 0 && !models.has(normalizeModel(s.model))) continue;
    if (!isValidDate(s.activatedAt)) {
      invalidDate.push(s);
      continue;
    }
    if (s.activatedAt < q.from || s.activatedAt > q.to) continue;
    rows.push(s);
  }
  rows.sort((a, b) => a.activatedAt.localeCompare(b.activatedAt) || a.sheet.localeCompare(b.sheet) || a.row - b.row);
  return { rows, invalidDate };
}

/** 입력 금액 → 정수 원. "30000", "30,000", "3만", "3만5천" 등. 빈칸은 undefined (= 바꾸지 않음), 잘못된 값은 NaN */
export function parsePolicyAmount(text: string): number | undefined {
  const t = text.replace(/\s+/g, "").replace(/,/g, "").replace(/원$/, "");
  if (t === "") return undefined;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)만)?(?:(\d+)천)?$/.exec(t);
  if (m && (m[1] || m[2])) return Number(m[1] ?? 0) * 10000 + Number(m[2] ?? 0) * 1000;
  return NaN;
}

export function amountError(v: number): string | null {
  return Number.isInteger(v) && v >= 0 && v <= POLICY_AMOUNT_MAX ? null : `금액은 0원 이상 ${POLICY_AMOUNT_MAX.toLocaleString("ko-KR")}원 이하 숫자로 입력해 주세요.`;
}

/** 한 판매의 수정 내용: 바뀐 항목만 */
export type PolicyChange = Partial<Record<PolicyKey, number>>;

/** 입력값(항목별 글자) → 실제로 바뀐 항목만. 빈칸 = 그대로, 지금 값과 같으면 바꾸지 않음 (빈칸 → 0 은 바뀜) */
export function changesFromInput(before: PolicyValues, input: Partial<Record<PolicyKey, string>>): { change: PolicyChange; error: string | null } {
  const change: PolicyChange = {};
  for (const f of POLICY_FIELDS) {
    const text = input[f.key];
    if (text === undefined) continue;
    const v = parsePolicyAmount(text);
    if (v === undefined) continue;
    if (Number.isNaN(v)) return { change: {}, error: `${f.label}: 금액을 숫자로 입력해 주세요 (예: 30000 또는 3만).` };
    const err = amountError(v);
    if (err) return { change: {}, error: `${f.label}: ${err}` };
    if (before[f.key] !== v) change[f.key] = v;
  }
  return { change, error: null };
}

export function changeDelta(before: PolicyValues, change: PolicyChange): Record<PolicyKey, number> & { total: number } {
  const d = { benefit: 0, other: 0, second: 0, total: 0 };
  for (const f of POLICY_FIELDS) {
    const v = change[f.key];
    if (v === undefined) continue;
    d[f.key] = v - (before[f.key] ?? 0);
    d.total += d[f.key];
  }
  return d;
}

/* ── 저장 요청 ─────────────────────────────────────────── */

export interface PolicyEditItem {
  sheet: string;
  row: number;
  no: string;
  activatedAt: string;
  customer: string;
  ctn: string;
  model: string;
  /** 판매 ID (C열 메모, 없으면 "") */
  saleId: string;
  /** 화면에서 본 R·S·T 값 ("" = 빈칸·"-") */
  before: Record<PolicyKey, string>;
  /** 바꿀 항목만 (정수 원) */
  after: PolicyChange;
}

export function toEditItem(sale: PolicySale, change: PolicyChange): PolicyEditItem {
  const v = policyValues(sale);
  const raw = (n: number | null) => (n === null ? "" : String(n));
  return {
    sheet: sale.sheet,
    row: sale.row,
    no: sale.no,
    activatedAt: sale.activatedAt,
    customer: sale.customer,
    ctn: sale.ctn,
    model: sale.model,
    saleId: sale.saleId ?? "",
    before: { benefit: raw(v.benefit), other: raw(v.other), second: raw(v.second) },
    after: { ...change },
  };
}

const SHEET_RE = /^(1[0-2]|[1-9])월$/;

/** 서버에서 요청 1건 확인. 문제 있으면 null */
export function parseEditItem(raw: unknown): PolicyEditItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);
  const sheet = str(o.sheet, 4);
  const row = typeof o.row === "number" && Number.isInteger(o.row) && o.row >= 9 && o.row <= 100000 ? o.row : null;
  const no = str(o.no, 20);
  const activatedAt = str(o.activatedAt, 20);
  const customer = str(o.customer, 100);
  const ctn = str(o.ctn, 40);
  const model = str(o.model, 60);
  const saleId = str(o.saleId ?? "", 80);
  if (!sheet || !SHEET_RE.test(sheet) || row === null || no === null || activatedAt === null || !isValidDate(activatedAt)) return null;
  if (customer === null || ctn === null || model === null || saleId === null) return null;
  const b = (o.before ?? {}) as Record<string, unknown>;
  const a = (o.after ?? {}) as Record<string, unknown>;
  const before = {} as Record<PolicyKey, string>;
  const after: PolicyChange = {};
  for (const f of POLICY_FIELDS) {
    const bv = b[f.key];
    if (typeof bv !== "string" || bv.length > 20 || !(bv === "" || /^-?\d+(\.\d+)?$/.test(bv))) return null;
    before[f.key] = bv;
    const av = a[f.key];
    if (av === undefined) continue;
    if (typeof av !== "number" || amountError(av)) return null;
    after[f.key] = av;
  }
  for (const k of Object.keys(a)) if (!POLICY_FIELDS.some((f) => f.key === k)) return null;
  if (Object.keys(after).length === 0) return null;
  return { sheet, row, no, activatedAt, customer, ctn, model, saleId, before, after };
}

export interface PolicyEditItemResult {
  sheet: string;
  row: number;
  ok: boolean;
  message: string;
}

export interface PolicyEditApplyResult {
  requestId: string;
  repeated: boolean;
  applied: number;
  failed: number;
  /** 저장된 판매들의 확보 합계 증감 */
  delta: number;
  results: PolicyEditItemResult[];
}

export interface PolicyEditHistoryEntry {
  requestId: string;
  savedAt: string;
  operator: string;
  sales: number;
  delta: number;
  second: number;
  other: number;
  benefit: number;
  status: string;
}

export function newPolicyEditId(): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `pol-${rnd}`.slice(0, 64);
}

/* ── 비교용 집계 (직원별·모델별) ─────────────────────── */

export interface PolicyGroupRow {
  name: string;
  count: number;
  benefit: number;
  other: number;
  second: number;
  total: number;
}

export function groupPolicy(rows: readonly PolicySale[], by: "staff" | "model"): PolicyGroupRow[] {
  const map = new Map<string, PolicyGroupRow>();
  for (const s of rows) {
    const name = (by === "staff" ? s.staff : normalizeModel(s.model)) || "(빈칸)";
    const g = map.get(name) ?? { name, count: 0, benefit: 0, other: 0, second: 0, total: 0 };
    const v = policyValues(s);
    g.count += 1;
    g.benefit += v.benefit ?? 0;
    g.other += v.other ?? 0;
    g.second += v.second ?? 0;
    g.total += policyTotal(v);
    map.set(name, g);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
