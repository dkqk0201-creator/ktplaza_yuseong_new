/*
 * 개인정보 마스킹 규칙 (웹앱 서버·화면 공용). Apps Script common.gs 의 wsMaskName_ · wsMaskPhone_ ·
 * wsMaskFreeText_ 와 같은 규칙이다 — 한쪽을 바꾸면 다른 쪽도 같이 바꾼다.
 *
 *   고객명: 마지막 글자만 *          김수현 → 김수*,  남궁민수 → 남궁민*,  이 → *
 *   영문 이름: 앞 2글자만 남김      JOHN SMITH → JO********
 *   휴대폰 11자리: 010-1234-5678 → 010-12**-*678
 *   휴대폰 10자리: 011-123-4567  → 011-12*-*567
 *   그 밖의 번호: 앞 3자리·끝 2자리만 남김 (5자리 이하는 모두 *)
 *   이미 * 가 들어 있는 값은 그대로 (몇 번을 거쳐도 같은 결과)
 *
 * 마스킹을 끄거나 원본 저장을 허용하는 설정은 두지 않는다.
 */

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/^'/, "")
    .trim();
}

export function maskName(value: unknown): string {
  const s = clean(value);
  if (!s || s.includes("*")) return s;
  const chars = Array.from(s);
  if (/[A-Za-z]/.test(s)) {
    return chars.slice(0, 2).join("") + "*".repeat(Math.max(chars.length - 2, 1));
  }
  if (chars.length === 1) return "*";
  return chars.slice(0, -1).join("") + "*";
}

export function maskPhone(value: unknown): string {
  const s = clean(value);
  if (!s || s.includes("*")) return s;
  const d = s.replace(/\D/g, "");
  if (!d) return s;
  if (d.length === 11 && d.startsWith("01")) {
    return `${d.slice(0, 3)}-${d.slice(3, 5)}**-*${d.slice(8)}`;
  }
  if (d.length === 10 && d.startsWith("01")) {
    return `${d.slice(0, 3)}-${d.slice(3, 5)}*-*${d.slice(7)}`;
  }
  if (d.length <= 5) return "*".repeat(d.length);
  return d.slice(0, 3) + "*".repeat(d.length - 5) + d.slice(-2);
}

const PHONE_IN_TEXT =
  /(^|[^\d*])(01[016789])[\s.-]?(\d{3,4})[\s.-]?(\d{4})(?![\d*])/g;

/**
 * 자유 입력 글 속 전화번호 마스킹. knownNames(간편등록에서 아는 원본 고객명)가 글에 있으면
 * 그 이름도 마스킹 이름으로 바꾼다 (2글자 이상만 — 한 글자는 다른 낱말과 겹치기 쉬움).
 */
export function maskFreeText(value: unknown, knownNames: readonly string[] = []): string {
  let s = String(value ?? "");
  for (const name of knownNames) {
    const original = clean(name);
    const masked = maskName(original);
    if (original.length >= 2 && masked !== original) s = s.split(original).join(masked);
  }
  return s.replace(PHONE_IN_TEXT, (_m, pre: string, a: string, b: string, c: string) => pre + maskPhone(a + b + c));
}

/** 장표 한 행(A~AL 38칸) 응답용 마스킹: D 고객명, E CTN, 그 밖의 글 칸은 글 속 전화번호 */
export function maskSheetValues(values: readonly unknown[]): unknown[] {
  return values.map((v, i) => {
    if (v === "" || v === null || v === undefined) return v;
    if (i === 3) return maskName(v);
    if (i === 4) return maskPhone(v);
    if (i === 1 || i === 2) return v;
    return typeof v === "string" ? maskFreeText(v) : v;
  });
}

/** 글자 기록(참고내용 등) 값 모두 마스킹 */
export function maskTextRecord(
  record: Record<string, string>,
  knownNames: readonly string[] = [],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).map(([k, v]) => [k, maskFreeText(v, knownNames)]),
  );
}
