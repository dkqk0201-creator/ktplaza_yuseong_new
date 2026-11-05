/*
 * 개인정보 현재 상태 기록 (마스킹 구현 전). "[현재]" 테스트는 지금 원본이 어디에 있는지 기록 —
 * 마스킹 구현 후에는 09-privacy-spec 의 기대 동작으로 바뀌어야 한다.
 * 로그·Apps Script 로그에 원본이 없다는 것은 지금도 지켜져야 하는 규칙 (실패하면 안 됨).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, byName, edit, deleteSale, markDone, review, serverLogs, responses } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
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

test("2) [현재] 장표 D·E, 웹앱참고·검수보완 시트, 조회 응답에 원본이 그대로 있음", async () => {
  const { ss } = await allFlows();
  assert.ok(findOriginals(sheetTexts(ss, { only: ["10월"] }), [A]).length > 0);
  assert.ok(findOriginals(sheetTexts(ss, { only: ["웹앱참고"] }), [A]).length > 0);
  assert.ok(findOriginals(sheetTexts(ss, { only: ["검수보완"] }), [A]).length > 0);
  assert.ok(findOriginals(jsonTexts(responses), [A]).length > 0);
});

test("3) [현재] CTN 형식 오류 안내에 입력한 번호가 그대로 나옴 (입력한 화면에만, 로그에는 없음)", () => {
  const raw = "010-0000-99";
  const n = normalizeQuick(parseQuickReports(report(C.name, raw))[0].fields, { today: "2026-10-13", staffNames: STAFF_NAMES });
  assert.ok(n.issues.some((i) => i.message.includes(raw)));
});

test("4) [현재] 카드실적 카톡 안내·보완 요청 전달문에 고객명·전체 번호가 들어감", async () => {
  setup();
  await register(report(A.name, A.ctn, { extra: "제카 : 우리\n" }));
  const a = byName(await list(), A.name);
  assert.ok(cardPendingMessage(a).includes(A.ctn));
  assert.ok(reviewMessage(a, "x").includes(A.ctn) && reviewMessage(a, "x").includes(A.name));
});
