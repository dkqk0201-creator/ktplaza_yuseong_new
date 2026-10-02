"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 판매 데이터 공유 저장소 (브라우저 안).
 * - 대시보드와 판매 현황이 같은 조회 결과를 함께 쓴다 → 메뉴를 오갈 때 Apps Script를 다시 부르지 않음.
 * - 조회한 지 STALE_MS 가 지나면 다음에 화면을 열 때·창으로 돌아올 때 다시 조회한다.
 * - 판매 등록·삭제가 성공하면 invalidate() 로 즉시 무효화하고 장표에서 다시 읽는다.
 * - 브라우저를 새로고침하면 저장소가 비워진 채 시작하므로 항상 장표에서 새로 읽는다.
 */

export const STALE_MS = 60_000;
export const SALES_LIST_ENDPOINT = "/api/sales/list";

export interface SalesData {
  sheet: string;
  sales: SheetSale[];
}

interface SalesDataState {
  data: SalesData | null;
  /** 마지막 조회 실패 메시지 (성공하면 지워짐) */
  error: string | null;
  loading: boolean;
  /** 마지막으로 조회에 성공한 시각 (ms) */
  fetchedAt: number | null;
}

interface SalesDataContextValue extends SalesDataState {
  /** 지금 바로 장표에서 다시 읽는다 */
  refresh: () => Promise<void>;
  /** 데이터가 없거나 오래됐을 때만 다시 읽는다 (화면을 열 때 호출) */
  ensureFresh: () => void;
  /** 등록·삭제 성공 후: 기존 데이터를 무효로 하고 즉시 다시 읽는다 */
  invalidate: () => Promise<void>;
}

const SalesDataContext = createContext<SalesDataContextValue | null>(null);

async function fetchSales(): Promise<
  { ok: true; data: SalesData } | { ok: false; message: string }
> {
  try {
    const response = await fetch(SALES_LIST_ENDPOINT, { cache: "no-store" });
    const body = await response.json();
    if (body?.ok === true && Array.isArray(body.sales)) {
      return { ok: true, data: { sheet: body.sheet, sales: body.sales } };
    }
    return {
      ok: false,
      message: body?.message || "판매내역을 불러오지 못했습니다.",
    };
  } catch {
    return {
      ok: false,
      message:
        "서버와 통신하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
    };
  }
}

export function SalesDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SalesDataState>({
    data: null,
    error: null,
    loading: false,
    fetchedAt: null,
  });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // 세대 번호: 무효화하면 올라가고, 이전 세대에 시작한 조회 결과는 버린다
  const generationRef = useRef(0);
  const inflightRef = useRef<{
    generation: number;
    promise: Promise<void>;
  } | null>(null);
  const staleRef = useRef(false);

  const refresh = useCallback((): Promise<void> => {
    const generation = generationRef.current;
    // 같은 세대의 조회가 이미 진행 중이면 그 결과를 함께 기다린다 (중복 호출 방지)
    if (inflightRef.current?.generation === generation) {
      return inflightRef.current.promise;
    }
    setState((s) => ({ ...s, loading: true }));
    const promise = fetchSales().then((result) => {
      if (generation !== generationRef.current) return; // 그사이 무효화됨 → 버림
      inflightRef.current = null;
      if (result.ok) {
        staleRef.current = false;
        setState({
          data: result.data,
          error: null,
          loading: false,
          fetchedAt: Date.now(),
        });
      } else {
        // 실패해도 이전 데이터는 남겨 두되, 오류를 함께 보여준다
        setState((s) => ({ ...s, error: result.message, loading: false }));
      }
    });
    inflightRef.current = { generation, promise };
    return promise;
  }, []);

  const ensureFresh = useCallback(() => {
    const { data, fetchedAt } = stateRef.current;
    const old = fetchedAt === null || Date.now() - fetchedAt > STALE_MS;
    if (!data || old || staleRef.current) void refresh();
  }, [refresh]);

  const invalidate = useCallback(() => {
    generationRef.current += 1;
    inflightRef.current = null;
    staleRef.current = true;
    return refresh();
  }, [refresh]);

  // 다른 창·탭에 갔다가 돌아오면 오래된 데이터인지 확인한다
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && stateRef.current.data) {
        ensureFresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ensureFresh]);

  const value = useMemo(
    () => ({ ...state, refresh, ensureFresh, invalidate }),
    [state, refresh, ensureFresh, invalidate],
  );

  return (
    <SalesDataContext.Provider value={value}>
      {children}
    </SalesDataContext.Provider>
  );
}

export function useSalesData(): SalesDataContextValue {
  const value = useContext(SalesDataContext);
  if (!value) {
    throw new Error(
      "useSalesData 는 SalesDataProvider 안에서만 사용할 수 있습니다.",
    );
  }
  return value;
}

/** 화면이 열릴 때 데이터가 없거나 오래됐으면 불러온다 */
export function useFreshSalesData(): SalesDataContextValue {
  const value = useSalesData();
  const { ensureFresh } = value;
  useEffect(() => {
    ensureFresh();
  }, [ensureFresh]);
  return value;
}
