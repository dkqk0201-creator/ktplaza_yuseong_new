/**
 * KT플라자 유성점 직원 목록.
 * 간편등록의 직원명 확인(화면·서버 저장 검증)과 고불비사용 판매자 선택에 이 목록을 사용한다.
 * 직원이 바뀌면 이 목록만 수정하면 된다.
 *
 * - 퇴사·이동한 직원은 지우지 않고 lastMonth(마지막 근무월, "YYYY-MM")를 적는다.
 *   → 그다음 달부터 신규 등록 선택 목록에서만 빠진다.
 *   → 지난 판매·검수·직원 실적·고불비 기록은 장표·보관 시트에 적힌 이름 그대로 남는다
 *     (직원 실적·검수관리 등의 직원 목록은 이 파일이 아니라 장표에 적힌 직원명으로 만든다).
 */
export interface StaffMember {
  name: string;
  /** 마지막 근무월 (예: "2026-10"). 없으면 현재 근무 중 */
  lastMonth?: string;
}

export const STAFF: readonly StaffMember[] = [
  { name: "김수현" },
  { name: "김승원", lastMonth: "2026-10" }, // 2026년 10월까지 근무
  { name: "윤기석" },
  { name: "이병훈" },
  { name: "이호준" },
  { name: "정찬욱" },
];

/** 예전 직원 포함 전체 이름 (지난 기록 표시·확인용) */
export const ALL_STAFF_NAMES: readonly string[] = STAFF.map((s) => s.name);

/** month("YYYY-MM")에 근무 중인 직원 (신규 등록 선택 목록) */
export function activeStaffNames(month: string): string[] {
  return STAFF.filter((s) => !s.lastMonth || month <= s.lastMonth).map((s) => s.name);
}

/** 그 직원의 마지막 근무월 (현재 근무 중이거나 목록에 없으면 null) */
export function staffLastMonth(name: string): string | null {
  return STAFF.find((s) => s.name === name)?.lastMonth ?? null;
}
