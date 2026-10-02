import { MOCK_STAFF } from "./mock-staff";

/*
 * 직원 목록 조회 창구.
 * 나중에 Google 스프레드시트를 연결할 때 이 파일의 내부 구현만 바꾼다.
 */
export async function getStaffNames(): Promise<string[]> {
  return MOCK_STAFF;
}
