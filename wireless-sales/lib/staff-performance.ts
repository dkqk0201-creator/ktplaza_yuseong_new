import { BENEFIT_SECURED_KEYS, BENEFIT_USED_KEYS } from "@/lib/budget";
import { normalizeCategory } from "@/lib/quick-report";
import { isO, type SheetSale } from "@/lib/sheet-record";

/*
 * 직원 실적관리 (조회·집계 전용 — 장표를 바꾸지 않는다).
 * 날짜 기준: C열 개통일 (웹앱 등록일 아님). 직원 기준: M열 직원명 (다른 화면의 직원 필터와 같은 값).
 *   후불     = 개통구분이 신규·번이(번호이동)·기변(기기변경)·UMNP 인 건수 (간편등록과 같은 정규화, UMNP 대소문자 무관)
 *   번이     = 개통구분 번호이동 건수
 *   UMNP     = 개통구분 UMNP 건수
 *   스초     = K열 요금제에 "스초" 가 들어 있는 건수
 *   2ND      = AD열이 O 인 건수
 *   제카     = AE열이 O 인 건수
 *   동판     = AK열이 순동·신동·약동 인 건수
 *   신동     = AK열이 신동 인 건수
 *   고혜확보 = 예산관리 "고객혜택 확보금액" 과 같은 P+Q+R+S+T 합계
 *   고혜사용 = 예산관리 "고객혜택 사용금액" 과 같은 V+W+X+Y 합계
 *   현금잔여 = AB열 합계 (예산관리 "현금예산" 과 같은 열, 음수 그대로)
 *   합계금액 = 고혜확보 + 고혜사용 + 현금잔여 (위에서 계산한 세 값을 부호 그대로 더함, 0 보정 없음)
 * 금액 칸의 "-"·X·빈칸은 0 (예산관리와 같음). 스팟예산(O열)은 쓰지 않는다.
 */

export interface StaffPerformance {
  staff: string;
  postpaid: number;
  portIn: number;
  umnp: number;
  scho: number;
  second: number;
  jeca: number;
  dongpan: number;
  shindong: number;
  benefitSecured: number;
  benefitUsed: number;
  cash: number;
  totalAmount: number;
}

export const NO_STAFF = "(직원명 없음)";
const POSTPAID = new Set(["기기변경", "번호이동", "신규", "UMNP"]);
const DONGPAN = new Set(["순동", "신동", "약동"]);

function emptyRow(staff: string): StaffPerformance {
  return {
    staff,
    postpaid: 0,
    portIn: 0,
    umnp: 0,
    scho: 0,
    second: 0,
    jeca: 0,
    dongpan: 0,
    shindong: 0,
    benefitSecured: 0,
    benefitUsed: 0,
    cash: 0,
    totalAmount: 0,
  };
}

function add(row: StaffPerformance, sale: SheetSale) {
  const category = normalizeCategory(sale.category);
  if (category && POSTPAID.has(category)) row.postpaid += 1;
  if (category === "번호이동") row.portIn += 1;
  if (category === "UMNP") row.umnp += 1;
  if (sale.plan.includes("스초")) row.scho += 1;
  if (isO(sale.secondPerformance)) row.second += 1;
  if (isO(sale.jeca)) row.jeca += 1;
  const dongpan = sale.dongpan.trim();
  if (DONGPAN.has(dongpan)) row.dongpan += 1;
  if (dongpan === "신동") row.shindong += 1;
  for (const key of BENEFIT_SECURED_KEYS) row.benefitSecured += sale[key] ?? 0;
  for (const key of BENEFIT_USED_KEYS) row.benefitUsed += sale[key] ?? 0;
  row.cash += sale.usedPhoneRemaining ?? 0;
}

/** day: "YYYY-MM-DD" 이면 C열 개통일이 그날인 판매만, "" 이면 월 시트 전체 */
export function filterByDay(sales: SheetSale[], day: string): SheetSale[] {
  return day ? sales.filter((s) => s.activatedAt === day) : sales;
}

/**
 * 직원별 집계. staffOrder 의 직원은 판매가 없어도 0 으로 한 행씩 (날짜를 바꿔도 직원 행이 유지되게).
 * total = 표시된 직원 행의 합계.
 */
export function aggregateStaffPerformance(
  sales: SheetSale[],
  staffOrder: string[],
): { rows: StaffPerformance[]; total: StaffPerformance } {
  const byStaff = new Map<string, StaffPerformance>();
  for (const name of staffOrder) byStaff.set(name, emptyRow(name));
  for (const sale of sales) {
    const name = sale.staff || NO_STAFF;
    if (!byStaff.has(name)) byStaff.set(name, emptyRow(name));
    add(byStaff.get(name)!, sale);
  }
  const rows = [...byStaff.values()];
  for (const row of rows) {
    row.totalAmount = row.benefitSecured + row.benefitUsed + row.cash;
  }
  const total = emptyRow("전체");
  for (const row of rows) {
    for (const key of Object.keys(total) as (keyof StaffPerformance)[]) {
      if (key !== "staff") (total[key] as number) += row[key] as number;
    }
  }
  return { rows, total };
}

/** 직원 행 순서: 그 월 시트 판매에 나오는 직원명 (가나다순), 직원명 없는 판매는 맨 뒤 */
export function staffOrderOf(sales: SheetSale[]): string[] {
  const names = [...new Set(sales.map((s) => s.staff).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, "ko"),
  );
  return sales.some((s) => !s.staff) ? [...names, NO_STAFF] : names;
}

/** "2026-10" → ["2026-10-01", … 말일] */
export function daysOfMonth(yearMonth: string): string[] {
  const [y, m] = yearMonth.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from(
    { length: last },
    (_, i) => `${yearMonth}-${String(i + 1).padStart(2, "0")}`,
  );
}
