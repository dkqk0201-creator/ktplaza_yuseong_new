/*
 * 무선장표에 쓰이는 수식만 계산하는 작은 계산기 (테스트 전용).
 *   =SUM(O9:T9) · =SUM(N9:N) · =N(Z9)-N(AA9) · =N(N9)-N(U9)+N(AB9)
 * SUM 은 숫자 칸만 더하고 글자("-", "X" 등)는 무시, N() 은 숫자가 아니면 0 (구글 시트와 같음).
 */
export const colNum = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
export const colLetter = (c: number) => { let s = ""; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };

export type Getter = (row: number, col: number) => unknown; // 1부터
export function evaluate(formula: string, get: Getter, maxRow: number): number | string {
  const src = formula.replace(/^=/, "").replace(/\s+/g, "");
  let i = 0;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const ref = (): [number, number | null] => {
    const m = /^([A-Z]+)(\d*)/.exec(src.slice(i));
    if (!m) throw new Error("수식 해석 실패: " + formula);
    i += m[0].length;
    return [colNum(m[1]), m[2] ? Number(m[2]) : null];
  };
  const term = (): number => {
    if (src.startsWith("SUM(", i)) {
      i += 4;
      const [c1, r1] = ref(); i++; // ':'
      const [c2, r2] = ref(); i++; // ')'
      let t = 0;
      for (let r = r1 ?? 1; r <= (r2 ?? maxRow); r++) for (let c = c1; c <= c2; c++) t += num(get(r, c));
      return t;
    }
    if (src.startsWith("N(", i)) {
      i += 2; const [c, r] = ref(); i++;
      return num(get(r!, c));
    }
    const m = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (m) { i += m[0].length; return Number(m[0]); }
    const [c, r] = ref();
    return num(get(r!, c));
  };
  let total = term();
  while (i < src.length) {
    const op = src[i++];
    const v = term();
    if (op === "+") total += v; else if (op === "-") total -= v; else throw new Error("수식 해석 실패: " + formula);
  }
  return total;
}
