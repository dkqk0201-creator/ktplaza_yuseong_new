"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { GobulbiLoad } from "@/components/gobulbi-panel";
import type { OtherBudgetLoad } from "@/components/other-budget-panel";
import {
  BUDGET_EXTRAS_FRESH_MS,
  cachedBudgetExtras,
  loadBudgetExtras,
  storeGobulbi,
  storeOther,
  subscribeBudgetExtras,
  type ExtrasEntry,
} from "@/lib/budget-extras";
import { fetchGobulbi } from "@/lib/gobulbi-api";
import type { GobulbiMonth } from "@/lib/gobulbi";
import { fetchOtherBudget } from "@/lib/other-budget-api";
import type { OtherBudgetMonth } from "@/lib/other-budget";

/*
 * 예산 현황 화면의 고불비사용·기타 예산 상태 (lib/budget-extras.ts 저장소 사용).
 *   ok      = 화면을 연 시점에 60초 안에 받은 값, 또는 화면을 연 뒤 새로 받은 값 → 계산에 쓴다
 *   loading = 아직 그런 값이 없음(조회 중) 또는 등록·수정 후 다시 읽는 중 → '확인 중', 총 매장 예산은 '예산 계산 중'
 *   error   = 조회 실패 → 0원으로 바꾸지 않고 실패와 [다시 조회] 표시
 * 화면을 오래 열어 두어도 이미 받은 값이 '오래됨'으로 바뀌지는 않는다 (다시 들어오거나 월을 바꿀 때만 다시 확인).
 * 이 훅을 쓰는 화면은 월이 바뀌면 다시 만들어진다 (BudgetBody key = 월 시트) → 월마다 처음부터.
 */

type PartError = { message: string; notDeployed: boolean };
type PartState = { pending: boolean; error: PartError | null };
const IDLE: PartState = { pending: false, error: null };

function usable(part: { at: number } | undefined, mountedAt: number): boolean {
  return part !== undefined && part.at >= mountedAt - BUDGET_EXTRAS_FRESH_MS;
}

function partLoad<T>(part: { data: T; at: number } | undefined, mountedAt: number, state: PartState):
  | { status: "loading" }
  | { status: "error"; message: string; notDeployed: boolean }
  | { status: "ok"; data: T } {
  if (state.error) return { status: "error", ...state.error };
  if (state.pending) return { status: "loading" };
  if (part && usable(part, mountedAt)) return { status: "ok", data: part.data };
  return { status: "loading" };
}

export interface BudgetExtras {
  gobulbi: GobulbiLoad;
  other: OtherBudgetLoad;
  /** 아직 확정값이 없을 때 참고로만 보여 줄 직전 조회값 (화면을 열기 60초 넘게 전에 받은 값) */
  previous: { gobulbi?: GobulbiMonth; other?: OtherBudgetMonth };
  reloadGobulbi: () => Promise<void>;
  reloadOther: () => Promise<void>;
  /** 두 가지 모두 다시 조회 ([다시 조회]) */
  reloadAll: () => Promise<void>;
}

export function useBudgetExtras(month: string): BudgetExtras {
  const entry: ExtrasEntry | undefined = useSyncExternalStore(
    subscribeBudgetExtras,
    () => cachedBudgetExtras(month),
    () => undefined,
  );
  const [mountedAt] = useState(() => Date.now());
  const [g, setG] = useState<PartState>(IDLE);
  const [o, setO] = useState<PartState>(IDLE);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** 한 번에 조회. 실패한 항목은, 이미 쓸 수 있는 값이 없을 때만 실패로 표시 */
  const runAll = useCallback(
    async (force: boolean) => {
      const res = await loadBudgetExtras(month);
      if (!alive.current) return;
      const cur = cachedBudgetExtras(month);
      const errG: PartError | null = !res.ok ? { message: res.message, notDeployed: false } : res.gobulbi.ok ? null : { message: res.gobulbi.message, notDeployed: res.gobulbi.notDeployed };
      const errO: PartError | null = !res.ok ? { message: res.message, notDeployed: false } : res.other.ok ? null : { message: res.other.message, notDeployed: res.other.notDeployed };
      setG(errG && (force || !usable(cur?.gobulbi, mountedAt)) ? { pending: false, error: errG } : IDLE);
      setO(errO && (force || !usable(cur?.other, mountedAt)) ? { pending: false, error: errO } : IDLE);
    },
    [month, mountedAt],
  );

  // 처음 열 때: 60초 안 값이 둘 다 있으면 바로 사용, 아니면 한 번에 조회
  useEffect(() => {
    const e = cachedBudgetExtras(month);
    if (!(usable(e?.gobulbi, mountedAt) && usable(e?.other, mountedAt))) void runAll(false);
  }, [month, mountedAt, runAll]);

  const reloadGobulbi = useCallback(async () => {
    setG({ pending: true, error: null });
    const res = await fetchGobulbi(month);
    if (!alive.current) return;
    if (res.ok && res.data && res.data.month === month) {
      storeGobulbi(month, res.data);
      setG(IDLE);
    } else {
      setG({ pending: false, error: { message: res.ok ? "고불비사용 응답을 확인하지 못했습니다." : res.message, notDeployed: !res.ok && res.notDeployed === true } });
    }
  }, [month]);

  const reloadOther = useCallback(async () => {
    setO({ pending: true, error: null });
    const res = await fetchOtherBudget(month);
    if (!alive.current) return;
    if (res.ok && res.data && res.data.month === month) {
      storeOther(month, res.data);
      setO(IDLE);
    } else {
      setO({ pending: false, error: { message: res.ok ? "기타 예산 응답을 확인하지 못했습니다." : res.message, notDeployed: !res.ok && res.notDeployed === true } });
    }
  }, [month]);

  const reloadAll = useCallback(async () => {
    setG({ pending: true, error: null });
    setO({ pending: true, error: null });
    await runAll(true);
  }, [runAll]);

  const gobulbi = partLoad(entry?.gobulbi, mountedAt, g);
  const other = partLoad(entry?.other, mountedAt, o);
  return {
    gobulbi,
    other,
    previous: {
      gobulbi: gobulbi.status !== "ok" ? entry?.gobulbi?.data : undefined,
      other: other.status !== "ok" ? entry?.other?.data : undefined,
    },
    reloadGobulbi,
    reloadOther,
    reloadAll,
  };
}
