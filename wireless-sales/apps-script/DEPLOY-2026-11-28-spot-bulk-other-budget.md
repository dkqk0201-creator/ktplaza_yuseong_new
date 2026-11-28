# 2026-11-28 스팟 일괄등록 · 기타 예산 — 반영 안내

브랜치: `feature/spot-bulk-other-budget` (main 97d1daf 기준). **운영 배포는 별도 승인 후.**

## 바뀌는 파일

| 구분 | 파일 | 내용 |
|---|---|---|
| Apps Script (새 파일) | `apps-script/spot-bulk.gs` | 스팟 일괄등록: O열 값(숫자)·O열 메모 줄 추가, 저장 직전 재검증, 이력 시트 `스팟일괄등록이력`, 되돌리기 |
| Apps Script (새 파일) | `apps-script/other-budget.gs` | 기타 예산: 별도 시트 `기타예산내역`·`기타예산변경이력` |
| Apps Script (교체) | `apps-script/update-handler.gs` | 입구에 `spot-bulk`·`other-budget` 두 줄 추가만 (doPost 수정 불필요) |
| TEST 전용 (교체) | `apps-script-test/test-entry.gs` | 필수 파일 목록에 새 두 파일 추가 (버전 2) — **TEST 프로젝트에만** |
| 분석데이터 (새 파일) | `analysis-apps-script/other-budget-tab.gs` | AI 분석 스프레드시트에 `기타예산` 탭 (기존 직원별예산 탭 그대로) |
| 분석데이터 (Code.gs 4곳) | 분석 프로젝트 `Code.gs` (저장소 밖) | VERSION C-1.1.0 · AI_TABS 에 '기타예산' · aiReadWireless_ 반환에 extras · builders 에 '기타예산' · 읽는법 '기타 예산' 한 줄 |
| 웹앱 | `lib/spot-bulk.ts`, `lib/spot-bulk-api.ts`, `lib/server/spot-bulk.ts`, `app/api/spot/bulk/route.ts`, `components/spot-bulk-panel.tsx`, `components/spot-view.tsx`, `app/spot/page.tsx` | 스팟관리 화면 안 [스팟 일괄등록] |
| 웹앱 | `lib/other-budget.ts`, `lib/other-budget-api.ts`, `lib/server/other-budget.ts`, `app/api/budget/other/route.ts`, `components/other-budget-panel.tsx`, `components/budget-view.tsx` | 예산관리 화면 안 [기타 예산] + 최종 매장 총예산 |
| 웹앱 | `lib/server/apps-script.ts` | `postToAppsScript`·`shortText` export 만 (동작 변경 없음) |
| 테스트 | `wireless-sales-tests/tests/22·23·24`, `12-auth`(새 API 2개 등록), `harness/gas.ts` | 가짜 데이터 전용 |

장표(월 시트) 열·수식은 바꾸지 않습니다. 새 시트 3개(`스팟일괄등록이력`, `기타예산내역`, `기타예산변경이력`)는 첫 저장 때 자동 생성됩니다.

## TEST 반영 순서 (테스트 전용 독립 프로젝트 `무선장표_인증테스트_전용`)

1. 파일 추가: `spot-bulk.gs`, `other-budget.gs` (전체 붙여넣기)
2. 파일 교체: `update-handler.gs`, `test-entry.gs`
3. 편집기에서 `wsTestSelfCheck` ▶ 실행 → 로그 3줄 모두 정상인지 확인 (새 파일이 빠지면 "빠진 파일" 으로 거부됨)
4. 배포 → 배포 관리 → 기존 웹앱 배포 수정 → 새 버전 (URL 그대로)
5. Vercel Preview(이 브랜치)의 `APPS_SCRIPT_URL` 이 TEST 프로젝트 주소인지 확인한 뒤 화면 저장 테스트

## 운영 반영 순서 (승인 후)

1. 운영 Apps Script(`무선장표 웹앱 테스트` 이름의 실제 운영 프로젝트)에 `spot-bulk.gs`·`other-budget.gs` 추가, `update-handler.gs` 교체 (**test-entry.gs 는 넣지 않음**) → 새 버전 배포
2. GitHub main 병합 → Vercel 운영 배포
3. 저장 없이 화면 확인 (스팟관리 일괄등록 조회·예산관리 기타 예산 조회)
4. 분석데이터 운영 프로젝트에 `other-budget-tab.gs` 추가 + 기존 갱신 함수 끝에 한 줄 호출 (트리거 추가 없음)

예전 Apps Script 와 새 웹앱이 섞여도 안전: 웹앱이 `handler` 표시를 확인해 "배포 안 됨" 으로 안내하고 아무것도 쓰지 않습니다.

## 복구

- 웹앱: Vercel 이전 배포로 Promote
- Apps Script: 이전 버전으로 배포 되돌리기. 새로 생긴 시트 3개는 남겨도 기존 기능에 영향 없음
- 스팟 일괄등록 자체는 화면 [최근 일괄등록 이력 → 되돌리기] 로 변경 전 O열 금액·메모 복구

## TEST 결과 (2026-11-28, 실제 TEST 환경)

| 항목 | 결과 |
|---|---|
| TEST 프로젝트 반영 | 바꾸기 전 13개 파일이 main 과 동일함 확인 → 새 2개 추가·2개 교체 → 저장 후 다시 열어 4개 파일 해시가 저장소와 동일 → `wsTestSelfCheck` 정상 → 배포 버전 5 (URL 그대로) |
| Preview → TEST 연결 | Preview 조회 결과가 TEST 장표(11월 시트만, 10행)와 일치. 운영 장표(10월·11월)와 다름 |
| 스팟 일괄등록 | 조건 2개(11/1~30 테스트폰 스팟1 3만, 11/1~10 전체 스팟2 5만) → 3건 110,000원 저장 · O열 숫자 50000/30000/30000 · 메모 "스팟2 5만"/"스팟1 3만" · N·AC 수식 그대로 · 스팟별 집계·예산관리 스팟예산 110,000 반영 |
| 중복·충돌·보호 | 다시 조회 시 3건 모두 "이미 같은 스팟 등록" 제외 · 조건 겹침 2건 충돌 표시(기본 미적용) · 기존 스팟 판매 명시 승인 → O 50,000→100,000, 메모 기존 줄 보존 + 추가 |
| 이력·되돌리기 | 이력 시트에 변경 전/후 O열·메모 기록(고객정보 없음) · 되돌리기로 O 50,000·메모 "스팟2 5만" 복구 |
| 기타 예산 | 확보 300,000 등록 → 최종 268,207 · 차감 50,000 → 218,207 · 수정 70,000 → 198,207 · 삭제 → 268,207 · 복구 → 198,207 · 변경이력 5줄 · AC 검증 "기존 매장 총예산과 일치" 유지 |
| 로그인 없는 요청 | 로그인 화면으로 돌려보내짐, 시트에 기록 없음 |
| AI 분석 TEST | 수동 갱신 정상(모든 탭 정상, C-1.1.0) · 기타예산 탭 = 웹앱(-31,793 / +300,000 / −70,000 / 최종 198,207) · 직원별예산 탭 구조 그대로 |

TEST 장표에 남은 시험 데이터: 11월 8·9·10번 판매 O열 스팟(합계 110,000)과 메모, `스팟일괄등록이력`, `기타예산내역`(TEST 항목 2건), `기타예산변경이력` — 모두 TEST 장표에만 있음.
