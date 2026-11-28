import { parseSpotNote, spotLabel } from "@/lib/spot";
import { spotTerm, spotTermForRange, type SpotTerm } from "@/lib/spot-term";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 스팟예산 기간·모델별 일괄등록 (화면·서버 공용, 비밀값 없음).
 *
 * 기존 스팟관리 구조(lib/spot.ts)를 그대로 따른다:
 *   - O열 값  = 그 판매에 적용된 SPOT 금액 합계 (숫자)
 *   - O열 메모 = SPOT 번호별 금액, 줄마다 하나 ("스팟1 3만")
 * 일괄등록은 판매마다
 *   O열 = 기존 O열 금액 + 새 SPOT 금액 (숫자 그대로, 글자로 바꾸지 않음)
 *   메모 = 기존 메모 + 새 줄 "충청N 금액" (2026-11 부터, 그 전 개통 판매는 "스팟N 금액" — lib/spot-term.ts) (기존 줄은 그대로 둠)
 * 로 저장한다 → 스팟관리 SPOT별 집계·예산관리 스팟예산(O열 합계)에 그대로 반영된다.
 *
 * 미리보기(이 파일)는 화면에서 계산하고, 실제 저장은 Apps Script(spot-bulk.gs)가
 * 잠금 안에서 행·판매 식별값·모델·개통일·기존 O열 값·기존 메모를 다시 확인한 뒤에만 한다.
 */

export const SPOT_BULK_ENDPOINT = "/api/spot/bulk";
/** spot-bulk.gs 가 모든 응답에 붙이는 표시 */
export const SPOT_BULK_HANDLER = "ws-spot-bulk";
export const SPOT_BULK_HISTORY_SHEET = "스팟일괄등록이력";
export const SPOT_BULK_MAX_CONDITIONS = 20;
/** 한 번에 저장할 수 있는 판매 수 (Apps Script WS_SPOT_BULK_MAX_ITEMS 와 같아야 함) */
export const SPOT_BULK_MAX_ITEMS = 300;
export const SPOT_NUMBER_MAX = 999;
export const SPOT_AMOUNT_MAX = 10_000_000;
export const SPOT_MODELS_MAX = 20;
export const SPOT_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** 일괄등록 조건 1줄 */
export interface SpotCondition {
  id: string;
  /** 시작일·종료일 YYYY-MM-DD (둘 다 포함) */
  from: string;
  to: string;
  /** 적용 모델 (정규화 전 입력 그대로 보관). 비어 있으면 기간 내 전체 판매 */
  models: string[];
  spot: number;
  /** 건당 금액 (원) */
  amount: number;
}

/** 모델명 정규화: 앞뒤 공백 제거·대문자·안쪽 공백 하나로. "A17" 과 "A175" 는 다른 모델 (부분 일치 안 함) */
export function normalizeModel(model: string): string {
  return model.trim().replace(/\s+/g, " ").toUpperCase();
}

export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** 조건 입력 확인. 문제 없으면 null */
export function conditionError(c: SpotCondition): string | null {
  if (!isValidDate(c.from) || !isValidDate(c.to)) return "시작일·종료일을 올바른 날짜로 입력해 주세요.";
  if (c.from > c.to) return "종료일이 시작일보다 앞설 수 없습니다.";
  if (dayDiff(c.from, c.to) > 92) return "기간은 최대 93일까지 지정할 수 있습니다.";
  if (!Number.isInteger(c.spot) || c.spot < 1 || c.spot > SPOT_NUMBER_MAX) {
    return `번호는 1~${SPOT_NUMBER_MAX} 사이 숫자로 입력해 주세요.`;
  }
  if (!Number.isInteger(c.amount) || c.amount < 1 || c.amount > SPOT_AMOUNT_MAX) {
    return `건당 금액은 1원 이상 ${SPOT_AMOUNT_MAX.toLocaleString("ko-KR")}원 이하로 입력해 주세요.`;
  }
  if (!Array.isArray(c.models) || c.models.length > SPOT_MODELS_MAX) return `모델은 ${SPOT_MODELS_MAX}개까지 선택할 수 있습니다.`;
  for (const m of c.models) {
    const n = normalizeModel(m);
    if (!n || n.length > 40 || /^[=+\-@]/.test(n)) return "모델명을 확인해 주세요.";
  }
  return null;
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function conditionText(c: SpotCondition): string {
  const models = c.models.map(normalizeModel).filter(Boolean);
  return `${c.from}~${c.to} / ${models.length ? models.join(",") : "전체 모델"} / ${spotTermForRange(c.from, c.to)}${c.spot} / ${c.amount}원`;
}

/** 조건 기간에 걸친 연월 목록 ("2026-11-21"~"2026-12-03" → ["2026-11","2026-12"]) */
export function monthsInRange(from: string, to: string): string[] {
  if (!isValidDate(from) || !isValidDate(to) || from > to) return [];
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endKey = to.slice(0, 7);
  for (let guard = 0; guard < 24; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key === endKey) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** 메모 한 줄 금액 표기: 만원 단위면 "3만", 아니면 "35,500원" (lib/spot.ts parseSpotAmount 가 읽는 형식) */
export function spotAmountText(amount: number): string {
  if (amount % 10000 === 0) return `${amount / 10000}만`;
  return `${amount.toLocaleString("en-US")}원`;
}

/** 메모 한 줄. term = 그 판매 개통일 시기의 명칭 (2026-11 부터 "충청") */
export function spotNoteLine(spot: number, amount: number, term: SpotTerm = "충청"): string {
  return `${spotLabel(spot, term)} ${spotAmountText(amount)}`;
}

/** 기존 메모 + 새 줄 (Apps Script wsSpotBulkNoteAfter_ 와 같은 규칙) */
export function noteAfter(before: string, adds: readonly { spot: number; amount: number }[], term: SpotTerm = "충청"): string {
  const base = (before ?? "").trim();
  const lines = adds.map((a) => spotNoteLine(a.spot, a.amount, term));
  return [base, ...lines].filter(Boolean).join("\n");
}

/** 메모에 이미 적힌 번호 (금액 있는 줄·번호만 있는 줄 모두, "스팟1"·"충청1" 은 같은 1번) */
export function spotsInNote(note: string | undefined): Set<number> {
  const p = parseSpotNote(note);
  return new Set([...p.entries.map((e) => e.spot), ...p.bare]);
}

/* ── 미리보기 ─────────────────────────────────────────── */

export type BulkSale = SheetSale & { sheet: string };

export type BulkFlag =
  /** 이 판매에 이미 같은 스팟 번호가 있음 → 적용 불가 */
  | "already"
  /** 같은 판매에 조건이 2개 이상 걸림 → 점장이 고를 때까지 적용 안 함 */
  | "conflict"
  /** 기존 스팟(O열 금액 또는 메모)이 있음 → 보호, 명시적으로 체크해야 적용 */
  | "existing"
  /** 판매 No. 가 빈칸 (UMNP 등) → 누락하지 않고 표시, 확인 후 체크 */
  | "noNo";

export interface PreviewRow {
  /** `${sheet}:${row}:${conditionId}` */
  key: string;
  saleKey: string;
  sale: BulkSale;
  condition: SpotCondition;
  conditionIndex: number;
  flags: BulkFlag[];
  /** 체크할 수 있는지 (already 면 false) */
  selectable: boolean;
  /** 처음 체크 상태 */
  defaultChecked: boolean;
}

export interface ExcludedSale {
  sale: BulkSale;
  reason: string;
}

export interface BulkPreview {
  rows: PreviewRow[];
  /** 기간 안이지만 적용할 수 없는 판매 (개통일 오류·취소 표시 등) — 조용히 빼지 않고 보여준다 */
  excluded: ExcludedSale[];
  /** 개통일을 읽지 못한 판매 (어느 조건에 드는지 알 수 없음) */
  invalidDate: ExcludedSale[];
}

export const saleKeyOf = (s: { sheet: string; row: number }) => `${s.sheet}:${s.row}`;

function isCancelled(sale: SheetSale): boolean {
  return /취소|철회/.test(sale.category ?? "");
}

export function hasExistingSpot(sale: SheetSale): boolean {
  return (sale.spot ?? 0) !== 0 || !!(sale.spotNote ?? "").trim();
}

/** 조건 → 대상 판매 미리보기 (조건은 모두 conditionError 를 통과한 것만 넣는다) */
export function buildBulkPreview(sales: readonly BulkSale[], conditions: readonly SpotCondition[]): BulkPreview {
  const rows: PreviewRow[] = [];
  const excluded: ExcludedSale[] = [];
  const invalidDate: ExcludedSale[] = [];
  const minFrom = conditions.reduce((m, c) => (c.from < m ? c.from : m), "9999-12-31");
  const maxTo = conditions.reduce((m, c) => (c.to > m ? c.to : m), "0000-01-01");
  const normalized = conditions.map((c) => new Set(c.models.map(normalizeModel).filter(Boolean)));

  const ordered = [...sales].sort((a, b) =>
    a.activatedAt !== b.activatedAt ? (a.activatedAt < b.activatedAt ? -1 : 1) : a.sheet !== b.sheet ? (a.sheet < b.sheet ? -1 : 1) : a.row - b.row,
  );
  const seen = new Set<string>();
  for (const sale of ordered) {
    const saleKey = saleKeyOf(sale);
    if (seen.has(saleKey)) continue;
    seen.add(saleKey);
    if (!sale.activatedAt && !sale.customer && !sale.ctn) continue; // 빈 행
    if (!isValidDate(sale.activatedAt)) {
      invalidDate.push({ sale, reason: "개통일을 날짜로 읽을 수 없음" });
      continue;
    }
    if (sale.activatedAt < minFrom || sale.activatedAt > maxTo) continue;
    const matched: number[] = [];
    conditions.forEach((c, i) => {
      if (sale.activatedAt < c.from || sale.activatedAt > c.to) return;
      if (normalized[i].size > 0 && !normalized[i].has(normalizeModel(sale.model ?? ""))) return;
      matched.push(i);
    });
    if (matched.length === 0) continue;
    if (isCancelled(sale)) {
      excluded.push({ sale, reason: `개통구분 '${sale.category}' — 적용 제외` });
      continue;
    }
    const existingSpots = spotsInNote(sale.spotNote);
    const existing = hasExistingSpot(sale);
    // 같은 스팟 번호 조건이 여러 개 걸리면 그것도 충돌
    const conflict = matched.length > 1;
    for (const i of matched) {
      const c = conditions[i];
      const flags: BulkFlag[] = [];
      if (existingSpots.has(c.spot)) flags.push("already");
      if (conflict) flags.push("conflict");
      if (existing) flags.push("existing");
      if (!sale.no) flags.push("noNo");
      const selectable = !flags.includes("already");
      rows.push({
        key: `${saleKey}:${c.id}`,
        saleKey,
        sale,
        condition: c,
        conditionIndex: i,
        flags,
        selectable,
        defaultChecked: selectable && flags.length === 0,
      });
    }
  }
  return { rows, excluded, invalidDate };
}

export function defaultSelection(preview: BulkPreview): Set<string> {
  return new Set(preview.rows.filter((r) => r.defaultChecked).map((r) => r.key));
}

export interface SaleChoice {
  saleKey: string;
  sale: BulkSale;
  adds: { spot: number; amount: number; conditionId: string }[];
  beforeO: number;
  afterO: number;
  beforeNote: string;
  afterNote: string;
}

export interface SelectionResult {
  choices: SaleChoice[];
  /** 같은 판매에 같은 스팟 번호를 두 번 고른 경우 등 — 저장할 수 없는 선택 */
  errors: string[];
}

/** 체크한 줄 → 판매별 저장 내용 */
export function resolveSelection(preview: BulkPreview, selected: ReadonlySet<string>): SelectionResult {
  const map = new Map<string, SaleChoice>();
  const errors: string[] = [];
  for (const r of preview.rows) {
    if (!selected.has(r.key) || !r.selectable) continue;
    let ch = map.get(r.saleKey);
    if (!ch) {
      const beforeO = r.sale.spot ?? 0;
      ch = { saleKey: r.saleKey, sale: r.sale, adds: [], beforeO, afterO: beforeO, beforeNote: (r.sale.spotNote ?? "").trim(), afterNote: "" };
      map.set(r.saleKey, ch);
    }
    if (ch.adds.some((a) => a.spot === r.condition.spot)) {
      errors.push(
        `${r.sale.activatedAt} 판매 No.${r.sale.no || "없음"}: ${spotLabel(r.condition.spot, spotTerm(r.sale.activatedAt))}을 두 조건에서 함께 골랐습니다. 하나만 체크해 주세요.`,
      );
      continue;
    }
    ch.adds.push({ spot: r.condition.spot, amount: r.condition.amount, conditionId: r.condition.id });
  }
  const choices = [...map.values()];
  for (const ch of choices) {
    ch.afterO = ch.beforeO + ch.adds.reduce((t, a) => t + a.amount, 0);
    ch.afterNote = noteAfter(ch.beforeNote, ch.adds, spotTerm(ch.sale.activatedAt));
  }
  return { choices, errors };
}

export interface BulkSummary {
  /** 조건에 맞는 판매 수 (중복 제거) */
  matchedSales: number;
  /** 실제 적용 대상 판매 수 */
  targetSales: number;
  /** 기존 스팟이 있는 판매 수 */
  existingSales: number;
  /** 조건 2개 이상이 걸린 판매 수 */
  conflictSales: number;
  /** 이미 같은 스팟이 등록된 줄 수 */
  alreadyRows: number;
  /** 조건에는 맞지만 적용하지 않는 판매 수 (체크 해제·보호·충돌 미선택·개통구분 제외) */
  excludedSales: number;
  /** 판매 No. 가 없는 판매 수 */
  noNoSales: number;
  /** 총 적용 금액 (= 스팟예산·매장 총예산 증가액) */
  totalAmount: number;
  /** 대상 판매의 기존 O열 합계 → 변경 후 합계 */
  beforeTotal: number;
  afterTotal: number;
}

export function summarize(preview: BulkPreview, result: SelectionResult): BulkSummary {
  const matched = new Set(preview.rows.map((r) => r.saleKey));
  const existing = new Set(preview.rows.filter((r) => r.flags.includes("existing")).map((r) => r.saleKey));
  const conflict = new Set(preview.rows.filter((r) => r.flags.includes("conflict")).map((r) => r.saleKey));
  const noNo = new Set(preview.rows.filter((r) => r.flags.includes("noNo")).map((r) => r.saleKey));
  const totalAmount = result.choices.reduce((t, c) => t + (c.afterO - c.beforeO), 0);
  return {
    matchedSales: matched.size + preview.excluded.length,
    targetSales: result.choices.length,
    existingSales: existing.size,
    conflictSales: conflict.size,
    alreadyRows: preview.rows.filter((r) => r.flags.includes("already")).length,
    excludedSales: matched.size - result.choices.length + preview.excluded.length,
    noNoSales: noNo.size,
    totalAmount,
    beforeTotal: result.choices.reduce((t, c) => t + c.beforeO, 0),
    afterTotal: result.choices.reduce((t, c) => t + c.afterO, 0),
  };
}

/* ── 저장 요청 ─────────────────────────────────────────── */

export interface SpotBulkItem {
  sheet: string;
  row: number;
  no: string;
  activatedAt: string;
  customer: string;
  ctn: string;
  model: string;
  /** 화면에서 본 O열 값 ("" = 빈칸·"-") */
  beforeO: string;
  /** 화면에서 본 O열 메모 (앞뒤 공백 제거) */
  beforeNote: string;
  adds: { spot: number; amount: number; conditionId: string }[];
}

export function toBulkItems(choices: readonly SaleChoice[]): SpotBulkItem[] {
  return choices.map((c) => ({
    sheet: c.sale.sheet,
    row: c.sale.row,
    no: c.sale.no,
    activatedAt: c.sale.activatedAt,
    customer: c.sale.customer,
    ctn: c.sale.ctn,
    model: c.sale.model,
    beforeO: c.sale.spot === null ? "" : String(c.sale.spot),
    beforeNote: c.beforeNote,
    adds: c.adds.map((a) => ({ ...a })),
  }));
}

export interface SpotBulkItemResult {
  sheet: string;
  row: number;
  ok: boolean;
  message: string;
}

export interface SpotBulkApplyResult {
  requestId: string;
  /** 같은 요청 ID 로 이미 저장된 요청 (다시 쓰지 않음) */
  repeated: boolean;
  applied: number;
  failed: number;
  amount: number;
  results: SpotBulkItemResult[];
}

export interface SpotBulkHistoryEntry {
  requestId: string;
  appliedAt: string;
  operator: string;
  conditions: string;
  sales: number;
  amount: number;
  /** 적용 / 되돌림 / 일부 되돌림 */
  status: string;
}

export function newSpotBulkId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** 서버에서 받은 조건 확인 (형식이 틀리면 null) */
export function parseCondition(v: unknown): SpotCondition | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.id !== "string" ||
    !/^[A-Za-z0-9-]{1,40}$/.test(o.id) ||
    typeof o.from !== "string" ||
    typeof o.to !== "string" ||
    !Array.isArray(o.models) ||
    !o.models.every((m) => typeof m === "string") ||
    typeof o.spot !== "number" ||
    typeof o.amount !== "number"
  ) {
    return null;
  }
  const c: SpotCondition = {
    id: o.id,
    from: o.from,
    to: o.to,
    models: (o.models as string[]).map(normalizeModel).filter(Boolean),
    spot: o.spot,
    amount: o.amount,
  };
  return conditionError(c) ? null : c;
}

export function parseBulkItem(v: unknown, conditionIds: ReadonlySet<string>): SpotBulkItem | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const s = (x: unknown, max: number) => (typeof x === "string" && x.length <= max ? x : null);
  const sheet = s(o.sheet, 4);
  const no = s(o.no, 20);
  const activatedAt = s(o.activatedAt, 20);
  const customer = s(o.customer, 60);
  const ctn = s(o.ctn, 30);
  const model = s(o.model, 60);
  const beforeO = s(o.beforeO, 30);
  const beforeNote = s(o.beforeNote, 2000);
  const row = o.row;
  if (
    sheet === null ||
    !/^(1[0-2]|[1-9])월$/.test(sheet) ||
    typeof row !== "number" ||
    !Number.isInteger(row) ||
    row < 9 ||
    no === null ||
    activatedAt === null ||
    !isValidDate(activatedAt) ||
    customer === null ||
    ctn === null ||
    model === null ||
    beforeO === null ||
    beforeNote === null ||
    !Array.isArray(o.adds) ||
    o.adds.length === 0 ||
    o.adds.length > SPOT_BULK_MAX_CONDITIONS
  ) {
    return null;
  }
  const adds: SpotBulkItem["adds"] = [];
  const spots = new Set<number>();
  for (const a of o.adds as unknown[]) {
    if (!a || typeof a !== "object") return null;
    const x = a as Record<string, unknown>;
    if (
      typeof x.spot !== "number" ||
      !Number.isInteger(x.spot) ||
      x.spot < 1 ||
      x.spot > SPOT_NUMBER_MAX ||
      typeof x.amount !== "number" ||
      !Number.isInteger(x.amount) ||
      x.amount < 1 ||
      x.amount > SPOT_AMOUNT_MAX ||
      typeof x.conditionId !== "string" ||
      !conditionIds.has(x.conditionId) ||
      spots.has(x.spot)
    ) {
      return null;
    }
    spots.add(x.spot);
    adds.push({ spot: x.spot, amount: x.amount, conditionId: x.conditionId });
  }
  return { sheet, row, no, activatedAt, customer, ctn, model, beforeO, beforeNote, adds };
}
