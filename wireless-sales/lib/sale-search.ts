import { maskName } from "@/lib/privacy-mask";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 검수관리 검색: 고객명·CTN·직원명에 입력한 글자가 들어 있으면 찾는다 (일부만 입력해도 됨).
 * CTN 은 하이픈·공백을 빼고 숫자끼리 비교한다 (예: "1234", "010-1234", "01012").
 * 개인정보: 화면의 고객명·CTN 은 마스킹 값(김수*, 010-12**-*678)이다.
 *   - 전체 이름(김수현)을 입력하면 마스킹한 이름(김수*)과 같은 판매를 찾는다.
 *   - 번호는 가려진 자리(*)를 아무 숫자로 보고 맞춰 본다 (예: "5678", "010-1234-5678" → 010-12**-*678).
 *     가려진 자리 때문에 마스킹이 같은 다른 고객도 함께 나올 수 있다 (화면에서 확인).
 */
function ctnMatches(maskedCtn: string, digits: string): boolean {
  const pattern = maskedCtn.replace(/[^\d*]/g, "");
  if (!pattern || digits.length > pattern.length) return false;
  for (let start = 0; start + digits.length <= pattern.length; start++) {
    let ok = true;
    for (let i = 0; i < digits.length && ok; i++) {
      const c = pattern[start + i];
      ok = c === "*" || c === digits[i];
    }
    if (ok) return true;
  }
  return false;
}

export function matchesSaleSearch(sale: SheetSale, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const compact = q.replace(/\s+/g, "");
  const customer = sale.customer.toLowerCase().replace(/\s+/g, "");
  if (customer.includes(compact)) return true;
  // 전체 이름 입력 → 마스킹 이름끼리 비교
  if (compact.length >= 2 && customer.includes("*") && maskName(compact) === customer) return true;
  if (sale.staff.toLowerCase().replace(/\s+/g, "").includes(compact)) {
    return true;
  }
  const digits = q.replace(/\D/g, "");
  // 숫자·하이픈·공백만 입력했을 때만 CTN 으로 찾는다
  return digits.length > 0 && /^[\d\s-]+$/.test(q) && ctnMatches(sale.ctn, digits);
}
