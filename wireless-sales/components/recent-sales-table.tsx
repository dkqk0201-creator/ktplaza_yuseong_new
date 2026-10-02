import { CategoryBadge } from "@/components/category-badge";
import { formatWon } from "@/lib/format";
import { amountText, dateText, maskedCtn, sumAmount } from "@/lib/sale-display";
import type { SheetSale } from "@/lib/sheet-record";

/* 대시보드 최근 판매 내역: 장표(이번 달 시트)에서 읽은 값을 그대로 보여준다 */

const th =
  "px-3 py-3 text-left text-xs font-semibold whitespace-nowrap text-ink-sub";
const td = "px-3 py-3.5 whitespace-nowrap";

export function RecentSalesTable({ sales }: { sales: SheetSale[] }) {
  const securedTotal = sumAmount(sales, (s) => s.securedTotal);
  const usedTotal = sumAmount(sales, (s) => s.usedTotal);

  if (sales.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-white px-6 py-12 text-center text-sm text-ink-sub">
        등록된 판매 내역이 없습니다.
      </div>
    );
  }

  return (
    <>
      {/* PC·태블릿: 표 */}
      <div className="hidden overflow-x-auto rounded-xl border border-line bg-white md:block">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="border-b border-line bg-zinc-50">
            <tr>
              <th className={`${th} w-14 text-center`}>No.</th>
              <th className={th}>개통일</th>
              <th className={th}>고객</th>
              <th className={th}>CTN</th>
              <th className={th}>구분</th>
              <th className={th}>모델명</th>
              <th className={th}>요금제</th>
              <th className={th}>직원명</th>
              <th className={`${th} text-right`}>총 확보금액</th>
              <th className={`${th} text-right`}>총 사용금액</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sales.map((sale) => (
              <tr key={sale.row} className="hover:bg-zinc-50/70">
                <td className={`${td} text-center text-ink-muted tabular-nums`}>
                  {sale.no || "-"}
                </td>
                <td className={`${td} text-ink-sub tabular-nums`}>
                  {dateText(sale.activatedAt)}
                </td>
                <td className={`${td} font-medium text-ink`}>
                  {sale.customer || "-"}
                </td>
                <td className={`${td} text-ink-sub tabular-nums`}>
                  {sale.ctn ? maskedCtn(sale.ctn) : "-"}
                </td>
                <td className={td}>
                  <CategoryBadge category={sale.category} />
                </td>
                <td className={`${td} text-ink`}>{sale.model || "-"}</td>
                <td className={`${td} text-ink-sub`}>{sale.plan || "-"}</td>
                <td className={`${td} text-ink`}>{sale.staff || "-"}</td>
                <td
                  className={`${td} text-right font-semibold text-ink tabular-nums`}
                >
                  {amountText(sale.securedTotal)}
                </td>
                <td
                  className={`${td} text-right font-semibold text-ink tabular-nums`}
                >
                  {amountText(sale.usedTotal)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line bg-zinc-50">
            <tr>
              <td colSpan={8} className={`${td} font-semibold text-ink`}>
                합계 ({sales.length}건)
              </td>
              <td
                className={`${td} text-right font-bold text-ink tabular-nums`}
              >
                {formatWon(securedTotal)}
              </td>
              <td
                className={`${td} text-right font-bold text-ink tabular-nums`}
              >
                {formatWon(usedTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 모바일: 카드 목록 */}
      <ul className="space-y-3 md:hidden">
        {sales.map((sale) => (
          <li
            key={sale.row}
            className="rounded-xl border border-line bg-white p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-muted tabular-nums">
                  No.{sale.no}
                </span>
                <CategoryBadge category={sale.category} />
              </div>
              <span className="text-xs text-ink-sub tabular-nums">
                {dateText(sale.activatedAt)}
              </span>
            </div>

            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span className="text-base font-semibold text-ink">
                {sale.customer || "-"}
              </span>
              <span className="text-sm text-ink-sub tabular-nums">
                {sale.ctn ? maskedCtn(sale.ctn) : "-"}
              </span>
            </div>

            <dl className="mt-3 grid grid-cols-[4.5rem_1fr] gap-y-1.5 text-sm">
              <dt className="text-ink-muted">모델명</dt>
              <dd className="text-ink">{sale.model || "-"}</dd>
              <dt className="text-ink-muted">요금제</dt>
              <dd className="text-ink">{sale.plan || "-"}</dd>
              <dt className="text-ink-muted">직원명</dt>
              <dd className="text-ink">{sale.staff || "-"}</dd>
            </dl>

            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3">
              <div>
                <p className="text-xs text-ink-muted">총 확보금액</p>
                <p className="mt-0.5 font-semibold text-ink tabular-nums">
                  {amountText(sale.securedTotal)}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">총 사용금액</p>
                <p className="mt-0.5 font-semibold text-ink tabular-nums">
                  {amountText(sale.usedTotal)}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
