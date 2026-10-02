export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50">
      <header className="bg-brand text-white">
        <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6">
          <h1 className="text-lg font-bold sm:text-xl">무선 판매 관리</h1>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-sm sm:p-8">
          <p className="text-2xl font-bold text-zinc-900 sm:text-3xl">
            무선 판매 관리
          </p>
          <p className="mt-3 text-sm text-zinc-600 sm:text-base">
            기본 프로젝트가 준비되었습니다.
            <br />
            판매 실적 입력 화면은 곧 추가될 예정입니다.
          </p>
        </div>
      </main>
    </div>
  );
}
