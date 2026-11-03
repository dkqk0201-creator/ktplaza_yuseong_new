# 무선 판매관리 웹앱 회귀 테스트 (가짜 데이터 전용)

실제 구글시트·Apps Script·고객정보에 **연결하지 않는** 회귀 테스트 묶음입니다.

- 웹앱 서버 코드(`wireless-sales/app/api/...` route handler)를 그대로 부르고,
- Apps Script 호출은 **실제 `.gs` 파일을 가짜 스프레드시트 위에서 실행**해 처리합니다 (`harness/gas.ts`, `harness/fake-spreadsheet.ts`).
- 고객은 모두 가짜(`harness/fake-people.ts`, 010-0000-xxxx 대역)입니다.
- Next.js 앱 폴더 밖에 있어 운영 빌드·배포에는 포함되지 않습니다. 설치할 패키지도 없습니다 (Node 22).

## 실행

```bash
./run.sh                                   # 전체
./run.sh tests/02-update-delete.test.ts     # 일부
WS_ROOT=/다른/wireless-sales ./run.sh        # 다른 버전(예: 수정 전 main 사본)을 같은 테스트로
TEST_NOW=2026-11-03T12:00:00+09:00 ./run.sh  # 시계 (기본 2026-10-13 12:00 KST → 10월 시트)
```

## 구성

| 파일 | 내용 |
|---|---|
| `01-save` | 간편등록 저장: 열 위치, N·U·AB·AC 행 수식, 8행 합계, 개통일 정렬, No.(UMNP 빈칸), 입력 오류, 중복 검사 키(마스킹 CTN), 웹앱참고 저장(판매 ID 키) |
| `02-update-delete` | 판매 수정(바꾼 칸만, 그사이 변경 거부, 판매 확인 — 판매 ID 포함, B·C·수식 칸 거부 — 웹앱·Apps Script 각각), 고객명·CTN 변경 시 참고내용 유지, 삭제·삭제 거부 |
| `03-cell-notes` | 셀 메모: O열·B열(판매 ID) 메모가 정렬 때 판매를 따라감, 새 판매·삭제 때 남은 메모 정리, 행 복사 = ID 중복 표시 |
| `04-status-review` | 검수(G)·수납(H)·카드실적(AG) 완료 — 그 칸만, 거부 조건 / 보완 요청 저장·취소·검수완료 시 닫힘·고객명 변경 시 이동·삭제 시 보관 |
| `05-notes-link` | 참고내용 연결: 판매 ID 없는 복사 행 거부, 같은 고객·같은 날 재등록해도 덮어쓰지 않음 |
| `06-privacy-baseline` | 전체 흐름 뒤 로그·시트·응답·안내문에 원본 없음 |
| `07-budget-other` | 예산관리 카드 = 장표 8행 합계, 카드별 목록 합계, 고불비 |
| `09-privacy-spec` | 마스킹·판매 ID 요구사항 기대 동작 S1~S14 (구현 전 todo → 구현 후 통과) |
| `10-sale-id` | 판매 ID·마스킹 충돌 집중: 정렬·오래된 화면·삭제 후 재등록·중복·분실·충돌·기존 판매 ID 부여, 일부 파일만 배포 시 차단, 웹앱·Apps Script 마스킹 각각 단독 확인 |
| `compare/aggregates.compare.ts` | (자동 실행 안 함) 수정 전·후 코드로 같은 시나리오를 돌려 예산·실적·검수 건수 등 집계 JSON 비교 |

마스킹·판매 ID 구현 때 의도적으로 바뀐 기대값은 각 파일 맨 위 주석에 "[… 기대값 변경]" 으로 적어 두었습니다 (수정 전에는 원본 저장·B열 메모가 자리에 남음 등을 기록했던 테스트).

집계 비교:
```bash
WS_ROOT=/수정전/wireless-sales COMPARE_OUT=/tmp/before.json ./run.sh compare/aggregates.compare.ts
COMPARE_OUT=/tmp/after.json ./run.sh compare/aggregates.compare.ts
diff /tmp/before.json /tmp/after.json   # 같아야 함
```

## 하네스가 흉내 내는 것 / 못 하는 것

- 흉내: 값·수식(=SUM, =N 계산)·셀 메모·글자 서식(@)·사용자 입력 해석(' 접두어, 숫자, 날짜, = 수식)·시트 추가·숨김·행 삭제·잠금·스크립트 속성
- 못 함: 실제 구글 시트의 동시 편집, 사용자가 시트에서 직접 하는 정렬·잘라내기(테스트에서는 셀을 직접 옮겨 흉내), Apps Script 실행 시간·할당량, 운영 `doPost`(저장소에 없음 — 운영과 같은 순서로 흉내)
