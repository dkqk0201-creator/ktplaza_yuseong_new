/* 간편등록: 카톡 "고혜(할부금)" 표기·금액 뒤 괄호 설명 → V열(고혜(요금)+고혜(기존할부금) 합계) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, byName } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { colNum as L } from "../harness/formula.ts";
import { normalizeQuick, parseQuickReports } from "@/lib/quick-report";
import { STAFF_NAMES } from "../harness/staff.ts";

const [A] = PEOPLE;
const ctx = { today: "2026-10-13", staffNames: STAFF_NAMES };

async function save(use: string) {
  const { ss } = setup();
  const text = report(A.name, A.ctn, { date: "10.05", use });
  const [r] = parseQuickReports(text);
  const n = normalizeQuick(r.fields, ctx);
  const res = (await register(text)).results[0];
  const row = res.ok ? res.row : null;
  const sale = res.ok ? byName(await list(), A.name) : null;
  return {
    r, n, res,
    V: row ? ss.month().value(row, L("V")) : undefined,
    W: row ? ss.month().value(row, L("W")) : undefined,
    U: row ? ss.month().peek(row, L("U"))!.formula : undefined,
    notes: sale?.notes ?? {},
  };
}

test("① 고혜(할부금) : 41,793원(기존할부) + 추가지원금 → V=41,793, W=100,000", async () => {
  const s = await save("ㄴ추가지원금 : 100,000원\nㄴ고혜(할부금) : 41,793원(기존할부)\nㄴ고혜(요금) :");
  assert.deepEqual(s.r.unknownLines, []);
  assert.equal(s.n.display.useInstallment, "41,793원");
  assert.deepEqual(s.n.issues, []);
  assert.equal(s.res.ok, true);
  assert.equal(s.V, 41793);
  assert.equal(s.W, 100000);
  assert.match(s.U!, /^=SUM\(V\d+:Y\d+\)$/);
  assert.equal(s.notes.vInstallment, "41793");
  assert.equal(s.notes.vPlan, undefined);
});

test("② 41,793원 / ③ 41793 → V=41,793", async () => {
  for (const v of ["41,793원", "41793"]) {
    const s = await save(`ㄴ고혜(할부금) : ${v}\nㄴ고혜(요금) :`);
    assert.equal(s.V, 41793, v);
    assert.equal(s.notes.vInstallment, "41793", v);
  }
});

test("④ 0원 → V=0 (기존 고혜(기존할부금) 0원과 같은 결과)", async () => {
  const s = await save("ㄴ고혜(할부금) : 0원\nㄴ고혜(요금) :");
  const ref = await save("ㄴ고혜(기존할부금) : 0원\nㄴ고혜(요금) :");
  assert.equal(s.V, 0);
  assert.equal(s.V, ref.V);
});

test("⑤ 빈칸 → V='-' (공란 규칙), 세부 기록 없음", async () => {
  const s = await save("ㄴ고혜(할부금) :\nㄴ고혜(요금) :");
  assert.equal(s.res.ok, true);
  assert.equal(s.V, "-");
  assert.equal(s.notes.vInstallment, undefined);
});

test("⑥ 고혜(요금) 30,000 + 고혜(할부금) 41,793 → V=71,793 (한 번만 합산)", async () => {
  const s = await save("ㄴ고혜(할부금) : 41,793원(기존할부)\nㄴ고혜(요금) : 30,000원");
  assert.equal(s.V, 71793);
  assert.deepEqual([s.notes.vPlan, s.notes.vInstallment], ["30000", "41793"]);
  assert.match(s.n.display.usePlan!, /V열 합계 71,793원/);
});

test("기존 양식 표기 고혜(기존할부금)도 그대로 동작 + 괄호 설명 허용", async () => {
  assert.equal((await save("ㄴ고혜(기존할부금) : 41,793원\nㄴ고혜(요금) :")).V, 41793);
  assert.equal((await save("ㄴ고혜(기존할부금) : 41,793원(기존할부)\nㄴ고혜(요금) :")).V, 41793);
  assert.equal((await save("ㄴ고혜(기존할부) : 41,793원\nㄴ고혜(요금) :")).V, 41793);
});

test("괄호 안에 숫자가 있으면 금액이 애매 → 저장하지 않고 확인 필요", async () => {
  const s = await save("ㄴ고혜(할부금) : 41,793원(+10,000)\nㄴ고혜(요금) :");
  assert.equal(s.res.ok, false);
  assert.equal(s.n.issues[0].field, "useInstallment");
});

test("같은 항목을 두 표기로 두 번 적으면 덮어쓰지 않고 확인 필요", () => {
  const [r] = parseQuickReports(report(A.name, A.ctn, { use: "ㄴ고혜(기존할부금) : 10,000원\nㄴ고혜(할부금) : 41,793원" }));
  assert.equal(r.fields.useInstallment, "10,000원");
  assert.deepEqual(r.repeatedFields, ["useInstallment"]);
});
