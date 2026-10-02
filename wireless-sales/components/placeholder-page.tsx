import { PageHeader } from "./page-header";

export function PlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-line bg-white px-6 py-16 text-center">
        <p className="text-base font-semibold text-ink">준비 중인 화면입니다</p>
        <p className="mt-1 text-sm text-ink-sub">
          다음 단계에서 이 화면의 기능을 추가할 예정입니다.
        </p>
      </div>
    </>
  );
}
