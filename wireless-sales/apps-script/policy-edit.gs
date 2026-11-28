/**
 * 무선 판매 관리 웹앱 — 예산관리 "정책 확보 관리" (판매별 정책 확보금액 수정, Apps Script 에 새 파일 policy-edit.gs 로 추가)
 *
 * 카톡 판매보고 "정책" 세 항목은 간편등록이 장표에 따로 저장한다 (lib/quick-report.ts QUICK_FIELDS):
 *   ㄴ고객혜택        → T열 (고객혜택)
 *   ㄴ그외(스팟제외)  → S열 (모델정책)
 *   ㄴ2ND연계정책     → R열 (2ND)
 * 이 파일은 그 세 칸(R·S·T)의 값만 숫자로 고친다. 같은 행의 N(=SUM(O:T) 총 확보금액)·AC(최종 남은 예산) 수식,
 * O열(충청/스팟)·P·Q·U~AB·다른 칸·다른 행·B열 No.·메모는 쓰지 않는다 → 예산관리(고객혜택 확보 P+Q+R+S+T)와
 * 모델정책 정산(S열)에 기존 수식·계산 그대로 반영된다.
 * N열이 이 행의 =SUM(O:T) 수식이 아닌 행, 고칠 칸이 수식인 행은 거부한다 (합계가 따라오지 않을 수 있으므로).
 *
 * 저장 직전 (잠금 안에서) 판매마다 다시 확인한다 — 하나라도 다르면 그 판매는 쓰지 않고 실패로 알린다:
 *   행 번호 + No.(B)·개통일(C)·고객(D)·CTN(E)·모델(J) 이 화면에서 본 값과 같음 / 판매 ID 가 있으면 C열 메모의 판매 ID 와 같음 /
 *   빈 행·삭제된 행이 아님 / 지금 R·S·T 값이 화면에서 본 값과 모두 같음 (다른 사람이 바꿨으면 충돌로 거부).
 *   요청 ID 가 이력에 있으면 다시 쓰지 않고 저장된 결과를 돌려준다 (중복 저장 방지).
 * 수정 이력: 같은 스프레드시트의 별도 시트 "정책확보수정이력" (처음 쓸 때 자동 생성). 판매마다 한 줄,
 *   고객 이름·전화번호는 적지 않는다 (월 시트·행·No.·개통일·판매 ID·모델·변경 전/후 R·S·T).
 * 되돌리기(undo): 이력의 변경 전 값으로. 지금 값이 이력의 변경 후 값과 같은 판매만 (그사이 바뀌었으면 건너뜀).
 *
 * 요청 (update-handler.gs 의 wsHandleSaleUpdate_ 가 action "policy-edit" 을 넘겨준다):
 *   { secret, action: "policy-edit", op: "apply", requestId, operator, items: [{ sheet, row, no, activatedAt, customer, ctn, model, saleId,
 *       before: { second, other, benefit }, after: { second?, other?, benefit? } }] }
 *   { secret, action: "policy-edit", op: "history" }
 *   { secret, action: "policy-edit", op: "undo", requestId }
 * 응답: { ok, handler: "ws-policy-edit", message, ... }
 */
var WS_POLICY_HANDLER = "ws-policy-edit";
var WS_POLICY_SHEET = "정책확보수정이력";
var WS_POLICY_HEADER = [
  "요청 ID",
  "저장일시",
  "작업자",
  "상태",
  "월 시트",
  "행",
  "판매 No.",
  "개통일",
  "판매 ID",
  "모델명",
  "변경 전 2ND연계정책(R)",
  "변경 후 2ND연계정책(R)",
  "변경 전 그외(S)",
  "변경 후 그외(S)",
  "변경 전 고객혜택(T)",
  "변경 후 고객혜택(T)",
  "확보 증감",
  "되돌린 일시",
];
var WS_POLICY_COLS = WS_POLICY_HEADER.length;
var WS_POLICY_MAX_ITEMS = 200;
var WS_POLICY_AMOUNT_MAX = 10000000;
var WS_POLICY_APPLIED = "적용";
var WS_POLICY_UNDONE = "되돌림";
/** 고칠 수 있는 칸: 키 → 0부터 열 번호 / 이력 열 위치(변경 전, 0부터) */
var WS_POLICY_FIELDS = [
  { key: "second", index: 17, hist: 10, label: "2ND연계정책" }, // R
  { key: "other", index: 18, hist: 12, label: "그외(스팟제외)" }, // S
  { key: "benefit", index: 19, hist: 14, label: "고객혜택" }, // T
];
var WS_POLICY_N_INDEX = 13; // N (0부터)
var WS_POLICY_MODEL_INDEX = 9; // J

function wsPolicyReply_(obj) {
  obj.handler = WS_POLICY_HANDLER;
  return wsJson_(obj);
}
function wsPolicyFail_(message) {
  return wsPolicyReply_({ ok: false, message: message });
}

function wsPolicyModel_(v) {
  return String(v === null || v === undefined ? "" : v).trim().replace(/\s+/g, " ").toUpperCase();
}

/** 금액 칸 → 숫자 (빈칸·"-" = 0). 숫자로 읽을 수 없는 글자면 null */
function wsPolicyNumber_(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  var t = String(v === null || v === undefined ? "" : v).trim().replace(/^'/, "");
  if (t === "" || t === "-") return 0;
  var n = t.replace(/,/g, "").replace(/원$/, "");
  return /^-?\d+(\.\d+)?$/.test(n) ? Number(n) : null;
}

/** N열이 이 행의 =SUM(O행:T행) 수식인지 */
function wsPolicyNFormulaOk_(formula, row) {
  return String(formula || "").replace(/\s+/g, "").toUpperCase() === "=SUM(O" + row + ":T" + row + ")";
}

function wsPolicyHeaderProblem_(sheet) {
  var header = sheet.getRange(1, 1, 1, WS_POLICY_COLS).getValues()[0];
  for (var i = 0; i < WS_POLICY_COLS; i++) {
    if (String(header[i]).trim() !== WS_POLICY_HEADER[i]) {
      return wsColumnLetter_(i + 1) + "1 칸 제목이 '" + WS_POLICY_HEADER[i] + "'가 아닙니다.";
    }
  }
  return "";
}

function wsPolicySheet_(ss, create) {
  var sheet = ss.getSheetByName(WS_POLICY_SHEET);
  if (!sheet && create) sheet = ss.insertSheet(WS_POLICY_SHEET);
  if (sheet && create && sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, WS_POLICY_COLS).setValues([WS_POLICY_HEADER]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function wsPolicyHistoryRows_(sheet, tz) {
  var out = [];
  if (!sheet || sheet.getLastRow() < 2) return out;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, WS_POLICY_COLS).getValues();
  for (var i = 0; i < values.length; i++) {
    var r = values[i].map(function (v) {
      return v instanceof Date ? Utilities.formatDate(v, tz, "yyyy-MM-dd HH:mm:ss") : String(v === null || v === undefined ? "" : v);
    });
    if (!r[0]) continue;
    out.push({ row: i + 2, values: r });
  }
  return out;
}

/** 이력에 적힌 변경 전 원문 → 셀에 다시 쓸 값 (숫자면 숫자, "-"·빈칸·글자는 그대로) */
function wsPolicyRestoreValue_(raw) {
  var t = String(raw === null || raw === undefined ? "" : raw);
  var n = t.replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(n) ? Number(n) : t;
}

function wsHandlePolicyEdit_(body) {
  if (!wsAuthorized_(body)) return wsPolicyFail_("인증에 실패했습니다.");
  var op = String(body.op || "");
  var ss = wsSpreadsheet_();
  var tz = ss.getSpreadsheetTimeZone();

  if (op === "history") {
    var hs = wsPolicySheet_(ss, false);
    if (hs && hs.getLastRow() > 0) {
      var hp = wsPolicyHeaderProblem_(hs);
      if (hp) return wsPolicyFail_(WS_POLICY_SHEET + " 시트 제목이 웹앱과 다릅니다 (" + hp + ")");
    }
    var groups = {};
    var order = [];
    var rows = wsPolicyHistoryRows_(hs, tz);
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i].values;
      var g = groups[v[0]];
      if (!g) {
        g = { requestId: v[0], savedAt: v[1], operator: v[2], sales: 0, delta: 0, applied: 0, undone: 0, second: 0, other: 0, benefit: 0 };
        groups[v[0]] = g;
        order.push(v[0]);
      }
      g.sales++;
      g.delta += Number(v[16]) || 0;
      for (var f = 0; f < WS_POLICY_FIELDS.length; f++) {
        var fd = WS_POLICY_FIELDS[f];
        g[fd.key] += (wsPolicyNumber_(v[fd.hist + 1]) || 0) - (wsPolicyNumber_(v[fd.hist]) || 0);
      }
      if (v[3] === WS_POLICY_UNDONE) g.undone++;
      else g.applied++;
    }
    var list = [];
    for (var k = order.length - 1; k >= 0 && list.length < 20; k--) {
      var x = groups[order[k]];
      list.push({
        requestId: x.requestId,
        savedAt: x.savedAt,
        operator: x.operator,
        sales: x.sales,
        delta: x.delta,
        second: x.second,
        other: x.other,
        benefit: x.benefit,
        status: x.undone === 0 ? WS_POLICY_APPLIED : x.applied === 0 ? WS_POLICY_UNDONE : "일부 되돌림",
      });
    }
    return wsPolicyReply_({ ok: true, items: list });
  }

  if (op !== "apply" && op !== "undo") return wsPolicyFail_("요청 형식이 올바르지 않습니다.");
  var requestId = String(body.requestId || "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(requestId)) return wsPolicyFail_("요청 ID 형식이 올바르지 않습니다.");
  var items = null;
  if (op === "apply") {
    items = body.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > WS_POLICY_MAX_ITEMS) {
      return wsPolicyFail_("한 번에 1~" + WS_POLICY_MAX_ITEMS + "건까지 저장할 수 있습니다.");
    }
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return wsPolicyFail_("다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.");
  try {
    var stamp = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss");
    if (op === "undo") return wsPolicyUndo_(ss, tz, requestId, stamp);
    return wsPolicyApply_(ss, tz, requestId, items, String(body.operator || "관리자").slice(0, 20), stamp);
  } finally {
    lock.releaseLock();
  }
}

function wsPolicyApply_(ss, tz, requestId, items, operator, stamp) {
  var hist = wsPolicySheet_(ss, true);
  var hp = wsPolicyHeaderProblem_(hist);
  if (hp) return wsPolicyFail_(WS_POLICY_SHEET + " 시트 제목이 웹앱과 다릅니다 (" + hp + ") 저장하지 않았습니다.");

  var past = wsPolicyHistoryRows_(hist, tz).filter(function (h) {
    return h.values[0] === requestId;
  });
  if (past.length > 0) {
    var delta0 = 0;
    for (var p0 = 0; p0 < past.length; p0++) delta0 += Number(past[p0].values[16]) || 0;
    return wsPolicyReply_({
      ok: true,
      repeated: true,
      requestId: requestId,
      applied: past.length,
      failed: 0,
      delta: delta0,
      results: [],
      message: "이미 처리된 요청입니다 (다시 저장하지 않음).",
    });
  }

  var text = function (v) {
    return wsText_(v, tz);
  };
  var digits = function (v) {
    return text(v).replace(/\D/g, "");
  };
  var results = [];
  var writes = [];
  var sheetCache = {};
  var seenRow = {};
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var sheetName = String(it.sheet || "");
    var rowNumber = Number(it.row);
    var res = { sheet: sheetName, row: rowNumber, ok: false, message: "" };
    results.push(res);
    var fail = function (m) {
      res.message = m;
    };
    if (!wsIsMonthSheetName_(sheetName) || !(rowNumber >= WS_FIRST_ROW) || Math.floor(rowNumber) !== rowNumber) {
      fail("판매 위치 형식이 올바르지 않습니다.");
      continue;
    }
    var rowKey = sheetName + ":" + rowNumber;
    if (seenRow[rowKey]) {
      fail("같은 판매가 요청에 두 번 들어 있어 한 번만 처리했습니다.");
      continue;
    }
    seenRow[rowKey] = true;

    // 바꿀 값 확인: 정수 0 ~ 1,000만, 하나 이상
    var after = it.after || {};
    var before = it.before || {};
    var changes = [];
    var badValue = false;
    for (var f = 0; f < WS_POLICY_FIELDS.length; f++) {
      var fd = WS_POLICY_FIELDS[f];
      if (after[fd.key] === undefined || after[fd.key] === null) continue;
      var nv = after[fd.key];
      if (typeof nv !== "number" || Math.floor(nv) !== nv || nv < 0 || nv > WS_POLICY_AMOUNT_MAX) badValue = true;
      else changes.push({ field: fd, value: nv });
    }
    if (badValue || changes.length === 0) {
      fail("바꿀 금액 형식이 올바르지 않습니다.");
      continue;
    }

    var cache = sheetCache[sheetName];
    if (!cache) {
      var sh = ss.getSheetByName(sheetName);
      if (!sh) cache = { error: sheetName + " 시트를 찾을 수 없습니다." };
      else {
        var lp = wsLayoutProblem_(sh);
        if (lp) cache = { error: sheetName + " 시트의 열 구조가 웹앱과 다릅니다 (" + lp + ")" };
        else cache = { sheet: sh, last: sh.getLastRow() };
      }
      sheetCache[sheetName] = cache;
    }
    if (cache.error) {
      fail(cache.error);
      continue;
    }
    if (rowNumber > cache.last) {
      fail("해당 행이 장표에 없습니다 (삭제되었거나 위치가 바뀜). 다시 조회해 주세요.");
      continue;
    }
    var sheet = cache.sheet;
    var cur = sheet.getRange(rowNumber, 1, 1, WS_COLUMN_COUNT).getValues()[0];
    var formulas = sheet.getRange(rowNumber, 1, 1, WS_COLUMN_COUNT).getFormulas()[0];
    if (wsIsEmptySale_(cur)) {
      fail("판매 내용이 없는 행입니다 (삭제된 판매).");
      continue;
    }
    var mism = [];
    if (text(cur[WS_B_INDEX]) !== text(it.no)) mism.push("No.");
    if (text(cur[2]) !== text(it.activatedAt)) mism.push("개통일");
    if (text(cur[3]) !== text(it.customer)) mism.push("고객");
    if (digits(cur[4]) !== digits(it.ctn)) mism.push("CTN");
    if (wsPolicyModel_(cur[WS_POLICY_MODEL_INDEX]) !== wsPolicyModel_(it.model)) mism.push("모델");
    var saleId = "";
    try {
      if (typeof wsSaleIdFromNote_ === "function") saleId = wsSaleIdFromNote_(sheet.getRange(rowNumber, 3).getNote()) || "";
    } catch (err) {
      saleId = "";
    }
    if (String(it.saleId || "") !== "" && String(it.saleId) !== saleId) mism.push("판매 ID");
    if (mism.length > 0) {
      fail("장표 내용이 화면과 달라 수정하지 않았습니다 (" + mism.join(", ") + "). 다시 조회해 주세요.");
      continue;
    }
    if (!wsPolicyNFormulaOk_(formulas[WS_POLICY_N_INDEX], rowNumber)) {
      fail("N열(총 확보금액)이 이 행의 합계 수식(=SUM(O:T))이 아니라 수정하지 않았습니다. 장표에서 확인해 주세요.");
      continue;
    }
    // 세 칸 모두 화면에서 본 값과 같아야 한다 (다른 사람이 바꿨으면 충돌)
    var conflict = [];
    var formulaCell = "";
    for (var c = 0; c < WS_POLICY_FIELDS.length; c++) {
      var fc = WS_POLICY_FIELDS[c];
      if (formulas[fc.index]) formulaCell = fc.label;
      var seen = before[fc.key] === undefined || before[fc.key] === null ? "" : String(before[fc.key]);
      if (wsComparable_(cur[fc.index], tz) !== wsComparable_(seen, tz)) conflict.push(fc.label);
    }
    if (formulaCell) {
      fail(formulaCell + " 칸이 수식이라 수정하지 않았습니다.");
      continue;
    }
    if (conflict.length > 0) {
      fail("조회 후 다른 곳에서 금액이 바뀌어 수정하지 않았습니다 (" + conflict.join(", ") + "). 다시 조회해 주세요.");
      continue;
    }
    var hrow = [requestId, stamp, operator, WS_POLICY_APPLIED, sheetName, rowNumber, text(cur[WS_B_INDEX]), text(cur[2]), saleId, wsPolicyModel_(cur[WS_POLICY_MODEL_INDEX])];
    var delta = 0;
    var cellWrites = [];
    for (var h = 0; h < WS_POLICY_FIELDS.length; h++) {
      var fh = WS_POLICY_FIELDS[h];
      var raw = cur[fh.index] === null || cur[fh.index] === undefined ? "" : String(cur[fh.index]);
      var ch = null;
      for (var q = 0; q < changes.length; q++) if (changes[q].field === fh) ch = changes[q];
      if (ch) {
        delta += ch.value - (wsPolicyNumber_(cur[fh.index]) || 0);
        cellWrites.push({ index: fh.index, value: ch.value });
        hrow.push(raw, String(ch.value));
      } else {
        hrow.push(raw, raw);
      }
    }
    hrow.push(String(delta), "");
    writes.push({ res: res, sheet: sheet, row: rowNumber, cells: cellWrites, delta: delta, history: hrow });
  }

  // 쓰기: 바뀐 칸만 숫자로. 이력은 한 번에
  for (var w = 0; w < writes.length; w++) {
    for (var cw = 0; cw < writes[w].cells.length; cw++) {
      writes[w].sheet.getRange(writes[w].row, writes[w].cells[cw].index + 1).setValue(writes[w].cells[cw].value);
    }
  }
  if (writes.length > 0) {
    var start = Math.max(hist.getLastRow(), 1) + 1;
    var hr = hist.getRange(start, 1, writes.length, WS_POLICY_COLS);
    hr.setNumberFormat("@");
    hr.setValues(
      writes.map(function (x) {
        return x.history.map(function (v) {
          return typeof v === "number" ? String(v) : v;
        });
      }),
    );
  }
  SpreadsheetApp.flush();

  // 다시 읽어 확인
  var applied = 0;
  var deltaSum = 0;
  for (var r = 0; r < writes.length; r++) {
    var wr = writes[r];
    var okAll = true;
    for (var cc = 0; cc < wr.cells.length; cc++) {
      var now = wr.sheet.getRange(wr.row, wr.cells[cc].index + 1).getValues()[0][0];
      if (wsPolicyNumber_(now) !== wr.cells[cc].value) okAll = false;
    }
    if (okAll) {
      wr.res.ok = true;
      wr.res.message = "수정";
      applied++;
      deltaSum += wr.delta;
    } else {
      wr.res.message = "저장 후 확인에 실패했습니다. 장표 R·S·T 열을 확인해 주세요.";
    }
  }
  return wsPolicyReply_({
    ok: true,
    repeated: false,
    requestId: requestId,
    applied: applied,
    failed: results.length - applied,
    delta: deltaSum,
    results: results,
    message: applied + "건 수정" + (results.length - applied > 0 ? ", " + (results.length - applied) + "건 실패" : ""),
  });
}

/** 되돌리기: 이력의 변경 전 값으로. 지금 값이 이력의 변경 후 값과 같은 판매만 */
function wsPolicyUndo_(ss, tz, requestId, stamp) {
  var hist = wsPolicySheet_(ss, false);
  if (!hist) return wsPolicyFail_("정책 확보 수정 이력이 없습니다.");
  var hp = wsPolicyHeaderProblem_(hist);
  if (hp) return wsPolicyFail_(WS_POLICY_SHEET + " 시트 제목이 웹앱과 다릅니다 (" + hp + ")");
  var rows = wsPolicyHistoryRows_(hist, tz).filter(function (h) {
    return h.values[0] === requestId && h.values[3] === WS_POLICY_APPLIED;
  });
  if (rows.length === 0) return wsPolicyFail_("되돌릴 수 있는 수정이 없습니다 (이미 되돌렸거나 없는 요청).");
  var restored = 0;
  var skipped = [];
  for (var i = 0; i < rows.length; i++) {
    var v = rows[i].values;
    var sheet = ss.getSheetByName(v[4]);
    var rowNumber = Number(v[5]);
    var label = v[4] + " " + v[7] + " No." + (v[6] || "없음");
    if (!sheet || wsLayoutProblem_(sheet)) {
      skipped.push(label + ": 시트 확인 불가");
      continue;
    }
    // 판매 ID 가 있으면 ID 로 행을 찾는다 (그사이 정렬로 행이 옮겨졌을 수 있음)
    if (v[8] && typeof wsSaleIdFromNote_ === "function") {
      var notes = sheet.getRange(WS_FIRST_ROW, 3, Math.max(sheet.getLastRow() - WS_FIRST_ROW + 1, 1), 1).getNotes();
      var foundRow = 0;
      var count = 0;
      for (var n = 0; n < notes.length; n++) {
        if (wsSaleIdFromNote_(notes[n][0]) === v[8]) {
          foundRow = WS_FIRST_ROW + n;
          count++;
        }
      }
      if (count !== 1) {
        skipped.push(label + ": 판매를 찾지 못함");
        continue;
      }
      rowNumber = foundRow;
    }
    if (rowNumber > sheet.getLastRow()) {
      skipped.push(label + ": 판매를 찾지 못함");
      continue;
    }
    var cur = sheet.getRange(rowNumber, 1, 1, WS_COLUMN_COUNT).getValues()[0];
    var formulas = sheet.getRange(rowNumber, 1, 1, WS_COLUMN_COUNT).getFormulas()[0];
    if (wsText_(cur[2], tz) !== v[7] || wsText_(cur[WS_B_INDEX], tz) !== v[6] || wsPolicyModel_(cur[WS_POLICY_MODEL_INDEX]) !== v[9]) {
      skipped.push(label + ": 판매 식별값이 이력과 다름");
      continue;
    }
    var changed = false;
    for (var c = 0; c < WS_POLICY_FIELDS.length; c++) {
      var fd = WS_POLICY_FIELDS[c];
      if (formulas[fd.index] || wsComparable_(cur[fd.index], tz) !== wsComparable_(v[fd.hist + 1], tz)) changed = true;
    }
    if (changed) {
      skipped.push(label + ": 수정 후 R·S·T 금액이 다시 바뀌어 건너뜀");
      continue;
    }
    for (var w = 0; w < WS_POLICY_FIELDS.length; w++) {
      var fw = WS_POLICY_FIELDS[w];
      if (v[fw.hist] === v[fw.hist + 1]) continue; // 바꾸지 않은 칸은 쓰지 않는다
      sheet.getRange(rowNumber, fw.index + 1).setValue(wsPolicyRestoreValue_(v[fw.hist]));
    }
    hist.getRange(rows[i].row, 4).setValue(WS_POLICY_UNDONE);
    hist.getRange(rows[i].row, 18).setValue(stamp);
    restored++;
  }
  SpreadsheetApp.flush();
  return wsPolicyReply_({
    ok: true,
    restored: restored,
    skipped: skipped,
    message: restored + "건 되돌림" + (skipped.length ? ", " + skipped.length + "건 건너뜀" : ""),
  });
}
