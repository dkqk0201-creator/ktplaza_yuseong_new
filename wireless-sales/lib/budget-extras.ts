import type { GobulbiMonth } from "@/lib/gobulbi";
import type { OtherBudgetMonth } from "@/lib/other-budget";

/*
 * 예산관리 예산 현황의 고불비사용 + 기타 예산 조회 (화면 공용, 비밀값 없음).
 *
 * 속도 (2026-11-28 점장 요청):
 *   - /api/budget/extras 한 번으로 두 가지를 같이 받는다 (로그인 확인 1번, Apps Script 조회 2개 동시).
 *   - 브라우저 안 월별 저장소: 다른 메뉴에 다녀와도 STALE_MS(60초, 판매내역 저장소와 같음) 안이면 다시 부르지 않는다.
 *   - 같은 월 조회가 이미 진행 중이면 새로 보내지 않고 그 결과를 같이 기다린다 (중복 요청 방지).
 *   - 예산관리 화면을 여는 즉시(판매내역을 기다리지 않고) 시작할 수 있다 (prefetchBudgetExtras).
 * 정확성:
 *   - 월마다 따로 보관하고, 응답의 month 가 요청한 월과 같을 때만 쓴다 (월 혼동 방지).
 *   - 고불비·기타 예산을 등록·수정·삭제하면 화면이 그 항목을 다시 읽어 저장소도 바로 바꾼다 (갱신 누락 방지).
 *   - 60초가 지난 값은 "확정값"으로 쓰지 않는다 → 다시 조회하는 동안 화면은 '예산 계산 중'으로 표시
 *     (직전 값은 '직전 조회값·확인 중'으로만 보여 줌).
 *   - 실패는 0원으로 바꾸지 않고 실패로 남긴다.
 * 계산식(고불비 차감·기타 예산 반영)은 lib/gobulbi.ts·lib/other-budget.ts 그대로.
 */

export const BUDGET_EXTRAS_ENDPOINT = "/api/budget/extras";
/** 이 시간 안에 받은 값은 다시 부르지 않고 그대로 쓴다 (판매내역 저장소 STALE_MS 와 같음) */
export const BUDGET_EXTRAS_FRESH_MS = 60_000;

export type BudgetExtrasPart<T> = { ok: true; data: T } | { ok: false; message: string; notDeployed: boolean };

export type BudgetExtrasResponse =
  | { ok: true; month: string; gobulbi: BudgetExtrasPart<GobulbiMonth>; other: BudgetExtrasPart<OtherBudgetMonth> }
  | { ok: false; message: string };

export interface ExtrasEntry {
  month: string;
  gobulbi?: { data: GobulbiMonth; at: number };
  other?: { data: OtherBudgetMonth; at: number };
}

const NETWORK_FAIL = "서버와 통신하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 조회해 주세요.";

/* 브라우저 안 저장소 (새로고침하면 비워짐) */
const store = new Map<string, ExtrasEntry>();
const inflight = new Map<string, Promise<BudgetExtrasResponse>>();
/** 저장소가 바뀌면 알림 받을 화면들 */
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function subscribeBudgetExtras(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function cachedBudgetExtras(month: string): ExtrasEntry | undefined {
  return store.get(month);
}

export function isFresh(at: number | undefined, now = Date.now()): boolean {
  return at !== undefined && now - at <= BUDGET_EXTRAS_FRESH_MS;
}

/** 고불비 조회 결과를 저장소에 넣는다 (등록·수정·삭제 후 다시 읽은 값 포함). 다른 월 응답은 버린다 */
export function storeGobulbi(month: string, data: GobulbiMonth, at = Date.now()) {
  if (data.month !== month) return;
  store.set(month, { ...(store.get(month) ?? { month }), gobulbi: { data, at } });
  notify();
}

export function storeOther(month: string, data: OtherBudgetMonth, at = Date.now()) {
  if (data.month !== month) return;
  store.set(month, { ...(store.get(month) ?? { month }), other: { data, at } });
  notify();
}

/** 저장소 비우기 (테스트·로그아웃용) */
export function clearBudgetExtras() {
  store.clear();
  inflight.clear();
  notify();
}

async function request(month: string): Promise<BudgetExtrasResponse> {
  try {
    const response = await fetch(`${BUDGET_EXTRAS_ENDPOINT}?month=${encodeURIComponent(month)}`, { cache: "no-store" });
    const body = (await response.json()) as BudgetExtrasResponse;
    if (typeof body?.ok !== "boolean") throw new Error("invalid");
    if (body.ok && (!response.ok || body.month !== month)) return { ok: false, message: "예산 조회 응답을 확인하지 못했습니다. 다시 조회해 주세요." };
    return body;
  } catch {
    return { ok: false, message: NETWORK_FAIL };
  }
}

/**
 * 그 달 고불비+기타 예산을 한 번에 조회해 저장소에 넣는다. 같은 월 조회가 진행 중이면 그 결과를 같이 쓴다.
 * 성공한 부분만 저장한다 (실패한 부분은 저장소의 이전 값을 지우지도, 0으로 바꾸지도 않음 — 화면이 실패로 표시).
 */
export function loadBudgetExtras(month: string): Promise<BudgetExtrasResponse> {
  const running = inflight.get(month);
  if (running) return running;
  const promise = request(month).then((res) => {
    inflight.delete(month);
    if (res.ok) {
      const at = Date.now();
      if (res.gobulbi.ok) storeGobulbi(month, res.gobulbi.data, at);
      if (res.other.ok) storeOther(month, res.other.data, at);
    }
    return res;
  });
  inflight.set(month, promise);
  return promise;
}

/** 저장소 값이 둘 다 60초 안이면 아무것도 안 하고, 아니면 조회를 시작한다 (예산관리 화면을 여는 즉시 호출) */
export function prefetchBudgetExtras(month: string): void {
  const e = store.get(month);
  if (e && isFresh(e.gobulbi?.at) && isFresh(e.other?.at)) return;
  void loadBudgetExtras(month);
}
