import type { SheetSale } from "@/lib/sheet-record";

/*
 * 스팟관리 (조회 전용).
 * 원본 = 장표 O열(SPOT정책):
 *   - O열 값  = 그 판매에 적용된 SPOT 금액 전체 합계
 *   - O열 메모(Note) = SPOT 번호별 개별 금액, 줄마다 하나 (예: "스팟1 3만\n스팟3 5만")
 * SPOT별 합계는 O열 값이 아니라 메모에 적힌 SPOT별 금액을 더한다.
 * O열 값과 메모 합계가 다르면 어느 SPOT에도 차액을 나누지 않고 경고 목록으로만 보여준다.
 * 스팟 번호는 끝까지 한 숫자로 읽는다 ("스팟 11" = 스팟11, 번호 숫자를 금액으로 쓰지 않음).
 * 금액 없이 번호만 적힌 줄("스팟11"):
 *   - 그런 줄이 한 판매에 하나뿐이면 O열 금액 − 다른 줄 금액 합계(0보다 클 때)를 그 SPOT 금액으로 본다.
 *   - 둘 이상이면 금액을 나눌 수 없으므로 SPOT 분류(건수·고객)만 하고 금액은 더하지 않으며 경고로 보여준다.
 * 웹앱은 O열 값·메모를 읽기만 한다.
 */

export interface SpotEntry {
  /** SPOT 번호 (스팟1 → 1) */
  spot: number;
  amount: number;
}

export interface ParsedSpotNote {
  entries: SpotEntry[];
  /** 금액 없이 번호만 적힌 줄의 SPOT 번호 ("스팟11") */
  bare: number[];
  /** 해석하지 못한 줄 (빈 줄 제외) */
  unparsed: string[];
}

/** "3만" "3.5만" "30000" "30,000" "30,000원" "3만원" → 원. 해석 못 하면 null */
export function parseSpotAmount(text: string): number | null {
  const t = text.replace(/\s/g, "").replace(/원$/, "");
  const man = /^(-?\d+(?:\.\d+)?)만$/.exec(t);
  if (man) return Math.round(Number(man[1]) * 10000);
  if (/^-?\d{1,3}(,\d{3})+$/.test(t) || /^-?\d+$/.test(t)) {
    return Number(t.replace(/,/g, ""));
  }
  return null;
}

/**
 * 한 줄: "스팟1 3만", "스팟 1 30,000원", "스팟1:3만" (대소문자 무관 SPOT 도 인식).
 * (?!\d): 번호 숫자를 중간에서 끊지 않는다 — "스팟 11" 을 스팟1 + 금액 1 로 읽지 않음.
 */
const LINE = /^(?:스\s*팟|spot)\s*(\d{1,3})(?!\d)\s*[:：=]?\s*(.+)$/i;
/** 금액 없이 번호만: "스팟11", "스팟 10" */
const BARE = /^(?:스\s*팟|spot)\s*(\d{1,3})\s*$/i;

export function parseSpotNote(note: string | undefined): ParsedSpotNote {
  const entries: SpotEntry[] = [];
  const bare: number[] = [];
  const unparsed: string[] = [];
  for (const raw of (note ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const b = BARE.exec(line);
    if (b) {
      bare.push(Number(b[1]));
      continue;
    }
    const m = LINE.exec(line);
    const amount = m ? parseSpotAmount(m[2]) : null;
    if (!m || amount === null) {
      unparsed.push(line);
      continue;
    }
    entries.push({ spot: Number(m[1]), amount });
  }
  return { entries, bare, unparsed };
}

export type SpotCheckStatus = "ok" | "mismatch" | "missingNote";

export interface SpotCheck {
  sale: SheetSale;
  /** O열 금액 ("-"·빈칸 = 0) */
  oAmount: number;
  /** 메모에 적힌 모든 SPOT 금액 합계 */
  noteTotal: number;
  /** O열 금액 − 메모 합계 */
  diff: number;
  status: SpotCheckStatus;
  /** 메모 원문 */
  note: string;
  /** 해석하지 못한 줄 */
  unparsed: string[];
  /** 금액 없이 번호만 적혀 금액을 정할 수 없는 SPOT (번호만 적힌 줄이 둘 이상이거나 남는 금액이 없을 때) */
  unsplit: number[];
}

export interface SpotCustomer {
  activatedAt: string;
  customer: string;
  ctn: string;
  row: number;
}

export interface SpotSummary {
  spot: number;
  label: string;
  /** 이 SPOT을 받은 판매 건수 (한 판매에 같은 SPOT 이 두 줄이어도 1건) */
  count: number;
  /** 메모에 적힌 이 SPOT 금액 합계 */
  amount: number;
  customers: SpotCustomer[];
}

export interface SpotReport {
  spots: SpotSummary[];
  /** O열 금액 또는 메모가 있는 판매의 검증 결과 */
  checks: SpotCheck[];
  /** 정상이 아닌 판매 (불일치·메모 미입력) */
  problems: SpotCheck[];
  noteTotal: number;
  oTotal: number;
}

export const spotLabel = (spot: number) => `스팟${spot}`;

function byDateThenRow(a: SpotCustomer, b: SpotCustomer): number {
  if (a.activatedAt !== b.activatedAt) {
    return a.activatedAt < b.activatedAt ? -1 : 1;
  }
  return a.row - b.row;
}

/** 판매 목록 → SPOT 번호별 집계 + 판매별 금액 검증 */
export function buildSpotReport(sales: readonly SheetSale[]): SpotReport {
  const map = new Map<number, SpotSummary>();
  const checks: SpotCheck[] = [];
  let noteTotal = 0;
  let oTotal = 0;

  for (const sale of sales) {
    const note = (sale.spotNote ?? "").trim();
    const oAmount = sale.spot ?? 0;
    if (!note && oAmount === 0) continue;

    const parsed = parseSpotNote(note);
    const entries = [...parsed.entries];
    let unsplit: number[] = [];
    if (parsed.bare.length === 1) {
      // 번호만 적힌 줄이 하나 → O열 금액 중 다른 줄에 적힌 금액을 뺀 나머지가 이 SPOT 금액
      const rest = oAmount - entries.reduce((t, e) => t + e.amount, 0);
      if (rest > 0) entries.push({ spot: parsed.bare[0], amount: rest });
      else unsplit = parsed.bare;
    } else {
      unsplit = parsed.bare;
    }
    const total = entries.reduce((t, e) => t + e.amount, 0);
    noteTotal += total;
    oTotal += oAmount;

    const seen = new Set<number>();
    // 금액을 정할 수 없는 SPOT 도 분류(건수·고객)는 한다 — 금액은 0 으로 더함
    for (const { spot, amount } of [...entries, ...unsplit.map((spot) => ({ spot, amount: 0 }))]) {
      let s = map.get(spot);
      if (!s) {
        s = { spot, label: spotLabel(spot), count: 0, amount: 0, customers: [] };
        map.set(spot, s);
      }
      s.amount += amount;
      if (!seen.has(spot)) {
        seen.add(spot);
        s.count += 1;
        s.customers.push({
          activatedAt: sale.activatedAt,
          customer: sale.customer,
          ctn: sale.ctn,
          row: sale.row,
        });
      }
    }

    const diff = oAmount - total;
    const status: SpotCheckStatus = !note
      ? "missingNote"
      : diff !== 0 || parsed.unparsed.length > 0 || unsplit.length > 0
        ? "mismatch"
        : "ok";
    checks.push({
      sale,
      oAmount,
      noteTotal: total,
      diff,
      status,
      note,
      unparsed: parsed.unparsed,
      unsplit,
    });
  }

  const spots = [...map.values()].sort((a, b) => a.spot - b.spot);
  for (const s of spots) s.customers.sort(byDateThenRow);
  const problems = checks
    .filter((c) => c.status !== "ok")
    .sort((a, b) =>
      byDateThenRow(
        { activatedAt: a.sale.activatedAt, customer: "", ctn: "", row: a.sale.row },
        { activatedAt: b.sale.activatedAt, customer: "", ctn: "", row: b.sale.row },
      ),
    );
  return { spots, checks, problems, noteTotal, oTotal };
}
