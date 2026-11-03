// 테스트용 직원명: 10월 기준 근무 직원 (staff-list 구조가 바뀌어도 테스트가 따라가도록 한 곳에서)
import * as staff from "@/lib/data/staff-list";
const s = staff as Record<string, unknown>;
export const STAFF_NAMES: string[] = Array.isArray(s.ALL_STAFF_NAMES) ? [...(s.ALL_STAFF_NAMES as string[])] : [...(s.STAFF_NAMES as string[])];
