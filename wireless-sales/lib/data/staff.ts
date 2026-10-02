import { STAFF_NAMES } from "./staff-list";

/*
 * 직원 목록 조회 창구.
 * 판매 등록 화면과 저장 API(서버 검증)가 이 함수를 사용한다.
 */
export async function getStaffNames(): Promise<string[]> {
  return STAFF_NAMES;
}
