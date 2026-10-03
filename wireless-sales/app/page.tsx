import { InspectionView } from "@/components/inspection-view";
import { PageHeader } from "@/components/page-header";

/*
 * 검수관리 (첫 화면): 선택한 월의 판매 전체와 검수(G)·수납(H) 상태를 보여준다.
 * 화면 틀은 바로 보여주고, 장표 데이터는 공유 저장소(SalesDataProvider)로 불러온다.
 */
export default function InspectionPage() {
  return (
    <>
      <PageHeader
        title="검수관리"
        description="이번 달 판매 전체의 검수·수납 상태를 확인합니다. 고객명·CTN·직원명으로 검색할 수 있습니다."
      />
      <InspectionView />
    </>
  );
}
