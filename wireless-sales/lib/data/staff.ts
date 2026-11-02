import { todayInKorea } from "@/lib/format";
import { activeStaffNames } from "./staff-list";

/*
 * 직원 목록 조회 창구.
 * 간편등록 화면과 저장 API(서버 검증)가 이 함수를 사용한다.
 * 이번 달(한국 시간) 근무 중인 직원만 돌려준다 — 간편등록은 이번 달 개통만 등록하므로
 * 마지막 근무월이 지난 직원은 신규 등록에서 빠진다 (지난 기록은 그대로).
 */
export async function getStaffNames(month: string = todayInKorea().slice(0, 7)): Promise<string[]> {
  return activeStaffNames(month);
}
