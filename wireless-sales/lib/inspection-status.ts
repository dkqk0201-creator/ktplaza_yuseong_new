import { isO, type SheetSale } from "@/lib/sheet-record";

/*
 * 검수관리 상태 (G열 검수 · H열 수납, 둘 다 O 여야 완료). 화면(components/inspection-view.tsx)과 테스트가 함께 쓴다.
 */

export type InspectionFilter = "pending" | "all" | "inspect" | "paid" | "both" | "done";

export type InspectionStatus = "done" | "inspect" | "paid" | "both";

export function inspectionStatus(sale: SheetSale): InspectionStatus {
  const inspected = isO(sale.inspected);
  const paid = isO(sale.paid);
  if (inspected && paid) return "done";
  if (!inspected && !paid) return "both";
  return inspected ? "paid" : "inspect";
}

export function matchFilter(status: InspectionStatus, filter: InspectionFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "pending":
      return status !== "done";
    case "inspect": // 검수가 O 가 아닌 모든 건 (둘 다 미완료 포함)
      return status === "inspect" || status === "both";
    case "paid": // 수납이 O 가 아닌 모든 건 (둘 다 미완료 포함)
      return status === "paid" || status === "both";
    case "both":
      return status === "both";
    case "done":
      return status === "done";
  }
}

