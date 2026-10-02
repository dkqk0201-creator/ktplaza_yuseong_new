import { formatCtn } from "@/lib/format";
import {
  calculateTotals,
  toAmount,
  type SaleFormValues,
} from "@/lib/sale-form";
import type { SheetRowValues } from "@/lib/sheet-columns";

/*
 * 판매등록 입력값 → 무선장표 한 행 (A~AL).
 * 열 위치는 lib/sheet-columns.ts 한 곳에서만 정한다. 여기서는 "어느 항목에 어떤 값"만 정한다.
 * 어느 월 시트·행에 저장할지는 Apps Script가 정한다. B열(No.)은 보내지 않는다.
 */
export function buildSheetRow(values: SaleFormValues): SheetRowValues {
  const totals = calculateTotals(values);
  const noJeca = values.jeca === "X";
  const noDongpan = values.dongpan === "X";

  const row: SheetRowValues = {
    customerPromise: values.customerPromise.trim(),
    activatedAt: values.activatedAt,
    customer: values.customer.trim(),
    ctn: formatCtn(values.ctn),
    excludeIndicator: values.excludeIndicator,
    inspected: values.inspected,
    paid: values.paid,
    category: values.category,
    model: values.model.trim(),
    plan: values.plan.trim(),
    planChange: values.planChange,
    staff: values.staff,
    securedTotal: totals.securedTotal,
    spot: toAmount(values.secured.spot),
    securedDicho: toAmount(values.secured.dicho),
    appleMania: toAmount(values.secured.appleMania),
    securedSecond: toAmount(values.secured.second),
    modelPolicy: toAmount(values.secured.modelPolicy),
    customerBenefit: toAmount(values.customerBenefit),
    usedTotal: totals.usedTotal,
    usedModelPlan: toAmount(values.used.modelPlan),
    usedExtraSupport: toAmount(values.used.extraSupport),
    usedDicho: toAmount(values.used.dicho),
    usedSecond: toAmount(values.used.second),
    usedPhoneSale: toAmount(values.usedPhoneSale),
    usedPhoneUsed: toAmount(values.usedPhoneUsed),
    usedPhoneRemaining: totals.usedPhoneRemaining,
    finalTotal: totals.finalTotal,
    secondPerformance: values.secondPerformance,
    // 제카 규칙: X 이면 제카·종류·카드실적 검수 모두 X / O 이면 종류만, 검수 칸은 점장이 장표에서 입력
    jeca: values.jeca,
    cardType: noJeca ? "X" : values.cardType.trim(),
    jecaBudget: toAmount(values.jecaBudget),
    addon: values.addon,
    insurance: values.insurance,
    dongpan: values.dongpan,
    // 동판이 X 이면 가능일도 X
    wiredAvailableDate: noDongpan ? "X" : values.wiredAvailableDate,
  };
  if (noJeca) row.cardChecked = "X";
  return row;
}
