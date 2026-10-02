const numberFormatter = new Intl.NumberFormat("ko-KR");

/** 1000000 → "1,000,000원" */
export function formatWon(amount: number): string {
  return `${numberFormatter.format(amount)}원`;
}

/** 1234 → "1,234" */
export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/** "01012345678" → "010-1234-5678" (형식이 맞지 않으면 원본 반환) */
export function formatCtn(ctn: string): string {
  const digits = ctn.replace(/\D/g, "");
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return ctn;
}

/** 입력 중인 휴대폰번호에 하이픈 자동 삽입: "0101234" → "010-1234" */
export function formatCtnInput(digits: string): string {
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  // 010이 아닌 10자리 번호(예: 011-123-4567)만 3-3-4로 나눈다
  if (digits.length === 10 && !digits.startsWith("010")) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
}

/** "2026-10-02" → "2026.10.02" */
export function formatDate(date: string): string {
  return date.replaceAll("-", ".");
}

/** 한국 시간 기준 오늘 날짜 (YYYY-MM-DD) */
export function todayInKorea(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
