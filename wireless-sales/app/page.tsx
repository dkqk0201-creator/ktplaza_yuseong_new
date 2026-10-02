import { InspectionView } from "@/components/inspection-view";
import { PageHeader } from "@/components/page-header";

/*
 * 검수관리 (첫 화면): 장표의 검수(G)·수납(H)이 O 가 아닌 판매를 보여준다.
 * 화면 틀은 바로 보여주고, 장표 데이터는 공유 저장소(SalesDataProvider)로 불러온다.
 */
export default function InspectionPage() {
  return (
    <>
      <PageHeader
        title="검수관리"
        description="검수·수납이 끝나지 않은 판매를 확인합니다. O 입력은 장표에서 직접 해 주세요."
      />
      <InspectionView />
    </>
  );
}
