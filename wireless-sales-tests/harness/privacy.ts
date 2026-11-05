/*
 * 개인정보 검사: 가짜 고객의 원본 이름·전화번호가 어디에 남았는지 찾는다.
 *   시트(값·수식·메모) / 웹앱 응답 / 서버 로그 / Apps Script 로그
 * 전화번호는 하이픈 유무 모두 찾는다. 이름은 2글자 이상 그대로 나오면 원본으로 본다.
 */
import type { FakeSpreadsheet } from "./fake-spreadsheet.ts";
import type { FakePerson } from "./fake-people.ts";

export function originalNeedles(people: readonly FakePerson[]): string[] {
  return people.flatMap((p) => [p.name, p.ctn, p.ctn.replace(/\D/g, "")]);
}
export function findOriginals(texts: readonly string[], people: readonly FakePerson[]): string[] {
  const needles = originalNeedles(people);
  const hits: string[] = [];
  for (const t of texts) for (const n of needles) if (t.includes(n)) hits.push(`${n} ← ${t.slice(0, 120)}`);
  return hits;
}
export function sheetTexts(ss: FakeSpreadsheet, opts: { only?: string[]; except?: string[] } = {}): string[] {
  return ss.getSheets()
    .filter((s) => (!opts.only || opts.only.includes(s.name)) && !(opts.except ?? []).includes(s.name))
    .flatMap((s) => s.allText().map((t) => `${s.name}: ${t}`));
}
export const jsonTexts = (xs: readonly unknown[]) => xs.map((x) => JSON.stringify(x));
