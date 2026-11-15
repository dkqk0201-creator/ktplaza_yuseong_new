/*
 * 리본(중고폰 보상판매) 실적 판정 — 2026-11-15 확정 기준 (화면 이름 "리본", 저장 칸 이름은 예전 그대로 goodbye)
 *
 * 판단 근거는 카톡 판매보고의 "중고폰&현물 판매" 첫 줄 내용(usedPhone)뿐이다.
 * 고객약속사항 등 다른 메모에 "리본"이 있어도 보지 않는다.
 *   리본 진행 (리본, 리본 20만원, 폴드6/리본, 점프3리본·점프+리본처럼 점프와 함께) → O
 *   리본예정·추후 리본·리본 예정            → X (실제 진행 후 판매 수정에서 내용을 고치면 O 로 바뀜)
 *   리본X·리본 미진행·리본 취소·리본 안함   → X
 *   점프만 · 일반 중고폰·현물 판매 · 없음·x·빈칸 → X
 *   보고에 그 줄 자체가 없음(예전 양식)       → 판정하지 않음 (기존 리본 값을 바꾸지 않음)
 *
 * 과거 판매(판매연결에 리본 값이 저장되지 않은 판매)는 저장하지 않고 조회할 때 계산한다:
 *   웹앱참고(참고내용)가 그 판매에 정확히 연결되어 있고 중고폰&현물 판매 내용이 있으면 위 규칙 → "자동판정"
 *   참고내용이 없거나(연결 안 됨 포함) 그 항목이 없으면 → "판정 불가" (X 로 세지 않음)
 */

export type RibbonValue = "O" | "X";

/** 중고폰&현물 판매 내용 → O / X (빈칸도 X) */
export function ribbonFromUsedPhone(text: string): RibbonValue {
  const t = (text ?? "").replace(/\s+/g, "").toLowerCase();
  if (!t.includes("리본") && !t.includes("ribbon")) return "X";
  // 취소·미진행·안함·X 표시
  if (/리본(x|미진행|취소|안함|안했|불가|못함|no)/.test(t) || /(미진행|취소)리본/.test(t)) return "X";
  // 예정·추후 (아직 진행 안 함)
  if (/예정|추후|나중|다음에/.test(t)) return "X";
  return "O";
}

export type RibbonState =
  | { value: RibbonValue; source: "saved" | "auto" }
  | { value: "판정불가"; source: "none" };

/**
 * 판매 1건의 리본 실적.
 * 판매연결에 O/X 가 저장돼 있으면 그 값, 없으면 정확히 연결된 참고내용의 중고폰&현물 판매로 자동판정, 그것도 없으면 판정 불가.
 */
export function ribbonOf(sale: { link?: { goodbye?: string }; notes?: Partial<Record<string, string>> }): RibbonState {
  const saved = (sale.link?.goodbye ?? "").trim().toUpperCase();
  if (saved === "O" || saved === "X") return { value: saved, source: "saved" };
  const used = sale.notes?.usedPhone;
  if (typeof used === "string" && used.trim() !== "") return { value: ribbonFromUsedPhone(used), source: "auto" };
  return { value: "판정불가", source: "none" };
}

export const RIBBON_MODES = ["자동", "수동"] as const;
export type RibbonMode = (typeof RIBBON_MODES)[number];

/**
 * 저장할 리본 값이 자동판정과 같은지로 방식(자동/수동)을 정한다.
 * 중고폰&현물 판매 내용이 있고 판정과 같거나, 내용이 없고(빈칸) X 면 자동. 그 밖에 점장이 고른 값이면 수동.
 */
export function ribbonModeFor(goodbye: string, usedPhone: string): RibbonMode | "" {
  const g = (goodbye ?? "").trim().toUpperCase();
  if (g !== "O" && g !== "X") return "";
  return g === ribbonFromUsedPhone(usedPhone ?? "") ? "자동" : "수동";
}
