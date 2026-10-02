import type { Sale } from "@/lib/types";

/**
 * 임시 판매 데이터.
 * Google 스프레드시트 연결 전까지 화면 확인용으로만 사용한다.
 * 화면에 항상 "이번 달" 데이터가 보이도록 개통일은 이번 달 기준으로 만든다.
 */
export function createMockSales(today: string): Sale[] {
  const month = today.slice(0, 7);
  const todayDay = Number(today.slice(8, 10));
  const day = (d: number) =>
    `${month}-${String(Math.min(d, todayDay)).padStart(2, "0")}`;

  return [
    {
      id: "S-001",
      activatedAt: day(1),
      customer: "김민수",
      ctn: "01012345678",
      category: "신규",
      model: "갤럭시 S25",
      plan: "5G 심플 110GB",
      staff: "박정훈",
      securedAmount: 850000,
      usedAmount: 420000,
    },
    {
      id: "S-002",
      activatedAt: day(1),
      customer: "박서연",
      ctn: "01023456789",
      category: "번호이동",
      model: "아이폰 16 Pro",
      plan: "5G 초이스 스페셜",
      staff: "윤원정",
      securedAmount: 1200000,
      usedAmount: 980000,
    },
    {
      id: "S-003",
      activatedAt: day(2),
      customer: "정우진",
      ctn: "01034567890",
      category: "기기변경",
      model: "갤럭시 Z 플립7",
      plan: "5G 베이직",
      staff: "박건우",
      securedAmount: 640000,
      usedAmount: 300000,
    },
    {
      id: "S-004",
      activatedAt: day(3),
      customer: "한지민",
      ctn: "01045678901",
      category: "번호이동",
      model: "아이폰 16",
      plan: "5G 슬림 21GB",
      staff: "박세희",
      securedAmount: 900000,
      usedAmount: 750000,
    },
    {
      id: "S-005",
      activatedAt: day(4),
      customer: "오세훈",
      ctn: "01056789012",
      category: "신규",
      model: "갤럭시 A36",
      plan: "LTE 데이터ON 톡",
      staff: "오다은",
      securedAmount: 350000,
      usedAmount: 120000,
    },
  ];
}
