/*
 * 개인정보 — 전체 흐름(등록·형식 오류·수정·보완 요청·검수완료·거부되는 요청·삭제) 뒤 원본이 어디에도 없는지.
 * [마스킹 구현 후 기대값 변경] 2~4번은 수정 전 "[현재] 원본이 남아 있음"을 기록했던 테스트다.
 *   구현 후에는 같은 흐름에서 원본이 시트·응답·안내문 어디에도 없어야 한다.
 * 1번(로그에 원본 없음)은 수정 전·후 모두 지켜야 하는 규칙으로 그대로 둔다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, byName, edit, deleteSale, markDone, review, serverLogs, responses } from "../harness/web.ts";
import { PEOPLE, tMaskName as MN, tMaskPhone as MP } from "../harness/fake-people.ts";
import { findOriginals, sheetTexts, jsonTexts } from "../harness/privacy.ts";
import { cardPendingMessage } from "@/lib/card-message";
import { reviewMessage } from "@/lib/inspection-review";
import { normalizeQuick, parseQuickReports } from "@/lib/quick-report";
import { STAFF_NAMES } from "../harness/staff.ts";

const [A, B, C] = PEOPLE;
const P = [A, B, C];

async function allFlows() {
  const env = setup();
  serverLogs.length = 0; responses.length = 0;
  await register(report(A.name, A.ctn, { extra: "중고폰&현물 판매 : 메모\n" }), report(B.name, B.ctn, { date: "10.04" }));
  await register(report(C.name, "010-12", {})); // 형식 오류
  let a = byName(await list(), A.name);
  await edit(a, { customerBenefit: "60000" });
  a = byName(await list(), A.name);
  await review(a, "save", "서류 보완");
  a = byName(await list(), A.name);
  await markDone(a, "inspected");
  await edit({ ...byName(await list(), B.name), customer: "틀린이름" }, { customerBenefit: "1" }); // 거부되는 요청
  await deleteSale(byName(await list(), B.name));
  return env;
}

test("1) 서버 로그·Apps Script 로그에는 원본 고객명·번호가 남지 않음 (지금도 지켜야 하는 규칙)", async () => {
  const { gas } = await allFlows();
  assert.deepEqual(findOriginals(serverLogs, P), []);
  assert.deepEqual(findOriginals(gas.logs, P), []);
});

test("2) 장표 전체(월 시트·웹앱참고·검수보완 포함)와 웹앱 응답에 원본 이름·번호가 없음", async () => {
  const { ss, gas } = await allFlows();
  assert.deepEqual(findOriginals(sheetTexts(ss), P), []);
  assert.deepEqual(findOriginals(jsonTexts(responses), P), []);
  assert.deepEqual(findOriginals(jsonTexts(gas.calls.map((c) => c.reply)), P), []);
  // 같은 흐름이 실제로 기록을 남겼는지 (빈 시트라서 통과한 것이 아님)
  assert.ok(ss.getSheetByName("웹앱참고") && ss.getSheetByName("검수보완"));
  assert.ok(sheetTexts(ss, { only: ["10월"] }).some((t) => t.includes(MN(A.name))));
});

test("3) CTN 형식 오류 안내에 입력한 번호를 되풀이하지 않음", () => {
  const raw = "010-0000-99";
  const n = normalizeQuick(parseQuickReports(report(C.name, raw))[0].fields, { today: "2026-10-13", staffNames: STAFF_NAMES });
  assert.ok(n.issues.some((i) => i.field === "ctn"));
  assert.ok(n.issues.every((i) => !i.message.includes(raw) && !i.message.includes("0100000")));
});

test("4) 카드실적 카톡 안내·보완 요청 전달문에는 마스킹 고객명·CTN 만", async () => {
  setup();
  await register(report(A.name, A.ctn, { extra: "제카 : 우리\n" }));
  const a = byName(await list(), A.name);
  for (const text of [cardPendingMessage(a), reviewMessage(a, "x")]) {
    assert.deepEqual(findOriginals([text], [A]), []);
    assert.ok(text.includes(MN(A.name)) && text.includes(MP(A.ctn)), text);
  }
});
