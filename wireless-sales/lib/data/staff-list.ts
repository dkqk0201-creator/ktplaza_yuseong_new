/**
 * KT플라자 유성점 직원 목록.
 * 간편등록의 직원명 확인(화면·서버 저장 검증)과 고불비사용 판매자 선택에 이 목록을 사용한다.
 * 직원이 바뀌면 이 목록만 수정하면 된다.
 *
 * - 퇴사·이동한 직원은 지우지 않고 lastMonth(마지막 근무월, "YYYY-MM")를 적는다.
 *   → 그다음 달부터 신규 등록 선택 목록에서만 빠진다.
 *   → 지난 판매·검수·직원 실적·고불비 기록은 장표·보관 시트에 적힌 이름 그대로 남는다
 *     (직원 실적·검수관리 등의 직원 목록은 이 파일이 아니라 장표에 적힌 직원명으로 만든다).
 *
 * 직원 ID (id, "st-001" 형식): 무선판매관리 웹앱 안에서 바뀌지 않는 직원 번호. 한 번 정하면 바꾸거나 다른 직원에게 다시 쓰지 않는다.
 *   - 실적 집계는 지금처럼 장표 M열 직원명으로 한다 (호환). ID 는 목표·판매연결·향후 연동에만 쓴다.
 *   - 이름이 바뀌면 name 을 고치고 예전 이름을 formerNames 에 남긴다 → 예전 장표의 이름도 같은 ID 로 묶인다.
 *   - prospectStaffId: 가망고객관리 웹앱의 직원 ID. 점장이 직접 확인한 값만 적는다
 *     (이름이 같다는 이유로 자동 연결하지 않는다 — 비어 있으면 아직 연결 안 됨).
 */
export interface StaffMember {
  id: string;
  name: string;
  /** 마지막 근무월 (예: "2026-10"). 없으면 현재 근무 중 */
  lastMonth?: string;
  /** 점장 (목표관리에서 개인 목표는 선택, 실적은 포함) */
  manager?: boolean;
  /** 예전 이름 (이름 변경 시) */
  formerNames?: readonly string[];
  /** 가망고객관리 웹앱 직원 ID (점장이 확인 후 입력) */
  prospectStaffId?: string;
}

export const STAFF: readonly StaffMember[] = [
  { id: "st-001", name: "김수현", manager: true },
  { id: "st-002", name: "김승원", lastMonth: "2026-10" }, // 2026년 10월까지 근무
  { id: "st-003", name: "윤기석" },
  { id: "st-004", name: "이병훈" },
  { id: "st-005", name: "이호준" },
  { id: "st-006", name: "정찬욱" },
];

/** 장표 직원명 → 직원 ID (현재·예전 이름 정확히 일치할 때만, 아니면 null) */
export function staffIdForName(name: string): string | null {
  const n = (name ?? "").trim();
  if (!n) return null;
  return STAFF.find((s) => s.name === n || s.formerNames?.includes(n))?.id ?? null;
}

/** 직원 ID → 현재 이름 (없으면 null) */
export function staffNameForId(id: string): string | null {
  return STAFF.find((s) => s.id === id)?.name ?? null;
}

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
