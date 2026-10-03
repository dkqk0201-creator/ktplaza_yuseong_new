import type { SheetSale } from "@/lib/sheet-record";

/*
 * 검수관리 검색: 고객명·CTN·직원명에 입력한 글자가 들어 있으면 찾는다 (일부만 입력해도 됨).
 * CTN 은 하이픈·공백을 빼고 숫자끼리 비교한다 (예: "1234", "010-1234", "01012").
 */
export function matchesSaleSearch(sale: SheetSale, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const compact = q.replace(/\s+/g, "");
  if (sale.customer.toLowerCase().replace(/\s+/g, "").includes(compact)) {
    return true;
  }
  if (sale.staff.toLowerCase().replace(/\s+/g, "").includes(compact)) {
    return true;
  }
  const digits = q.replace(/\D/g, "");
  // 숫자·하이픈·공백만 입력했을 때만 CTN 으로 찾는다
  return (
    digits.length > 0 &&
    /^[\d\s-]+$/.test(q) &&
    sale.ctn.replace(/\D/g, "").includes(digits)
  );
}
