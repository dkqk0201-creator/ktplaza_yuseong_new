/* 안전장치: 정책사용 영역의 미인식 항목에 금액이 있으면 조용히 버리지 않고 저장 차단 (화면 판정 + 서버 재확인) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, authed } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { parseQuickReports, normalizeQuick, STAFF_REPORT_TEMPLATE, POLICY_USE_UNKNOWN_MESSAGE } from "@/lib/quick-report";
import { POST as quickPOST } from "@/app/api/sales/quick/route";
import { STAFF_NAMES } from "../harness/staff.ts";

const [A, B] = PEOPLE;
const guard = (use: string, extra = "") =>
  parseQuickReports(report(A.name, A.ctn, { use, extra }))[0].policyUseUnknown;

test("차단: 정책사용 안의 모르는 항목명 + 금액 (여러 표기)", () => {
  for (const use of [
    "ㄴ고혜(할부) : 41,793원",
    "ㄴ기존할부금 : 41793",
    "ㄴ고혜할부 41,793원", // ":" 없이
    "ㄴ고혜(할부금 : 41,793원", // 괄호 오타
    "ㄴ요금고혜 : 4만",
    "ㄴ기타지원 : 약 4만원쯤", // 금액을 읽을 수 없어도 숫자가 있으면 확인 필요
    "고혜(할부) : 41,793원", // "ㄴ" 빠진 줄
  ]) {
    assert.equal(guard(use).length, 1, use);
  }
  // 정책사용 제목 줄에 금액
  const [r] = parseQuickReports(report(A.name, A.ctn).replace("정책사용", "정책사용 : 4만"));
  assert.deepEqual(r.policyUseUnknown, ["정책사용 : 4만"]);
});

test("차단 안 함: 정상 항목·빈칸·숫자 없는 메모·0원·X", () => {
  for (const use of [
    "",
    "ㄴ추가지원금 : 100,000원\nㄴ고혜(기존할부금) : 41,793원\nㄴ고혜(요금) : 30,000원",
    "ㄴ추가지원금 :\nㄴ고혜(기존할부금) :\nㄴ고혜(요금) :",
    "ㄴ고혜(할부금) : 41,793원(기존할부)", // 이제 인식되는 별칭
    "ㄴ메모 : 기존할부 고객이 직접 수납",
    "ㄴ기타 : 0원",
    "ㄴ기타 : X",
    "ㄴ기타 :",
  ]) {
    assert.deepEqual(guard(use), [], use);
  }
});

test("차단 범위는 정책사용 영역만: 다른 묶음·고객약속사항의 숫자는 영향 없음", () => {
  const extra = [
    "",
    "2ND : 워치",
    "ㄴ모르는항목 : 30,000원",
    "디초/삼초 : 에어팟",
    "ㄴ메모 : 2만 할인",
    "중고폰&현물 판매 : 점프3",
    "ㄴ판매금액 : 60,000원",
    "ㄴ사용금액 : 41,793원",
    "ㄴ어디에 : 기존할부 41,793원",
    "고객약속사항 : 12.3일 내방",
    "익월 10일 요금제 변경 3만원 지원",
  ].join("\n");
  assert.deepEqual(guard("ㄴ고혜(요금) : 10,000원", extra), []);
  // 정책 묶음(정책사용 아님)의 모르는 줄도 기존 동작 그대로
  const [r] = parseQuickReports(report(A.name, A.ctn).replace("정책\n", "정책\nㄴ모르는정책 : 5만\n"));
  assert.deepEqual(r.policyUseUnknown, []);
});

test("직원 양식(빈칸)·양식에 금액을 모두 채운 보고는 통과", () => {
  const blank = STAFF_REPORT_TEMPLATE;
  assert.deepEqual(parseQuickReports(blank)[0].policyUseUnknown, []);
  const filled = STAFF_REPORT_TEMPLATE
    .replace("개통일자 : ", "개통일자 : 10.05")
    .replace("ㄴ추가지원금 : ", "ㄴ추가지원금 : 100,000원")
    .replace("ㄴ고혜(기존할부금) : ", "ㄴ고혜(기존할부금) : 41,793원(기존할부)")
    .replace("ㄴ고혜(요금) : ", "ㄴ고혜(요금) : 12,000원");
  const [r] = parseQuickReports(filled);
  assert.deepEqual(r.policyUseUnknown, []);
  const n = normalizeQuick(r.fields, { today: "2026-10-13", staffNames: STAFF_NAMES });
  assert.equal(n.row.usedModelPlan, 53793);
});

test("서버: 미인식 금액 줄이 있는 건은 장표에 쓰지 않고, 같이 보낸 정상 건만 저장", async () => {
  const { ss } = setup();
  const before = ss.month().rows.length;
  const r = await register(
    report(A.name, A.ctn, { use: "ㄴ고혜(할부) : 41,793원\nㄴ고혜(요금) :" }),
    report(B.name, B.ctn, { use: "ㄴ고혜(할부금) : 41,793원(기존할부)\nㄴ고혜(요금) :" }),
  );
  assert.equal(r.results[0].ok, false);
  assert.equal(r.results[0].message, POLICY_USE_UNKNOWN_MESSAGE);
  assert.deepEqual(r.results[0].errors, ["정책사용 미인식 항목: ㄴ고혜(할부) : 41,793원"]);
  assert.equal(r.results[1].ok, true);
  assert.deepEqual((await list()).map((s) => s.customer), [B.name]);
  assert.equal(ss.month().rows.length >= before, true);
});

test("서버: 형식이 틀린 policyUseUnknown 은 거부, 항목이 없는 요청(예전 화면)은 그대로 저장", async () => {
  setup();
  const call = async (body: unknown) => {
    const res = await quickPOST(authed("/api", { method: "POST", body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  const fieldsA = parseQuickReports(report(A.name, A.ctn))[0].fields;
  const bad = await call({ items: [{ fields: fieldsA, policyUseUnknown: "문자열" }] });
  assert.equal(bad.status, 400);
  assert.equal((await list()).length, 0);
  const legacy = await call({ items: [{ fields: fieldsA }] });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.results[0].ok, true);
  // 1건 형식 요청에도 같은 차단
  const fieldsB = parseQuickReports(report(B.name, B.ctn))[0].fields;
  const one = await call({ fields: fieldsB, policyUseUnknown: ["ㄴ고혜(할부) : 41,793원"] });
  assert.equal(one.status, 400);
  assert.equal(one.body.message, POLICY_USE_UNKNOWN_MESSAGE);
  assert.deepEqual((await list()).map((s) => s.customer), [A.name]);
});
