/*
 * 참고내용(웹앱참고)·정책명 연결 키 = 월|개통일|CTN 숫자|고객명 — 같은 키 판매가 있을 때.
 * "[현재 동작]"은 지금 코드 기록 (마스킹 후 키가 겹치면 같은 일이 생긴다 → 09-privacy-spec todo).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, edit } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";

const [A, B] = PEOPLE;

test("1) 같은 키 판매가 2건이면 조회 시 참고내용을 어느 쪽에도 붙이지 않음", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { extra: "중고폰&현물 판매 : 리본\n" }));
  // 시트에서 직접 같은 개통일·고객·CTN 판매를 하나 더 만든 상황 (2회선 등)
  const m = ss.month();
  const src = (await list())[0].row;
  for (let c = 1; c <= 38; c++) { const a = m.cell(src, c); const b = m.cell(src + 1, c); b.value = c === 2 ? 2 : a.value; b.formula = a.formula.replace(new RegExp(String(src), "g"), String(src + 1)); }
  const sales = await list();
  assert.equal(sales.length, 2);
  assert.ok(sales.every((s) => !s.notes?.usedPhone), JSON.stringify(sales.map((s) => s.notes)));
});

test("2) 같은 키 판매가 2건이면 참고내용 수정은 거부 (다른 판매에 붙지 않게)", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn));
  const m = ss.month();
  const src = (await list())[0].row;
  for (let c = 1; c <= 38; c++) { const a = m.cell(src, c); const b = m.cell(src + 1, c); b.value = c === 2 ? 2 : a.value; b.formula = a.formula.replace(new RegExp(String(src), "g"), String(src + 1)); }
  const s = (await list())[0];
  const r = await edit(s, {}, { usedPhone: "새 메모" } as Record<string, string>);
  assert.equal(r.ok, false);
  assert.match(r.message, /2건 이상/);
});

test("3) [현재 동작·위험] 같은 키로 새 판매를 등록하면 웹앱참고의 기존 참고내용을 덮어씀 (저장 때 중복 확인 없음)", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { extra: "중고폰&현물 판매 : 첫판매메모\n" }));
  await register(report(A.name, A.ctn, { extra: "중고폰&현물 판매 : 둘째판매메모\n" })); // 같은 개통일·고객·CTN
  const rows = ss.getSheetByName("웹앱참고")!.rows.slice(1).filter((r) => r[0]?.value);
  assert.equal(rows.length, 1);
  assert.match(String(rows[0][5].value), /둘째판매메모/);
  assert.doesNotMatch(String(rows[0][5].value), /첫판매메모/);
});

test("4) 다른 사람(키가 다름)의 참고내용은 섞이지 않음", async () => {
  setup();
  await register(report(A.name, A.ctn, { extra: "중고폰&현물 판매 : A메모\n" }), report(B.name, B.ctn, { extra: "중고폰&현물 판매 : B메모\n" }));
  const sales = await list();
  assert.deepEqual(sales.map((s) => [s.customer, s.notes?.usedPhone]), [[A.name, "A메모"], [B.name, "B메모"]]);
});
