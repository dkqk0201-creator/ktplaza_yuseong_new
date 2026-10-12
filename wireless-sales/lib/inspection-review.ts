import { formatCtn } from "@/lib/format";
import { isO, type SheetSale } from "@/lib/sheet-record";

/*
 * 검수 보완 요청 (검수관리 판매 상세).
 * - 미비내용·상태·이력은 장표가 아니라 Apps Script 숨김 보조 시트 "검수보완" 에 보관
 *   (판매 연결 키 = 월 시트 | 개통일 | CTN | 고객명 → 날짜 정렬·No. 변경에도 다른 고객에 안 붙음)
 * - 상태: 요청중 → 검수완료(G열 O 저장 시 Apps Script 가 자동으로 닫음) / 취소 / 판매삭제
 * - 보완 요청 중이어도 G열은 그대로 (검수 미완료 집계에 계속 포함)
 */

export const REVIEW_MAX = 1000;

export interface ReviewActive {
  content: string;
  staff: string;
  requestedAt: string;
  updatedAt: string;
}

export interface ReviewHistoryItem {
  /** 검수완료 / 취소 / 판매삭제 */
  status: string;
  content: string;
  staff: string;
  requestedAt: string;
  closedAt: string;
}

export interface SaleReview {
  active: ReviewActive | null;
  history: ReviewHistoryItem[];
}

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.slice(0, max) : "";

/** Apps Script 응답 → 보완 기록 (형식이 이상하면 undefined) */
export function parseReview(value: unknown): SaleReview | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  let active: ReviewActive | null = null;
  if (typeof raw.active === "object" && raw.active !== null) {
    const a = raw.active as Record<string, unknown>;
    const content = str(a.content, REVIEW_MAX + 100).trim();
    if (content) {
      active = {
        content,
        staff: str(a.staff, 50),
        requestedAt: str(a.requestedAt, 30),
        updatedAt: str(a.updatedAt, 30),
      };
    }
  }
  const history: ReviewHistoryItem[] = Array.isArray(raw.history)
    ? raw.history
        .filter((h): h is Record<string, unknown> => typeof h === "object" && h !== null)
        .slice(0, 20)
        .map((h) => ({
          status: str(h.status, 20),
          content: str(h.content, REVIEW_MAX + 100),
          staff: str(h.staff, 50),
          requestedAt: str(h.requestedAt, 30),
          closedAt: str(h.closedAt, 30),
        }))
    : [];
  if (!active && history.length === 0) return undefined;
  return { active, history };
}

/** 보완 요청 중: 진행 중 요청이 있고 아직 G열 검수가 O 가 아닌 판매 */
export function isReviewPending(sale: Pick<SheetSale, "review" | "inspected">): boolean {
  return !!sale.review?.active && !isO(sale.inspected);
}

/** 직원 전달내용 (카카오톡 등에 붙여넣기용). 자동 발송은 하지 않는다 */
export function reviewMessage(
  sale: Pick<SheetSale, "customer" | "ctn" | "staff">,
  content: string,
): string {
  return [
    "[검수 보완 요청]",
    `고객명 : ${sale.customer || "-"}`,
    `CTN : ${sale.ctn ? formatCtn(sale.ctn) : "-"}`,
    `판매자 : ${sale.staff || "-"}`,
    "",
    "미비내용",
    content.trim() || "-",
    "",
    "보완 후 회신 부탁드립니다.",
  ].join("\n");
}

export function reviewContentError(content: string): string | null {
  const t = content.trim();
  if (!t) return "미비내용을 입력해 주세요.";
  if (t.length > REVIEW_MAX) return `미비내용은 ${REVIEW_MAX}자까지 입력할 수 있습니다.`;
  return null;
}
