import { dateText } from "@/lib/sale-display";
import { formatCtn } from "@/lib/format";

/*
 * 충청관리(스팟관리) 고객 목록의 부가서비스 검수 (2026-11-29, 읽기 전용).
 *
 * 저장 위치: 월별 장표 AI열 "부가" (머리글 2줄째 "필L/필S", lib/sheet-columns.ts key "addon").
 *   카톡 간편등록(lib/quick-report.ts)은 부가 칸을 필L / 필S 로만 받고, 비어 있으면 X 로 저장한다.
 *   운영 장표 10월·11월 실제 값: 필L · 필S · X · 빈칸 뿐 (2026-11-29 읽기 전용 확인).
 *
 * 판정 (장표에 "기록됐는지"만 본다 — 통신사 실제 가입 완료 여부는 판정하지 않음):
 *   입력됨   = 필L, 필S (대소문자·공백 무시, "필L/필S"처럼 여러 개를 , / + · & 공백으로 나눠 적은 것도 포함)
 *   미입력   = 빈칸, X, - (간편등록이 비어 있을 때 저장하는 값과 같은 뜻)
 *   확인 필요 = 그 외 글자(예: 메모·다른 부가 이름), 값을 읽지 못한 경우 → 미입력으로 단정하지 않음
 * 이 판정은 화면 표시와 카톡 문구 복사에만 쓰며, 장표·충청예산 금액을 바꾸지 않는다.
 */

export type AddonState = "entered" | "missing" | "unclear";

export interface AddonCheck {
  state: AddonState;
  /** 입력됨일 때 부가서비스 명칭 (장표에 적힌 순서, 중복 제거) */
  names: string[];
  /** 장표에 적힌 원래 값 (앞뒤 공백 제거) */
  raw: string;
}

const KNOWN = new Map([
  ["필L", "필L"],
  ["필S", "필S"],
]);
const MISSING = new Set(["", "X", "-"]);

export function checkAddon(value: unknown): AddonCheck {
  if (value !== undefined && value !== null && typeof value !== "string") {
    return { state: "unclear", names: [], raw: String(value) };
  }
  if (value === undefined || value === null) return { state: "unclear", names: [], raw: "" };
  const raw = value.trim();
  const compact = raw.replace(/\s+/g, "").toUpperCase().replace(/^'/, "");
  if (MISSING.has(compact)) return { state: "missing", names: [], raw };
  const tokens = raw
    .toUpperCase()
    .split(/[,/+·&\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const names: string[] = [];
  for (const t of tokens) {
    const name = KNOWN.get(t);
    if (!name) return { state: "unclear", names: [], raw };
    if (!names.includes(name)) names.push(name);
  }
  return names.length > 0 ? { state: "entered", names, raw } : { state: "unclear", names: [], raw };
}

export const ADDON_STATE_LABEL: Record<AddonState, string> = {
  entered: "입력됨",
  missing: "미입력",
  unclear: "확인 필요",
};

export interface AddonMessageSale {
  activatedAt: string;
  customer: string;
  ctn: string;
  staff: string;
}

/** 장표에 값이 없으면 지어내지 않고 "장표 미기재" 로 적는다 */
const orBlank = (v: string) => (v.trim() ? v.trim() : "장표 미기재");

/**
 * 카톡용 복사 문구 (2026-11-29 수정: 판매 No. 대신 그 판매의 CTN).
 * 문구는 화면에서 클립보드로만 복사하며 서버·로그·이력에 저장하지 않는다.
 * missing → 부가서비스 넣어 달라는 문구 / unclear → 등록 여부 확인 요청 문구 / entered → 없음
 */
export function addonMessage(sale: AddonMessageSale, state: AddonState): string | null {
  if (state === "entered") return null;
  const head = [
    `개통일: ${sale.activatedAt.trim() ? dateText(sale.activatedAt.trim()) : "장표 미기재"}`,
    `고객명: ${orBlank(sale.customer)}`,
    `CTN: ${sale.ctn.trim() ? formatCtn(sale.ctn.trim()) : "장표 미기재"}`,
    `담당 직원: ${orBlank(sale.staff)}`,
  ].join("\n");
  const body =
    state === "missing"
      ? "이 고객은 충청예산(스팟)이 걸려 있으니까 부가서비스 넣어야 해. 다 넣고 알려줘."
      : "이 고객은 충청예산(스팟)이 적용되어 있어요. 부가서비스 등록 여부를 확인하고 알려줘.";
  return `${head}\n\n${body}`;
}

/** 통합 조회 한 줄 = 판매 1건 (같은 판매가 여러 번호에 있어도 한 번) */
export interface AddonOverviewItem {
  row: number;
  activatedAt: string;
  customer: string;
  ctn: string;
  staff: string;
  plan: string;
  model: string;
  addon: string;
  check: AddonCheck;
  /** 이 판매가 들어 있는 번호들 (번호 순) */
  spots: { spot: number; label: string; amount: number }[];
  /** 이 판매의 O열 금액 (장표에 적용된 충청·스팟 예산) */
  oAmount: number;
}

export interface AddonOverview {
  missing: AddonOverviewItem[];
  unclear: AddonOverviewItem[];
  enteredCount: number;
  /** 미입력 판매들의 O열 금액 합계 (조회용 — 예산에 더하거나 빼지 않음) */
  missingAmount: number;
  unclearAmount: number;
}

interface OverviewSpot {
  spot: number;
  label: string;
  customers: {
    row: number;
    activatedAt: string;
    customer: string;
    ctn: string;
    staff?: string;
    plan?: string;
    model?: string;
    addon?: string;
    spotAmount?: number;
  }[];
}

/**
 * 부가 미입력 통합 조회: 번호별 고객 목록(= 메모에 충청·스팟 번호가 있는 판매)을 판매(행)별로 합친다.
 * 같은 월 시트 안의 행 번호로만 합치므로 다른 달의 같은 No. 와 섞이지 않는다.
 * oAmountByRow: 그 판매의 O열 금액 (lib/spot.ts checks 의 oAmount)
 */
export function buildAddonOverview(spots: OverviewSpot[], oAmountByRow: Map<number, number>): AddonOverview {
  const byRow = new Map<number, AddonOverviewItem>();
  for (const s of spots) {
    for (const c of s.customers) {
      let item = byRow.get(c.row);
      if (!item) {
        item = {
          row: c.row,
          activatedAt: c.activatedAt,
          customer: c.customer,
          ctn: c.ctn,
          staff: c.staff ?? "",
          plan: c.plan ?? "",
          model: c.model ?? "",
          addon: c.addon ?? "",
          check: checkAddon(c.addon),
          spots: [],
          oAmount: oAmountByRow.get(c.row) ?? 0,
        };
        byRow.set(c.row, item);
      }
      if (!item.spots.some((x) => x.spot === s.spot)) item.spots.push({ spot: s.spot, label: s.label, amount: c.spotAmount ?? 0 });
    }
  }
  const items = [...byRow.values()];
  for (const i of items) i.spots.sort((a, b) => a.spot - b.spot);
  items.sort((a, b) => (a.activatedAt !== b.activatedAt ? (a.activatedAt < b.activatedAt ? -1 : 1) : a.row - b.row));
  const missing = items.filter((i) => i.check.state === "missing");
  const unclear = items.filter((i) => i.check.state === "unclear");
  const sum = (list: AddonOverviewItem[]) => list.reduce((t, i) => t + i.oAmount, 0);
  return {
    missing,
    unclear,
    enteredCount: items.length - missing.length - unclear.length,
    missingAmount: sum(missing),
    unclearAmount: sum(unclear),
  };
}
