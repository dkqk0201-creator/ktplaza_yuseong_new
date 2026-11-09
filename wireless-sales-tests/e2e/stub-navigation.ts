/* 브라우저 시험용 next/navigation 대역 (주소만 읽음) */
export function usePathname(): string {
  return window.location.pathname;
}
export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}
