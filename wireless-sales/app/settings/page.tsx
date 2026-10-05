import { redirect } from "next/navigation";

/* 예전 "설정" 메뉴 주소 → 실력지표(예전 고객조회)로 옮겼다 (예전 링크·즐겨찾기 유지) */
export default function SettingsPage() {
  redirect("/customer");
}
