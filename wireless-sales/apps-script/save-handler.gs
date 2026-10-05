/**
 * 무선 판매 관리 웹앱 — 판매 저장 (A~AL 38칸, Apps Script 의 save-handler.gs 전체를 이 내용으로 교체)
 *
 * 요청 (둘 중 하나):
 *   { secret, action: "save", row: [38칸] }          ← 1건
 *   { secret, action: "save", rows: [[38칸], ...] }  ← 여러 건을 한 번에 (간편등록, 최대 30건)
 *     notes: [{ 항목id: 글자 } | null, ...]          ← (선택) rows 와 같은 순서의 판매보고 참고내용.
 *       장표 A~AL 에는 쓰지 않고 notes.gs 의 숨김 보조 시트 "웹앱참고" 에 판매 건별로 보관한다.
 *   - row[i] 가 null 이면 그 칸은 건드리지 않는다 (간편등록에서 직원이 보내지 않은 칸 = 빈칸 유지).
 *   - B열(No.)은 어떤 값이 와도 절대 쓰지 않는다.
 *   - 수식이 들어 있는 칸은 건너뛴다.
 * 위치: C열 개통일 오름차순 (이번 달 시트 "10월" 등, 9행부터).
 *   - 새 판매는 같은 개통일 판매들의 맨 뒤에 들어가고, 그보다 뒤 날짜 판매들은 한 행씩 아래로 내려간다.
 *   - 같은 개통일끼리는 기존 순서를 유지한다 (안정 정렬). 이미 날짜순이 아니던 행도 함께 날짜순이 된다.
 *   - 판매 1건 = A~AL 한 행 전체(B열 제외)가 함께 움직인다. B열(No.)은 행에 그대로 → 9행=1, 10행=2 …
 *   - 중간에 삭제로 비어 있던 행은 판매 행들 아래로 내려간다.
 *   - 8행(합계)과 그 위는 건드리지 않는다. 값만 옮기며 서식·메모는 행 위치에 그대로 남는다.
 * C열 개통일 표시: 저장할 때마다 9행부터 C열의 "표시 형식"만 mm.dd (예: 10.05) 로 맞춘다.
 *   값은 실제 날짜 그대로라 날짜 정렬·조회·참고내용 연결(yyyy-MM-dd 로 읽음)은 바뀌지 않는다.
 *   - 판매·빈 행에 수식이 있거나 개통일이 날짜가 아닌 판매 행이 있으면 정렬하지 않고
 *     예전 방식(위에서부터 첫 빈 행)으로 저장한다 (응답 sorted: false).
 * LockService 로 한 번에 하나의 저장·삭제만 처리한다.
 * 여러 건 저장은 잠금·열 구조 확인·장표 읽기를 한 번만 해서 1건씩 여러 번 부르는 것보다 훨씬 빠르다.
 * 응답: 1건 → { ok, sheet, row, no } / 여러 건 → { ok: true, sheet, results: [{ ok, row, no } | { ok: false, message }], notesSaved }
 */
var WS_SAVE_BATCH_MAX = 30;

function handleSaveRequest_(e) {
  var body = wsBody_(e);
  if (!body || body.action !== "save") return null;
  if (!wsAuthorized_(body)) {
    return wsJson_({ ok: false, message: "인증에 실패했습니다." });
  }

  var batch = Array.isArray(body.rows);
  var rows = batch ? body.rows : [body.row];
  if (batch && (rows.length === 0 || rows.length > WS_SAVE_BATCH_MAX)) {
    return wsJson_({
      ok: false,
      message: "한 번에 1~" + WS_SAVE_BATCH_MAX + "건까지 저장할 수 있습니다.",
    });
  }
  // 하나라도 형식이 틀리면 아무것도 쓰지 않는다
  for (var r = 0; r < rows.length; r++) {
    if (!Array.isArray(rows[r]) || rows[r].length !== WS_COLUMN_COUNT) {
      return wsJson_({
        ok: false,
        message: "저장할 행이 " + WS_COLUMN_COUNT + "칸(A~AL)이 아닙니다.",
      });
    }
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return wsJson_({
      ok: false,
      message: "다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.",
    });
  }

  try {
    var ss = wsSpreadsheet_();
    var tz = ss.getSpreadsheetTimeZone();
    var sheetName = wsCurrentMonthSheetName_(ss);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return wsJson_({ ok: false, message: sheetName + " 시트를 찾을 수 없습니다." });
    }
    var layoutError = wsLayoutError_(sheet);
    if (layoutError) return layoutError;

    var lastRow = sheet.getLastRow();
    if (lastRow < WS_FIRST_ROW) {
      return wsJson_({ ok: false, message: "장표에 빈 판매 행이 없습니다." });
    }
    // 장표 값·수식은 처음 한 번만 읽는다
    var range = sheet.getRange(
      WS_FIRST_ROW,
      1,
      lastRow - WS_FIRST_ROW + 1,
      WS_COLUMN_COUNT,
    );
    var all = range.getValues();
    var allFormulas = range.getFormulas();

    // 개통일 순서 위치에 저장 (정렬할 수 없으면 null → 아래 예전 방식)
    var plan = wsPlanSortedSave_(all, allFormulas, rows, tz);
    if (plan) {
      wsWriteSortedBlock_(sheet, plan);
      wsFormatDateColumn_(sheet, lastRow);
      SpreadsheetApp.flush();
      var sortedNotes = wsSaveNotesSafely_(ss, sheet, tz, plan.results, body.notes);
      return wsSaveReply_(batch, sheetName, plan.results, true, sortedNotes);
    }

    var results = [];
    var next = 0;
    for (var k = 0; k < rows.length; k++) {
      // 9행부터: No. 가 있고 판매 데이터가 비어 있는 다음 행
      var index = -1;
      for (var i = next; i < all.length; i++) {
        if (wsText_(all[i][WS_B_INDEX], tz) !== "" && wsIsEmptySale_(all[i])) {
          index = i;
          break;
        }
      }
      if (index < 0) {
        results.push({
          ok: false,
          message: "장표에 빈 판매 행이 없습니다. 관리자에게 문의해 주세요.",
        });
        continue;
      }
      next = index + 1;
      wsWriteSaleRow_(sheet, WS_FIRST_ROW + index, rows[k], allFormulas[index]);
      results.push({
        ok: true,
        row: WS_FIRST_ROW + index,
        no: wsText_(all[index][WS_B_INDEX], tz),
      });
    }
    wsFormatDateColumn_(sheet, lastRow);
    SpreadsheetApp.flush();
    var notesSaved = wsSaveNotesSafely_(ss, sheet, tz, results, body.notes);
    return wsSaveReply_(batch, sheetName, results, false, notesSaved);
  } finally {
    lock.releaseLock();
  }
}

/** C열 개통일 표시 형식만 mm.dd 로 (9행~마지막 행, 값은 그대로). 실패해도 저장은 그대로 */
var WS_DATE_DISPLAY_FORMAT = "mm.dd";
function wsFormatDateColumn_(sheet, lastRow) {
  try {
    if (lastRow < WS_FIRST_ROW) return;
    sheet
      .getRange(WS_FIRST_ROW, 3, lastRow - WS_FIRST_ROW + 1, 1)
      .setNumberFormat(WS_DATE_DISPLAY_FORMAT);
  } catch (err) {
    // 표시 형식만의 문제이므로 저장 결과에는 영향 없음
  }
}

/** 참고내용 보관 (실패해도 판매 저장은 그대로, notesSaved: false 로 알림) */
function wsSaveNotesSafely_(ss, sheet, tz, results, notesList) {
  if (!Array.isArray(notesList)) return false;
  try {
    wsSaveNotesForRows_(ss, sheet, tz, results, notesList);
    SpreadsheetApp.flush();
    return true;
  } catch (err) {
    return false;
  }
}

function wsSaveReply_(batch, sheetName, results, sorted, notesSaved) {
  if (!batch) {
    if (!results[0].ok) return wsJson_(results[0]);
    return wsJson_({
      ok: true,
      sheet: sheetName,
      row: results[0].row,
      no: results[0].no,
      sorted: sorted,
      message: "saved",
    });
  }
  return wsJson_({
    ok: true,
    sheet: sheetName,
    results: results,
    sorted: sorted,
    notesSaved: !!notesSaved,
    message: "saved",
  });
}

/** C열 개통일 → "yyyy-MM-dd" (정렬 기준). 날짜가 아니면 "" */
function wsSaleDateKey_(v, tz) {
  var t = wsText_(v, tz);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : "";
}

/**
 * 장표에서 읽은 한 행을 다시 쓸 값으로: 글자는 앞에 ' 를 붙여
 * 구글 시트가 "27.03" 같은 글자를 숫자·날짜로 바꾸지 않고 글자 그대로 두게 한다.
 */
function wsSheetCells_(row) {
  return row.map(function (v) {
    return typeof v === "string" && v !== "" ? "'" + v : v;
  });
}

/**
 * 개통일 순서 저장 계획. 정렬할 수 없으면 null.
 * all/formulas: 9행부터 읽은 값·수식, newRows: 웹앱이 보낸 38칸 (null = 그 칸은 빈 행 값 유지)
 * 반환: { first, last, cells: { 행index: 38칸 }, results: [{ ok, row, no } | { ok:false, message }] }
 */
function wsPlanSortedSave_(all, formulas, newRows, tz) {
  var slots = []; // No. 가 있는 행 (판매 행 자리)
  var filled = [];
  var empties = [];
  for (var i = 0; i < all.length; i++) {
    if (wsText_(all[i][WS_B_INDEX], tz) === "") continue;
    for (var f = 0; f < WS_COLUMN_COUNT; f++) {
      if (f !== WS_B_INDEX && formulas[i][f] !== "") return null; // 수식 칸이 있으면 옮기지 않는다
    }
    slots.push(i);
    if (wsIsEmptySale_(all[i])) empties.push(i);
    else filled.push(i);
  }

  var items = [];
  for (var a = 0; a < filled.length; a++) {
    var key = wsSaleDateKey_(all[filled[a]][2], tz);
    if (!key) return null;
    items.push({ key: key, order: a, source: filled[a], cells: wsSheetCells_(all[filled[a]]) });
  }
  var results = [];
  var used = 0;
  for (var k = 0; k < newRows.length; k++) {
    if (used >= empties.length) {
      results.push({
        ok: false,
        message: "장표에 빈 판매 행이 없습니다. 관리자에게 문의해 주세요.",
      });
      continue;
    }
    var newKey = wsSaleDateKey_(newRows[k][2], tz);
    if (!newKey) return null;
    // 빈 행 모양(예: N·U 의 "-") 위에 보낸 칸만 덮어쓴다 (기존 저장과 같은 결과)
    var cells = wsSheetCells_(all[empties[used]]);
    for (var c = 0; c < WS_COLUMN_COUNT; c++) {
      if (c !== WS_B_INDEX && newRows[k][c] !== null) cells[c] = newRows[k][c];
    }
    items.push({ key: newKey, order: filled.length + k, source: -1, cells: cells, result: results.length });
    results.push(null);
    used++;
  }
  // 개통일 오름차순, 같은 날짜는 기존 판매 → 새 판매(보낸 순서) 그대로
  items.sort(function (x, y) {
    if (x.key !== y.key) return x.key < y.key ? -1 : 1;
    return x.order - y.order;
  });
  // 남은 빈 행은 판매 행들 아래로 (원래 순서)
  for (var e = used; e < empties.length; e++) {
    items.push({ source: empties[e], cells: wsSheetCells_(all[empties[e]]) });
  }

  var first = -1;
  var last = -1;
  var byIndex = {};
  for (var j = 0; j < slots.length; j++) {
    var slot = slots[j];
    var item = items[j];
    byIndex[slot] = item.cells;
    if (item.result !== undefined) {
      results[item.result] = {
        ok: true,
        row: WS_FIRST_ROW + slot,
        no: wsText_(all[slot][WS_B_INDEX], tz),
      };
    }
    if (item.source !== slot) {
      if (first < 0) first = slot;
      last = slot;
    }
  }
  // 다시 쓰는 구간은 모두 No. 가 있는 행이어야 한다 (중간에 No. 없는 행이 있으면 정렬하지 않음)
  for (var r = first; first >= 0 && r <= last; r++) {
    if (!byIndex[r]) return null;
  }
  return { first: first, last: last, cells: byIndex, results: results };
}

/** 계획대로 first~last 행의 A열과 C~AL열을 한 번에 쓴다 (B열·8행 이하 위는 건드리지 않음) */
function wsWriteSortedBlock_(sheet, plan) {
  if (plan.first < 0) return; // 바뀌는 행 없음
  var colA = [];
  var colCtoAL = [];
  for (var r = plan.first; r <= plan.last; r++) {
    var cells = plan.cells[r];
    colA.push([cells[0]]);
    colCtoAL.push(cells.slice(2, WS_COLUMN_COUNT));
  }
  var top = WS_FIRST_ROW + plan.first;
  var count = plan.last - plan.first + 1;
  sheet.getRange(top, 1, count, 1).setValues(colA);
  sheet.getRange(top, 3, count, WS_COLUMN_COUNT - 2).setValues(colCtoAL);
}

/** 값이 있는 칸만, 이어진 칸끼리 묶어서 쓴다 (B열·수식 칸·null 은 건너뜀) */
function wsWriteSaleRow_(sheet, rowNumber, row, formulas) {
  var c = 0;
  while (c < WS_COLUMN_COUNT) {
    if (c === WS_B_INDEX || formulas[c] !== "" || row[c] === null) {
      c++;
      continue;
    }
    var start = c;
    var segment = [];
    while (
      c < WS_COLUMN_COUNT &&
      c !== WS_B_INDEX &&
      formulas[c] === "" &&
      row[c] !== null
    ) {
      segment.push(row[c]);
      c++;
    }
    sheet.getRange(rowNumber, start + 1, 1, segment.length).setValues([segment]);
  }
}
