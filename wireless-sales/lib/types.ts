/** 개통 구분 */
export type SaleCategory = "신규" | "번호이동" | "기기변경";

/** 판매(개통) 1건. 추후 Google 스프레드시트의 한 행에 대응한다. */
export interface Sale {
  id: string;
  /** 개통일 (YYYY-MM-DD) */
  activatedAt: string;
  /** 고객명 */
  customer: string;
  /** 고객 CTN, 숫자만 저장 (예: 01012345678) */
  ctn: string;
  category: SaleCategory;
  model: string;
  plan: string;
  /** 담당 직원명 */
  staff: string;
  /** 총 확보금액 (원) */
  securedAmount: number;
  /** 총 사용금액 (원) */
  usedAmount: number;
}

/** 대시보드 상단 요약 수치 */
export interface DashboardSummary {
  /** 기준 연월 (YYYY-MM) */
  month: string;
  activationCount: number;
  securedTotal: number;
  usedTotal: number;
  /** 가용가능금액 = 총 확보금액 - 총 사용금액 */
  availableTotal: number;
}
