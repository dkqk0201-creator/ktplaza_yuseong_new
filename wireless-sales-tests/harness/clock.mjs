// 테스트 시계 고정: TEST_NOW(기본 2026-10-13T12:00:00+09:00)부터 흐름. 웹앱 서버(오늘 날짜)와 Apps Script(이번 달 시트)가 같은 시계를 쓴다.
const RealDate = Date;
const start = RealDate.parse(process.env.TEST_NOW || "2026-10-13T12:00:00+09:00");
const offset = start - RealDate.now();
class TestDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
  static now() { return RealDate.now() + offset; }
}
globalThis.Date = TestDate;
