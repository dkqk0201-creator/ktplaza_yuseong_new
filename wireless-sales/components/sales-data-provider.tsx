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
 * - 검수관리·카드실적·예산관리·간편등록(중복 확인)이 같은 월의 조회 결과를 함께 쓴다
 *   → 메뉴를 오갈 때 Apps Script를 다시 부르지 않음.
 * - 월(시트)마다 따로 보관한다. 선택한 월은 메뉴를 옮겨도 유지된다.
 * - 조회한 지 STALE_MS 가 지나면 다음에 화면을 열 때·창으로 돌아올 때 다시 조회한다.
 * - 판매등록·간편등록·삭제가 성공하면 invalidate() 로 모든 월을 무효화하고 다시 읽는다.
 * - 브라우저를 새로고침하면 저장소가 비워진 채 시작하므로 항상 장표에서 새로 읽는다.
 */

export const STALE_MS = 60_000;
export const SALES_LIST_ENDPOINT = "/api/sales/list";

export interface SalesData {
  sheet: string;
  sales: SheetSale[];
}

interface MonthEntry {
  data: SalesData | null;
  error: string | null;
  loading: boolean;
  fetchedAt: number | null;
}

const EMPTY_ENTRY: MonthEntry = {
  data: null,
  error: null,
  loading: false,
  fetchedAt: null,
};

/** 선택한 월을 아직 모를 때(처음) 쓰는 키: Apps Script 가 이번 달 시트를 고른다 */
const CURRENT = "";

interface SalesDataContextValue extends MonthEntry {
  /** 지금 보고 있는 월 시트 이름 (예: "10월"). 처음엔 null (이번 달) */
  selectedSheet: string | null;
  /** 스프레드시트에 있는 월 시트 목록 */
  sheets: string[];
  selectSheet: (sheet: string) => void;
  /** 지금 보고 있는 월을 장표에서 다시 읽는다 */
  refresh: () => Promise<void>;
  /** 데이터가 없거나 오래됐을 때만 다시 읽는다 (화면을 열 때 호출) */
  ensureFresh: () => void;
  /** 등록·삭제 성공 후: 모든 월을 무효로 하고 지금 월을 즉시 다시 읽는다 */
  invalidate: () => Promise<void>;
}

const SalesDataContext = createContext<SalesDataContextValue | null>(null);

type FetchResult =
  | { ok: true; data: SalesData; sheets: string[] }
  | { ok: false; message: string; sheets: string[] };

async function fetchSales(sheet: string): Promise<FetchResult> {
  try {
    const url = sheet
      ? `${SALES_LIST_ENDPOINT}?sheet=${encodeURIComponent(sheet)}`
      : SALES_LIST_ENDPOINT;
    const response = await fetch(url, { cache: "no-store" });
    const body = await response.json();
    const sheets: string[] = Array.isArray(body?.sheets) ? body.sheets : [];
    if (body?.ok === true && Array.isArray(body.sales)) {
      return {
        ok: true,
        data: { sheet: body.sheet, sales: body.sales },
        sheets,
      };
    }
    return {
      ok: false,
      message: body?.message || "판매내역을 불러오지 못했습니다.",
      sheets,
    };
  } catch {
    return {
      ok: false,
      message:
        "서버와 통신하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
      sheets: [],
    };
  }
}

export function SalesDataProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, MonthEntry>>({});
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);

  const entriesRef = useRef(entries);
  const selectedRef = useRef(selectedSheet);
  useEffect(() => {
    entriesRef.current = entries;
    selectedRef.current = selectedSheet;
  }, [entries, selectedSheet]);

  // 세대 번호: 무효화하면 올라가고, 이전 세대에 시작한 조회 결과는 버린다
  const generationRef = useRef(0);
  const inflightRef = useRef(
    new Map<string, { generation: number; promise: Promise<void> }>(),
  );
  const staleRef = useRef(new Set<string>());

  const patch = (key: string, update: Partial<MonthEntry>) =>
    setEntries((all) => ({
      ...all,
      [key]: { ...(all[key] ?? EMPTY_ENTRY), ...update },
    }));

  const load = useCallback((key: string): Promise<void> => {
    const generation = generationRef.current;
    const inflight = inflightRef.current.get(key);
    // 같은 세대·같은 월의 조회가 이미 진행 중이면 그 결과를 함께 기다린다 (중복 호출 방지)
    if (inflight?.generation === generation) return inflight.promise;

    patch(key, { loading: true });
    const promise = fetchSales(key).then((result) => {
      if (generation !== generationRef.current) return; // 그사이 무효화됨 → 버림
      inflightRef.current.delete(key);
      if (result.sheets.length > 0) setSheets(result.sheets);
      if (result.ok) {
        const sheetName = result.data.sheet;
        staleRef.current.delete(key);
        staleRef.current.delete(sheetName);
        const entry: MonthEntry = {
          data: result.data,
          error: null,
          loading: false,
          fetchedAt: Date.now(),
        };
        setEntries((all) => ({ ...all, [key]: entry, [sheetName]: entry }));
        // 처음(이번 달) 조회였다면 실제 시트 이름을 선택한 월로 기억한다
        if (key === CURRENT && selectedRef.current === null) {
          setSelectedSheet(sheetName);
        }
      } else {
        // 실패해도 이전 데이터는 남겨 두되, 오류를 함께 보여준다
        patch(key, { error: result.message, loading: false });
      }
    });
    inflightRef.current.set(key, { generation, promise });
    return promise;
  }, []);

  const currentKey = selectedSheet ?? CURRENT;

  const refresh = useCallback(
    () => load(selectedRef.current ?? CURRENT),
    [load],
  );

  const ensureFresh = useCallback(() => {
    const key = selectedRef.current ?? CURRENT;
    const entry = entriesRef.current[key];
    const old = !entry?.fetchedAt || Date.now() - entry.fetchedAt > STALE_MS;
    if (!entry?.data || old || staleRef.current.has(key)) void load(key);
  }, [load]);

  const selectSheet = useCallback(
    (sheet: string) => {
      selectedRef.current = sheet;
      setSelectedSheet(sheet);
      const entry = entriesRef.current[sheet];
      const old = !entry?.fetchedAt || Date.now() - entry.fetchedAt > STALE_MS;
      if (!entry?.data || old || staleRef.current.has(sheet)) void load(sheet);
    },
    [load],
  );

  const invalidate = useCallback(() => {
    generationRef.current += 1;
    inflightRef.current.clear();
    // 모든 월을 오래된 것으로 표시하고, 지금 보고 있는 월은 즉시 다시 읽는다
    for (const key of Object.keys(entriesRef.current))
      staleRef.current.add(key);
    return load(selectedRef.current ?? CURRENT);
  }, [load]);

  // 다른 창·탭에 갔다가 돌아오면 오래된 데이터인지 확인한다
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        const entry = entriesRef.current[selectedRef.current ?? CURRENT];
        if (entry?.data) ensureFresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ensureFresh]);

  const entry = entries[currentKey] ?? EMPTY_ENTRY;
  const value = useMemo(
    () => ({
      ...entry,
      selectedSheet,
      sheets,
      selectSheet,
      refresh,
      ensureFresh,
      invalidate,
    }),
    [
      entry,
      selectedSheet,
      sheets,
      selectSheet,
      refresh,
      ensureFresh,
      invalidate,
    ],
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
  const { ensureFresh, selectedSheet } = value;
  useEffect(() => {
    ensureFresh();
  }, [ensureFresh, selectedSheet]);
  return value;
}
