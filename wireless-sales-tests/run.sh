#!/usr/bin/env bash
# 무선 판매관리 웹앱 회귀 테스트 (가짜 데이터·가짜 스프레드시트만 사용 — 실제 구글시트·Apps Script 에 연결하지 않음)
#   ./run.sh                 전체
#   ./run.sh tests/02-*.ts   일부
#   WS_ROOT=/path/to/wireless-sales ./run.sh   다른 버전(예: 수정 전 main 사본)을 같은 테스트로 비교
#   TEST_NOW=2026-11-03T12:00:00+09:00 ./run.sh   시계 (기본 2026-10-13 12:00 KST, 10월 시트 기준)
set -euo pipefail
cd "$(dirname "$0")"
files=("$@"); [ ${#files[@]} -eq 0 ] && files=(tests/*.test.ts)
exec node --experimental-transform-types --no-warnings \
  --import ./harness/clock.mjs --import ./harness/register.mjs \
  --test --test-concurrency=1 "${files[@]}"
