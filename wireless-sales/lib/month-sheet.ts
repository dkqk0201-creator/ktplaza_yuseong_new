/*
 * 연월("2026-11") ↔ 무선장표 월 시트 이름("11월") 연결 — 목표관리·유입경로 분석용.
 *
 * 지금 월 시트 이름에는 연도가 없다 ("10월", "11월"). 웹앱 전체가 쓰는 기존 규칙(components/sales-data-status.tsx
 * sheetToYearMonth)과 똑같이 "오늘 기준 최근 12개월" 로 해석한다:
 *   이번 달 이하의 월 → 올해, 이번 달보다 뒤의 월 → 작년.  (예: 2027-01 에 "11월" 시트 → 2026-11)
 * 따라서 한 스프레드시트에 같은 이름의 월 시트는 하나뿐이고, 12개월이 지난 월은 시트로 찾지 않는다(null).
 *   → 2027년 11월 시트를 만들기 전에 2026년 "11월" 시트를 어떻게 보관할지(연도별 스프레드시트 분리 또는
 *     보관용 이름 변경)를 정해야 한다 (기존 시트 이름은 승인 없이 바꾸지 않는다).
 * 목표·목표이력·판매연결은 시트 이름이 아니라 연월(YYYY-MM)·판매 ID 로 저장하므로 해가 바뀌어도 섞이지 않는다.
 */

export function isYearMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isMonthSheetName(value: string): boolean {
  return /^(1[0-2]|[1-9])월$/.test(value);
}

/** 월 시트 이름 → 연월 (today: "YYYY-MM-DD", 한국 날짜). 월 시트 이름이 아니면 null */
export function monthForSheet(sheet: string, today: string): string | null {
  if (!isMonthSheetName(sheet)) return null;
  const year = Number(today.slice(0, 4));
  const thisMonth = Number(today.slice(5, 7));
  const month = Number(sheet.replace("월", ""));
  const y = month > thisMonth ? year - 1 : year;
  return `${y}-${String(month).padStart(2, "0")}`;
}

/** 연월 → 월 시트 이름. 오늘 기준 최근 12개월(이번 달 포함)이 아니면 null (다른 해의 같은 이름 시트와 섞지 않음) */
export function sheetForMonth(yearMonth: string, today: string): string | null {
  if (!isYearMonth(yearMonth)) return null;
  const sheet = `${Number(yearMonth.slice(5, 7))}월`;
  return monthForSheet(sheet, today) === yearMonth ? sheet : null;
}

/** 전월 ("2026-01" → "2025-12") */
export function previousMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** 다음 달 ("2026-12" → "2027-01") */
export function nextMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * 주(월~일) 집계용 판매 모음: 이번 달 + 앞뒤 달 판매 중 그 기간에 드는 것만 (월말·월초에 걸친 주를 두 달 합산).
 * 같은 판매가 두 번 들어가지 않도록 월별 목록을 그대로 이어 붙인다 (월 시트마다 판매는 한 번씩만 있음).
 */
export function salesAcrossMonths<T>(...months: (readonly T[] | null | undefined)[]): T[] {
  const out: T[] = [];
  for (const list of months) if (list) out.push(...list);
  return out;
}
