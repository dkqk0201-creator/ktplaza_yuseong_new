/**
 * 무선 판매 관리 웹앱 — 판매 저장 (A~AL 38칸, Apps Script 의 save-handler.gs 전체를 이 내용으로 교체)
 *
 * 요청 (둘 중 하나):
 *   { secret, action: "save", row: [38칸] }          ← 1건
 *   { secret, action: "save", rows: [[38칸], ...] }  ← 여러 건을 한 번에 (간편등록, 최대 30건)
 *     notes: [{ 항목id: 글자 } | null, ...]          ← (선택) rows 와 같은 순서의 판매보고 참고내용.
 *       장표 A~AL 에는 쓰지 않고 notes.gs 의 숨김 보조 시트 "웹앱참고" 에 판매 건별로 보관한다.
 *   - row[i] 가 null 이면 그 칸은 건드리지 않는다 (간편등록에서 직원이 보내지 않은 칸 = 빈칸 유지).
 *   - B열(No.)은 웹앱이 보낸 값으로는 절대 쓰지 않는다. 저장 후 Apps Script 가 자동 번호만 다시 매긴다 (아래).
 *   - 수식이 들어 있는 칸은 건너뛴다.
 * 위치: C열 개통일 오름차순 (이번 달 시트 "10월" 등, 9행부터).
 *   - 새 판매는 같은 개통일 판매들의 맨 뒤에 들어가고, 그보다 뒤 날짜 판매들은 한 행씩 아래로 내려간다.
 *   - 같은 개통일끼리는 기존 순서를 유지한다 (안정 정렬). 이미 날짜순이 아니던 행도 함께 날짜순이 된다.
 *   - 판매 1건 = A~AL 한 행 전체(B열 제외)가 함께 움직인다. B열(No.)은 자동 번호 (아래).
 *   - 판매 자리 = 9행부터 "B열 No. 가 있거나 판매가 있는 마지막 행"까지 이어진 구간.
 *   - 중간에 삭제로 비어 있던 행은 판매 행들 아래로 내려간다.
 *   - 8행(합계)과 그 위는 건드리지 않는다. 값을 옮기고 서식은 행 위치에 그대로 남는다.
 *   - 셀 메모(Note, 예: O열 SPOT 메모)는 값과 함께 그 판매를 따라 옮긴다 (A열·C~AL열, B열 메모는 행에 그대로).
 *     새 판매가 들어가는 칸은 메모를 비운다 (이전 판매·삭제된 판매의 메모가 새 고객에게 붙지 않게).
 *   - 판매·빈 행에 수식이 있거나(N·U·AB·AC 행별 수식은 제외) 개통일이 날짜가 아닌 판매 행이 있으면
 *     정렬하지 않고 예전 방식(위에서부터 첫 빈 행)으로 저장한다 (응답 sorted: false).
 *     이때도 새 판매를 쓰는 그 한 행의 A열·C~AL열 메모만 비운다 (다른 행 메모는 그대로).
 * N·U·AB·AC열: 판매 행에는 숫자 대신 같은 행 수식을 넣는다 → 시트에서 O~T·V~Y·Z·AA 를 고치면 바로 다시 계산.
 *   N = SUM(O행:T행), U = SUM(V행:Y행), AB = N(Z행)-N(AA행), AC = SUM(N행,U행,AB행)
 *   ("-"·빈칸·글자는 0, 음수 그대로). 정렬로 판매가 다른 행으로 옮겨지면 그 행 번호의 수식을 새로 쓴다.
 *   빈 행(판매 없음)은 기존 빈 행 모양 그대로. 8행 합계 수식은 건드리지 않는다.
 * B열 판매 No. 자동 번호 (저장·수정·삭제 후): 판매 자리를 위에서부터 1, 2, 3… 으로 매기되
 *   개통구분(I열)이 UMNP 인 판매 행은 No. 없음(빈칸)이고 번호를 건너뛰지 않는다 (UMNP 다음 일반 판매 = 직전 번호 + 1).
 *   빈 행도 이어서 번호를 받는다. B열에 수식이 있으면 번호를 매기지 않는다. 바뀐 경우에만 B열을 한 번에 쓴다.
 * C열 개통일 표시: 저장할 때마다 9행부터 C열의 "표시 형식"만 mm.dd (예: 10.05) 로 맞춘다.
 *   값은 실제 날짜 그대로라 날짜 정렬·조회·참고내용 연결(yyyy-MM-dd 로 읽음)은 바뀌지 않는다.
 * LockService 로 한 번에 하나의 저장·삭제만 처리한다.
 * 여러 건 저장은 잠금·열 구조 확인·장표 읽기를 한 번만 해서 1건씩 여러 번 부르는 것보다 훨씬 빠르다.
 * 응답: 1건 → { ok, sheet, row, no } / 여러 건 → { ok: true, sheet, results: [{ ok, row, no } | { ok: false, message }], notesSaved }
 */
var WS_SAVE_BATCH_MAX = 30;

/* 판매 행의 행별 수식 칸 N·U·AB·AC (update-handler.gs·delete-handler.gs 도 함께 사용) */
var WS_N_INDEX = 13; // N열 총 확보금액 = O+P+Q+R+S+T
var WS_U_INDEX = 20; // U열 총 사용금액 = V+W+X+Y
var WS_AB_INDEX = 27; // AB열 중고판매 잔여 = Z − AA
var WS_AC_INDEX = 28; // AC열 합계 = N + U + AB
var WS_ROW_FORMULA_COLUMNS = [WS_N_INDEX, WS_U_INDEX, WS_AB_INDEX, WS_AC_INDEX];

/** N·U·AB·AC열인지 */
function wsIsRowFormulaColumn_(index) {
  return WS_ROW_FORMULA_COLUMNS.indexOf(index) !== -1;
}

/** 그 행의 N·U·AB·AC 수식 ("-"·빈칸·글자는 0 으로 계산: SUM·N 함수) */
function wsRowFormula_(index, r) {
  if (index === WS_N_INDEX) return "=SUM(O" + r + ":T" + r + ")";
  if (index === WS_U_INDEX) return "=SUM(V" + r + ":Y" + r + ")";
  if (index === WS_AB_INDEX) return "=N(Z" + r + ")-N(AA" + r + ")";
  return "=SUM(N" + r + ",U" + r + ",AB" + r + ")";
}

/** 판매 행 38칸에 N·U·AB·AC 수식을 넣은 사본 (rowNumber = 실제로 쓰일 행) */
function wsWithRowFormulas_(cells, rowNumber) {
  var out = cells.slice();
  for (var i = 0; i < WS_ROW_FORMULA_COLUMNS.length; i++) {
    out[WS_ROW_FORMULA_COLUMNS[i]] = wsRowFormula_(WS_ROW_FORMULA_COLUMNS[i], rowNumber);
  }
  return out;
}

/* B열 판매 No. 자동 번호 (update-handler.gs·delete-handler.gs 도 함께 사용) */

/** 개통구분 UMNP 인지 (대소문자·공백 무시) */
function wsIsUmnp_(v) {
  return String(v === null || v === undefined ? "" : v).replace(/\s/g, "").toUpperCase() === "UMNP";
}

/** 판매가 있는 UMNP 행인지 (I열 = 개통구분) */
function wsIsUmnpRow_(r) {
  return !wsIsEmptySale_(r) && wsIsUmnp_(r[8]);
}

/** 판매 자리의 마지막 index (9행 = 0): B열 No. 가 있거나 판매가 있는 마지막 행. 없으면 -1 */
function wsLastSlotIndex_(rows, tz) {
  for (var i = rows.length - 1; i >= 0; i--) {
    if (wsText_(rows[i][WS_B_INDEX], tz) !== "" || !wsIsEmptySale_(rows[i])) return i;
  }
  return -1;
}

/** 판매 자리(0..last)의 No.: 일반 판매·빈 행 1, 2, 3… / UMNP 행 "" */
function wsSaleNumbers_(rows, last) {
  var out = [];
  var n = 0;
  for (var i = 0; i <= last; i++) out.push(wsIsUmnpRow_(rows[i]) ? "" : ++n);
  return out;
}

/**
 * 장표 B열 No. 를 다시 매긴다 (바뀐 칸이 있을 때만 B열 구간을 한 번에 씀, 다른 열은 건드리지 않음).
 * minLast: 이 index 까지는 판매 자리로 본다 (삭제로 비워진 UMNP 행 등). 반환: index 별 No. ("" = UMNP)
 */
function wsRenumberSaleRows_(sheet, tz, minLast) {
  // 판매 자리(minLast)까지는 반드시 읽는다 (맨 아래 UMNP 를 지워 그 행이 통째로 빈 경우에도 자리 유지)
  var lastRow = Math.max(sheet.getLastRow(), typeof minLast === "number" ? WS_FIRST_ROW + minLast : 0);
  if (lastRow < WS_FIRST_ROW) return [];
  var range = sheet.getRange(WS_FIRST_ROW, 1, lastRow - WS_FIRST_ROW + 1, WS_COLUMN_COUNT);
  var rows = range.getValues();
  var last = wsLastSlotIndex_(rows, tz);
  if (typeof minLast === "number" && minLast > last) last = minLast;
  if (last < 0) return [];
  var nums = wsSaleNumbers_(rows, last);
  var bRange = sheet.getRange(WS_FIRST_ROW, WS_B_INDEX + 1, last + 1, 1);
  var bFormulas = bRange.getFormulas();
  var changed = false;
  for (var i = 0; i <= last; i++) {
    if (bFormulas[i][0] !== "") return nums; // B열이 수식이면 번호를 쓰지 않는다
    if (wsText_(rows[i][WS_B_INDEX], tz) !== String(nums[i])) changed = true;
  }
  if (changed) {
    bRange.setValues(
      nums.map(function (v) {
        return [v];
      }),
    );
  }
  return nums;
}

/** 저장 결과의 No. 를 다시 매긴 번호로 */
function wsApplyNumbers_(results, nums) {
  for (var i = 0; i < results.length; i++) {
    if (results[i] && results[i].ok) {
      var v = nums[results[i].row - WS_FIRST_ROW];
      results[i].no = v === undefined ? results[i].no : String(v);
    }
  }
}

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
    // 셀 메모: 판매를 옮길 때 함께 옮긴다 (못 읽으면 null → 정렬하지 않고 예전 방식)
    var allNotes = null;
    try {
      allNotes = range.getNotes();
    } catch (err) {
      allNotes = null;
    }

    // 개통일 순서 위치에 저장 (정렬할 수 없으면 null → 아래 예전 방식)
    var lastSlot = wsLastSlotIndex_(all, tz);
    var plan = allNotes ? wsPlanSortedSave_(all, allFormulas, rows, tz, allNotes) : null;
    if (plan) {
      wsWriteSortedBlock_(sheet, plan);
      wsFormatDateColumn_(sheet, lastRow);
      SpreadsheetApp.flush();
      wsApplyNumbers_(plan.results, wsRenumberSaleRows_(sheet, tz, lastSlot));
      SpreadsheetApp.flush();
      var sortedNotes = wsSaveNotesSafely_(ss, sheet, tz, plan.results, body.notes);
      return wsSaveReply_(batch, sheetName, plan.results, true, sortedNotes);
    }

    var results = [];
    var next = 0;
    for (var k = 0; k < rows.length; k++) {
      // 9행부터: 판매 자리 중 판매 데이터가 비어 있는 다음 행
      var index = -1;
      for (var i = next; i <= lastSlot; i++) {
        if (wsIsEmptySale_(all[i])) {
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
      // 새 판매가 들어갈 이 한 행에 남아 있던 메모(이전·삭제된 판매)를 비운다 (값·서식은 그대로)
      wsClearSaleRowNotes_(sheet, WS_FIRST_ROW + index);
      wsWriteSaleRow_(
        sheet,
        WS_FIRST_ROW + index,
        wsWithRowFormulas_(rows[k], WS_FIRST_ROW + index),
        allFormulas[index],
      );
      results.push({
        ok: true,
        row: WS_FIRST_ROW + index,
        no: wsText_(all[index][WS_B_INDEX], tz),
      });
    }
    wsFormatDateColumn_(sheet, lastRow);
    SpreadsheetApp.flush();
    wsApplyNumbers_(results, wsRenumberSaleRows_(sheet, tz, lastSlot));
    SpreadsheetApp.flush();
    var notesSaved = wsSaveNotesSafely_(ss, sheet, tz, results, body.notes);
    return wsSaveReply_(batch, sheetName, results, false, notesSaved);
  } finally {
    lock.releaseLock();
  }
}

/** 판매 한 행의 A열·C~AL열 메모만 비운다 (B열 No. 메모·값·서식은 그대로) */
function wsClearSaleRowNotes_(sheet, rowNumber) {
  sheet.getRange(rowNumber, 1).clearNote();
  sheet.getRange(rowNumber, 3, 1, WS_COLUMN_COUNT - 2).clearNote();
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
 * all/formulas/notes: 9행부터 읽은 값·수식·메모, newRows: 웹앱이 보낸 38칸 (null = 그 칸은 빈 행 값 유지)
 * 반환: { first, last, cells: { 행index: 38칸 }, notes: { 행index: 38칸 메모 }, results: [...] }
 *   메모는 값과 같이 판매를 따라 옮기고, 새 판매 자리는 빈 메모.
 */
function wsPlanSortedSave_(all, formulas, newRows, tz, notes) {
  var blankNotes = [];
  for (var bn = 0; bn < WS_COLUMN_COUNT; bn++) blankNotes.push("");
  var slots = []; // 판매 자리 (9행부터 이어진 구간, UMNP 행처럼 No. 가 빈 판매 행 포함)
  var filled = [];
  var empties = [];
  var lastSlot = wsLastSlotIndex_(all, tz);
  for (var i = 0; i <= lastSlot; i++) {
    for (var f = 0; f < WS_COLUMN_COUNT; f++) {
      // 수식 칸이 있으면 옮기지 않는다 (N·U·AB·AC 행별 수식은 행마다 다시 쓰므로 제외)
      if (f !== WS_B_INDEX && !wsIsRowFormulaColumn_(f) && formulas[i][f] !== "") return null;
    }
    slots.push(i);
    if (wsIsEmptySale_(all[i])) empties.push(i);
    else filled.push(i);
  }

  var items = [];
  for (var a = 0; a < filled.length; a++) {
    var key = wsSaleDateKey_(all[filled[a]][2], tz);
    if (!key) return null;
    items.push({ key: key, order: a, source: filled[a], cells: wsSheetCells_(all[filled[a]]), notes: notes[filled[a]] });
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
    // 새 판매는 메모 없음 (그 자리에 남아 있던 이전 메모는 지워진다)
    items.push({ key: newKey, order: filled.length + k, source: -1, cells: cells, notes: blankNotes, result: results.length });
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
    var emptyCells = wsSheetCells_(all[empties[e]]);
    // 빈 행에 행별 수식이 남아 있었다면(시트에서 값만 지운 행 등) 빈 행 모양으로: N·U "-", AB·AC 빈칸
    for (var q = 0; q < WS_ROW_FORMULA_COLUMNS.length; q++) {
      var fc = WS_ROW_FORMULA_COLUMNS[q];
      if (formulas[empties[e]][fc] !== "") {
        emptyCells[fc] = fc === WS_N_INDEX || fc === WS_U_INDEX ? "-" : "";
      }
    }
    items.push({ source: empties[e], cells: emptyCells, notes: notes[empties[e]] });
  }

  var first = -1;
  var last = -1;
  var byIndex = {};
  var notesByIndex = {};
  for (var j = 0; j < slots.length; j++) {
    var slot = slots[j];
    var item = items[j];
    // 판매 행은 그 행 번호의 N·U·AB·AC 수식으로 (정렬로 옮겨져도 같은 행 값을 계산)
    byIndex[slot] = item.key ? wsWithRowFormulas_(item.cells, WS_FIRST_ROW + slot) : item.cells;
    notesByIndex[slot] = item.notes;
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
  // 다시 쓰는 구간은 모두 판매 자리여야 한다
  for (var r = first; first >= 0 && r <= last; r++) {
    if (!byIndex[r]) return null;
  }
  return { first: first, last: last, cells: byIndex, notes: notesByIndex, results: results };
}

/** 계획대로 first~last 행의 A열과 C~AL열 값·메모를 한 번에 쓴다 (B열·8행 이하 위는 건드리지 않음) */
function wsWriteSortedBlock_(sheet, plan) {
  if (plan.first < 0) return; // 바뀌는 행 없음
  var colA = [];
  var colCtoAL = [];
  var notesA = [];
  var notesCtoAL = [];
  for (var r = plan.first; r <= plan.last; r++) {
    var cells = plan.cells[r];
    var notes = plan.notes[r];
    colA.push([cells[0]]);
    colCtoAL.push(cells.slice(2, WS_COLUMN_COUNT));
    notesA.push([notes[0]]);
    notesCtoAL.push(notes.slice(2, WS_COLUMN_COUNT));
  }
  var top = WS_FIRST_ROW + plan.first;
  var count = plan.last - plan.first + 1;
  sheet.getRange(top, 1, count, 1).setValues(colA);
  sheet.getRange(top, 3, count, WS_COLUMN_COUNT - 2).setValues(colCtoAL);
  // 메모도 판매를 따라 같은 자리로 (예: O열 SPOT 메모가 밀려난 판매와 함께 이동)
  sheet.getRange(top, 1, count, 1).setNotes(notesA);
  sheet.getRange(top, 3, count, WS_COLUMN_COUNT - 2).setNotes(notesCtoAL);
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
