/*
 * 가짜 구글 스프레드시트 (테스트 전용 — 실제 구글 시트와 연결되지 않음).
 * Apps Script(.gs)가 쓰는 SpreadsheetApp 기능만 흉내 낸다:
 *   값·수식·셀 메모(Note)·서식("@" 글자), 사용자 입력 해석(' 접두어, 숫자, yyyy-MM-dd 날짜, = 수식),
 *   행 수식 계산(=SUM, =N), 시트 추가·숨김·행 삭제.
 */
import { evaluate } from "./formula.ts";

const KST = 9 * 3600_000;
/** "2026-10-05" → 한국 시간 그날 0시 Date (구글 시트 날짜 칸) */
export function kstDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - KST);
}

export interface Cell {
  value: unknown; // 수식 칸이면 무시
  formula: string;
  note: string;
  format: string;
}
const blank = (): Cell => ({ value: "", formula: "", note: "", format: "" });

/** 사용자 입력처럼 해석 (setValue/setValues) */
function interpret(cell: Cell, v: unknown) {
  if (typeof v !== "string") {
    cell.formula = "";
    cell.value = v === null || v === undefined ? "" : v;
    return;
  }
  if (cell.format === "@") {
    cell.formula = "";
    cell.value = v.startsWith("'") ? v.slice(1) : v;
    return;
  }
  if (v.startsWith("'")) { cell.formula = ""; cell.value = v.slice(1); return; }
  if (v.startsWith("=")) { cell.formula = v; cell.value = ""; return; }
  cell.formula = "";
  if (/^-?\d+(\.\d+)?$/.test(v)) cell.value = Number(v);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) cell.value = kstDate(v);
  else cell.value = v;
}

export class FakeSheet {
  rows: Cell[][] = [];
  hidden = false;
  frozen = 0;
  /** 이 시트에 쓴 기록 (셀 주소) — "건드리지 않음" 확인용 */
  writes: string[] = [];
  constructor(public name: string, public width = 38) {}

  cell(r: number, c: number): Cell {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c) row.push(blank());
    return row[c - 1];
  }
  peek(r: number, c: number): Cell | undefined { return this.rows[r - 1]?.[c - 1]; }
  /** 계산된 값 */
  value(r: number, c: number, depth = 0): unknown {
    const cell = this.peek(r, c);
    if (!cell) return "";
    if (!cell.formula) return cell.value;
    if (depth > 20) throw new Error("수식 순환");
    return evaluate(cell.formula, (rr, cc) => this.value(rr, cc, depth + 1), this.rows.length);
  }

  getName() { return this.name; }
  getLastRow() {
    for (let r = this.rows.length; r >= 1; r--) {
      if (this.rows[r - 1].some((c) => c.formula || (c.value !== "" && c.value !== null && c.value !== undefined))) return r;
    }
    return 0;
  }
  getMaxColumns() { return this.width; }
  hideSheet() { this.hidden = true; }
  isSheetHidden() { return this.hidden; }
  setFrozenRows(n: number) { this.frozen = n; }
  deleteRow(r: number) { this.rows.splice(r - 1, 1); this.writes.push(`deleteRow ${r}`); }
  getRange(r: number, c: number, nr = 1, nc = 1) {
    if (typeof r !== "number") throw new Error("getRange: A1 표기는 지원하지 않음");
    const sheet = this;
    const each = <T>(f: (rr: number, cc: number, i: number, j: number) => T): T[][] =>
      Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => f(r + i, c + j, i, j)));
    const mark = (what: string) => sheet.writes.push(`${what} ${r},${c} ${nr}x${nc}`);
    const range = {
      getValues: () => each((rr, cc) => sheet.value(rr, cc)),
      getFormulas: () => each((rr, cc) => sheet.peek(rr, cc)?.formula ?? ""),
      getNotes: () => each((rr, cc) => sheet.peek(rr, cc)?.note ?? ""),
      setValues: (vs: unknown[][]) => {
        if (vs.length !== nr || vs.some((row) => row.length !== nc)) throw new Error(`setValues 크기 불일치 (${nr}x${nc})`);
        mark("setValues");
        each((rr, cc, i, j) => interpret(sheet.cell(rr, cc), vs[i][j]));
        return range;
      },
      setValue: (v: unknown) => { mark("setValue"); interpret(sheet.cell(r, c), v); return range; },
      setFormula: (f: string) => { mark("setFormula"); const cell = sheet.cell(r, c); cell.formula = f; cell.value = ""; return range; },
      setNotes: (ns: string[][]) => {
        if (ns.length !== nr || ns.some((row) => row.length !== nc)) throw new Error("setNotes 크기 불일치");
        mark("setNotes");
        each((rr, cc, i, j) => { sheet.cell(rr, cc).note = ns[i][j] ?? ""; });
        return range;
      },
      setNote: (n: string) => { mark("setNote"); sheet.cell(r, c).note = n ?? ""; return range; },
      getNote: () => sheet.peek(r, c)?.note ?? "",
      clearNote: () => { mark("clearNote"); each((rr, cc) => { const cell = sheet.peek(rr, cc); if (cell) cell.note = ""; }); return range; },
      setNumberFormat: (f: string) => { each((rr, cc) => { sheet.cell(rr, cc).format = f; }); return range; },
    };
    return range;
  }
  /** 테스트 편의: 행 값(계산 후) */
  rowValues(r: number): unknown[] { return Array.from({ length: this.width }, (_, j) => this.value(r, j + 1)); }
  /** 테스트 편의: 모든 셀 글자(값·수식·메모) — 개인정보 검사용 */
  allText(): string[] {
    const out: string[] = [];
    this.rows.forEach((row, i) => row.forEach((c, j) => {
      const v = this.value(i + 1, j + 1);
      if (v !== "" && v !== null && v !== undefined) out.push(v instanceof Date ? v.toISOString() : String(v));
      if (c.formula) out.push(c.formula);
      if (c.note) out.push(c.note);
    }));
    return out;
  }
}

/** 무선장표 6·7행 제목 + 8행 합계 수식 + 9행부터 빈 판매 자리 (실제 양식과 같은 모양) */
export function makeMonthSheet(name: string, slots = 15): FakeSheet {
  const s = new FakeSheet(name, 38);
  const L = (x: string) => [...x].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const h = (r: number, col: string, t: string) => { s.cell(r, L(col)).value = t; };
  h(6, "A", "고객약속사항"); h(6, "B", "No."); h(6, "C", "개통일"); h(6, "D", "고객"); h(6, "E", "CTN");
  h(6, "F", "실력지표제외"); h(7, "G", "검수"); h(7, "H", "수납"); h(6, "I", "개통구분"); h(6, "M", "직원명");
  h(6, "N", "총 확보금액"); h(6, "O", "SPOT정책"); h(6, "T", "고객혜택"); h(6, "U", "총 사용금액");
  h(6, "Z", "중고판매"); h(6, "AC", "최종 남은 예산"); h(7, "AE", "제카"); h(7, "AG", "등록"); h(6, "AK", "동판"); h(7, "AL", "가능일");
  for (const col of ["N","O","P","Q","R","S","T","U","V","W","X","Y","Z","AA","AB","AC","AH"]) {
    s.cell(8, L(col)).formula = `=SUM(${col}9:${col})`;
  }
  for (let i = 0; i < slots; i++) {
    const r = 9 + i;
    s.cell(r, 2).value = i + 1;      // B No.
    s.cell(r, L("N")).value = "-";    // 빈 행 모양
    s.cell(r, L("U")).value = "-";
    s.cell(r, 38).value = "";
  }
  s.writes = [];
  return s;
}

/** 가짜 시트 ID (테스트 전용 진입 파일 test-entry.gs 의 WS_TEST_CONFIG 와 같은 값 — 실제 시트에 연결하지 않음) */
export const TEST_SHEET_ID = "1qM57jAfArHW1CGTfpKYJWeFQZ01EEL5CM1L7BWatti4";

export class FakeSpreadsheet {
  sheets = new Map<string, FakeSheet>();
  inserts: string[] = [];
  id = TEST_SHEET_ID;
  name = "무선장표 테스트전용";
  /** 시트(탭)에 접근한 기록 — "보호 장치가 데이터 접근보다 먼저" 확인용 */
  sheetAccess = 0;
  constructor(monthNames: string[] = ["10월"], slots = 15) {
    for (const m of [...monthNames, "무선장표 양식"]) this.sheets.set(m, makeMonthSheet(m, slots));
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getSpreadsheetTimeZone() { return "Asia/Seoul"; }
  getSheetByName(n: string) { this.sheetAccess++; return this.sheets.get(n) ?? null; }
  getSheets() { this.sheetAccess++; return [...this.sheets.values()]; }
  insertSheet(n: string) {
    if (this.sheets.has(n)) throw new Error("같은 이름의 시트가 이미 있습니다: " + n);
    const s = new FakeSheet(n, 26);
    this.sheets.set(n, s);
    this.inserts.push(n);
    return s;
  }
  month(n = "10월") { return this.sheets.get(n)!; }
  /** 모든 시트의 모든 글자 */
  allText(): string[] { return this.getSheets().flatMap((s) => s.allText().map((t) => `${s.name}: ${t}`)); }
}
