/*
 * 가짜 고객 (실제 고객 아님). 이름은 일부러 흔하지 않은 조합, 번호는 010-0000-xxxx 대역 등 가짜.
 * 개인정보 검사에서 "원본이 어디에도 남지 않았는지" 찾을 문자열로도 쓴다.
 */
export interface FakePerson { name: string; ctn: string }
export const PEOPLE: FakePerson[] = [
  { name: "가나다", ctn: "010-0000-1111" },
  { name: "라마바", ctn: "010-0000-2222" },
  { name: "사아자", ctn: "010-0000-3333" },
  { name: "차카타", ctn: "010-0000-4444" },
  { name: "파하가", ctn: "010-0000-5555" },
  { name: "나다라", ctn: "010-0000-6666" },
  { name: "마바사", ctn: "010-0000-7777" },
  { name: "아자차", ctn: "010-0000-8888" },
];
/** 마스킹하면 같아지는 두 사람 (가나다 / 가나라 · 010-1200-0678 / 010-1299-9678) — 충돌 시험용 */
export const TWINS: [FakePerson, FakePerson] = [
  { name: "가나다", ctn: "010-1200-0678" },
  { name: "가나라", ctn: "010-1299-9678" },
];
export const digits = (s: string) => s.replace(/\D/g, "");
