/**
 * 무선 판매 관리 웹앱 — 스팟예산 기간·모델별 일괄등록 (Apps Script 에 새 파일 spot-bulk.gs 로 추가)
 *
 * 기존 스팟관리 구조를 그대로 쓴다:
 *   - O열(SPOT정책) 값  = 그 판매의 SPOT 금액 합계 (숫자)
 *   - O열 셀 메모       = SPOT 번호별 금액, 줄마다 하나 ("스팟1 3만")
 * 일괄등록은 판매마다
 *   O열  ← 기존 O열 금액 + 새 SPOT 금액 (숫자로 쓴다. 글자로 바꾸거나 번호와 합치지 않음)
 *   메모 ← 기존 메모 + 새 줄 "스팟N 금액" (기존 줄은 그대로)
 * 만 바꾼다. 같은 행의 N(=SUM(O:T))·AC(최종 남은 예산) 수식은 건드리지 않으며 O열 값에 따라 자동 계산된다.
 * 다른 칸·다른 행·B열 No.·수식은 쓰지 않는다. O열이 수식인 행은 거부한다.
 *
 * 저장 직전 (잠금 안에서) 판매마다 다시 확인한다 — 하나라도 다르면 그 판매는 쓰지 않고 실패로 알린다:
 *   행 번호 + No.(B)·개통일(C)·고객(D)·CTN(E)·모델(J) 이 화면에서 본 값과 같음 / 개통일이 정상 날짜 /
 *   빈 행·삭제된 행이 아님 / 개통구분에 '취소' 없음 / 개통일이 조건 기간 안 / 모델이 조건 모델 /
 *   지금 O열 값·메모가 화면에서 본 값과 같음 / 메모에 같은 스팟 번호가 아직 없음.
 *   → 같은 요청을 두 번 보내도(재전송·두 번 누름) 두 번째는 O열 값이 이미 바뀌어 있어 다시 쓰지 않는다.
 *     요청 ID 가 이력에 있으면 아예 처음부터 다시 쓰지 않고 저장된 결과를 돌려준다.
 * 변경 이력: 같은 스프레드시트의 별도 시트 "스팟일괄등록이력" (처음 쓸 때 자동 생성, 1행 제목).
 *   판매마다 한 줄: 요청 ID·적용일시·작업자·상태·월 시트·행·판매 No.·개통일·판매 ID·모델·스팟 번호·
 *   건당 금액·적용 조건·변경 전/후 O열·변경 전/후 메모·되돌린 일시. 고객 이름·전화번호는 적지 않는다.
 * 되돌리기(undo): 이력의 변경 전 O열·메모로 복구. 지금 값이 이력의 변경 후 값과 같을 때만 (그사이 바뀌었으면 그 판매는 건너뜀).
 *
 * 요청 (update-handler.gs 의 wsHandleSaleUpdate_ 가 이 action 을 넘겨준다 → doPost 수정 불필요):
 *   { secret, action: "spot-bulk", op: "apply", requestId, operator, conditions: [{ id, from, to, models, spot, amount }], items: [...] }
 *   { secret, action: "spot-bulk", op: "history" }
 *   { secret, action: "spot-bulk", op: "undo", requestId }
 * 응답: { ok, handler: "ws-spot-bulk", message, ... }
 */
var WS_SPOT_BULK_HANDLER = "ws-spot-bulk";
var WS_SPOT_BULK_SHEET = "스팟일괄등록이력";
var WS_SPOT_BULK_HEADER = [
  "요청 ID",
  "적용일시",
  "작업자",
  "상태",
  "월 시트",
  "행",
  "판매 No.",
  "개통일",
  "판매 ID",
  "모델명",
  "스팟 번호",
  "적용 금액",
  "적용 조건",
  "변경 전 O열",
  "변경 후 O열",
  "변경 전 메모",
  "변경 후 메모",
  "되돌린 일시",
];
var WS_SPOT_BULK_COLS = WS_SPOT_BULK_HEADER.length;
var WS_SPOT_BULK_MAX_ITEMS = 300;
var WS_SPOT_BULK_MAX_CONDITIONS = 20;
var WS_SPOT_BULK_AMOUNT_MAX = 10000000;
var WS_SPOT_BULK_APPLIED = "적용";
var WS_SPOT_BULK_UNDONE = "되돌림";
var WS_SPOT_BULK_O_INDEX = 14; // O열 (0부터)
var WS_SPOT_BULK_MODEL_INDEX = 9; // J열

function wsSpotBulkReply_(obj) {
  obj.handler = WS_SPOT_BULK_HANDLER;
  return wsJson_(obj);
}
function wsSpotBulkFail_(message) {
  return wsSpotBulkReply_({ ok: false, message: message });
}

function wsSpotBulkModel_(v) {
  return String(v === null || v === undefined ? "" : v).trim().replace(/\s+/g, " ").toUpperCase();
}

function wsSpotBulkIsDate_(t) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(t)) return false;
  var d = new Date(t + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t;
}

/** 금액 표기 (웹앱 lib/spot-bulk.ts spotAmountText 와 같음): 만원 단위면 "3만", 아니면 "35,500원" */
function wsSpotBulkAmountText_(amount) {
  if (amount % 10000 === 0) return amount / 10000 + "만";
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "원";
}

/** 기존 메모 + 새 줄 (웹앱 noteAfter 와 같음) */
function wsSpotBulkNoteAfter_(before, adds) {
  var parts = [];
  var base = String(before || "").trim();
  if (base) parts.push(base);
  for (var i = 0; i < adds.length; i++) parts.push("스팟" + adds[i].spot + " " + wsSpotBulkAmountText_(adds[i].amount));
  return parts.join("\n");
}

/** 메모에 적힌 스팟 번호 ("스팟1 3만", "스팟 11", "SPOT2: 5만") */
function wsSpotBulkSpotsInNote_(note) {
  var out = {};
  var lines = String(note || "").split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var m = /^(?:스\s*팟|spot)\s*(\d{1,3})(?!\d)/i.exec(lines[i].trim());
    if (m) out[Number(m[1])] = true;
  }
  return out;
}

/** O열 값 → 숫자 (빈칸·"-" = 0). 숫자로 읽을 수 없는 글자면 null */
function wsSpotBulkONumber_(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  var t = String(v === null || v === undefined ? "" : v).trim().replace(/^'/, "");
  if (t === "" || t === "-") return 0;
  var n = t.replace(/,/g, "").replace(/원$/, "");
  return /^-?\d+(\.\d+)?$/.test(n) ? Number(n) : null;
}

function wsSpotBulkHeaderProblem_(sheet) {
  var header = sheet.getRange(1, 1, 1, WS_SPOT_BULK_COLS).getValues()[0];
  for (var i = 0; i < WS_SPOT_BULK_COLS; i++) {
    if (String(header[i]).trim() !== WS_SPOT_BULK_HEADER[i]) {
      return wsColumnLetter_(i + 1) + "1 칸 제목이 '" + WS_SPOT_BULK_HEADER[i] + "'가 아닙니다.";
    }
  }
  return "";
}

function wsSpotBulkSheet_(ss, create) {
  var sheet = ss.getSheetByName(WS_SPOT_BULK_SHEET);
  if (!sheet && create) sheet = ss.insertSheet(WS_SPOT_BULK_SHEET);
  if (sheet && create && sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, WS_SPOT_BULK_COLS).setValues([WS_SPOT_BULK_HEADER]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** 이력 전체 → [{ row, values }] */
function wsSpotBulkHistoryRows_(sheet, tz) {
  var out = [];
  if (!sheet || sheet.getLastRow() < 2) return out;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, WS_SPOT_BULK_COLS).getValues();
  for (var i = 0; i < values.length; i++) {
    var r = values[i].map(function (v) {
      return v instanceof Date ? Utilities.formatDate(v, tz, "yyyy-MM-dd HH:mm:ss") : String(v === null || v === undefined ? "" : v);
    });
    if (!r[0]) continue;
    out.push({ row: i + 2, values: r });
  }
  return out;
}

/** 조건 확인 → { list, byId } 또는 { error } */
function wsSpotBulkConditions_(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > WS_SPOT_BULK_MAX_CONDITIONS) {
    return { error: "적용 조건 형식이 올바르지 않습니다." };
  }
  var byId = {};
  for (var i = 0; i < raw.length; i++) {
    var c = raw[i] || {};
    var id = String(c.id || "");
    var models = Array.isArray(c.models) ? c.models : null;
    if (
      !/^[A-Za-z0-9-]{1,40}$/.test(id) ||
      byId[id] ||
      !wsSpotBulkIsDate_(String(c.from)) ||
      !wsSpotBulkIsDate_(String(c.to)) ||
      String(c.from) > String(c.to) ||
      typeof c.spot !== "number" ||
      Math.floor(c.spot) !== c.spot ||
      c.spot < 1 ||
      c.spot > 999 ||
      typeof c.amount !== "number" ||
      Math.floor(c.amount) !== c.amount ||
      c.amount < 1 ||
      c.amount > WS_SPOT_BULK_AMOUNT_MAX ||
      !models ||
      models.length > 20
    ) {
      return { error: "적용 조건 형식이 올바르지 않습니다." };
    }
    var modelSet = {};
    var modelList = [];
    for (var m = 0; m < models.length; m++) {
      var nm = wsSpotBulkModel_(models[m]);
      if (!nm) return { error: "적용 조건 형식이 올바르지 않습니다." };
      if (!modelSet[nm]) modelList.push(nm);
      modelSet[nm] = true;
    }
    byId[id] = {
      id: id,
      from: String(c.from),
      to: String(c.to),
      spot: c.spot,
      amount: c.amount,
      models: modelSet,
      modelCount: modelList.length,
      text: String(c.from) + "~" + String(c.to) + " / " + (modelList.length ? modelList.join(",") : "전체 모델") + " / 스팟" + c.spot + " / " + c.amount + "원",
    };
  }
  return { byId: byId };
}

function wsHandleSpotBulk_(body) {
  if (!wsAuthorized_(body)) return wsSpotBulkFail_("인증에 실패했습니다.");
  var op = String(body.op || "");
  var ss = wsSpreadsheet_();
  var tz = ss.getSpreadsheetTimeZone();

  if (op === "history") {
    var hs = wsSpotBulkSheet_(ss, false);
    if (hs && hs.getLastRow() > 0) {
      var hp = wsSpotBulkHeaderProblem_(hs);
      if (hp) return wsSpotBulkFail_(WS_SPOT_BULK_SHEET + " 시트 제목이 웹앱과 다릅니다 (" + hp + ")");
    }
    var groups = {};
    var order = [];
    var rows = wsSpotBulkHistoryRows_(hs, tz);
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i].values;
      var g = groups[v[0]];
      if (!g) {
        g = { requestId: v[0], appliedAt: v[1], operator: v[2], conditions: {}, sales: 0, amount: 0, applied: 0, undone: 0 };
        groups[v[0]] = g;
        order.push(v[0]);
      }
      g.sales++;
      g.amount += Number(v[11]) || 0;
      if (v[3] === WS_SPOT_BULK_UNDONE) g.undone++;
      else g.applied++;
      var parts = String(v[12]).split(" | ");
      for (var p = 0; p < parts.length; p++) if (parts[p]) g.conditions[parts[p]] = true;
    }
    var list = [];
    for (var k = order.length - 1; k >= 0 && list.length < 20; k--) {
      var x = groups[order[k]];
      list.push({
        requestId: x.requestId,
        appliedAt: x.appliedAt,
        operator: x.operator,
        conditions: Object.keys(x.conditions).join(" | "),
        sales: x.sales,
        amount: x.amount,
        status: x.undone === 0 ? WS_SPOT_BULK_APPLIED : x.applied === 0 ? WS_SPOT_BULK_UNDONE : "일부 되돌림",
      });
    }
    return wsSpotBulkReply_({ ok: true, items: list });
  }

  if (op !== "apply" && op !== "undo") return wsSpotBulkFail_("요청 형식이 올바르지 않습니다.");
  var requestId = String(body.requestId || "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(requestId)) return wsSpotBulkFail_("요청 ID 형식이 올바르지 않습니다.");

  var cond = null;
  var items = null;
  if (op === "apply") {
    cond = wsSpotBulkConditions_(body.conditions);
    if (cond.error) return wsSpotBulkFail_(cond.error);
    items = body.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > WS_SPOT_BULK_MAX_ITEMS) {
      return wsSpotBulkFail_("한 번에 1~" + WS_SPOT_BULK_MAX_ITEMS + "건까지 등록할 수 있습니다.");
    }
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return wsSpotBulkFail_("다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.");
  try {
    var stamp = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss");
    if (op === "undo") return wsSpotBulkUndo_(ss, tz, requestId, stamp);
    return wsSpotBulkApply_(ss, tz, requestId, cond.byId, items, String(body.operator || "관리자").slice(0, 20), stamp);
  } finally {
    lock.releaseLock();
  }
}

function wsSpotBulkApply_(ss, tz, requestId, conditions, items, operator, stamp) {
  var hist = wsSpotBulkSheet_(ss, true);
  var hp = wsSpotBulkHeaderProblem_(hist);
  if (hp) return wsSpotBulkFail_(WS_SPOT_BULK_SHEET + " 시트 제목이 웹앱과 다릅니다 (" + hp + ") 저장하지 않았습니다.");

  // 같은 요청 ID 가 이미 처리됐으면 다시 쓰지 않는다
  var past = wsSpotBulkHistoryRows_(hist, tz).filter(function (h) {
    return h.values[0] === requestId;
  });
  if (past.length > 0) {
    var amount0 = 0;
    for (var a0 = 0; a0 < past.length; a0++) amount0 += Number(past[a0].values[11]) || 0;
    return wsSpotBulkReply_({
      ok: true,
      repeated: true,
      requestId: requestId,
      applied: past.length,
      failed: 0,
      amount: amount0,
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
    var adds = Array.isArray(it.adds) ? it.adds : [];
    var addOk = adds.length > 0;
    var addSpots = {};
    var cleanAdds = [];
    for (var a = 0; a < adds.length && addOk; a++) {
      var ad = adds[a] || {};
      var c = conditions[String(ad.conditionId || "")];
      if (!c || ad.spot !== c.spot || ad.amount !== c.amount || addSpots[c.spot]) addOk = false;
      else {
        addSpots[c.spot] = true;
        cleanAdds.push({ spot: c.spot, amount: c.amount, cond: c });
      }
    }
    if (!addOk) {
      fail("적용할 스팟 형식이 올바르지 않습니다.");
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
      fail("해당 행이 장표에 없습니다.");
      continue;
    }
    var sheet = cache.sheet;
    var range = sheet.getRange(rowNumber, 1, 1, WS_COLUMN_COUNT);
    var cur = range.getValues()[0];
    var oFormula = sheet.getRange(rowNumber, WS_SPOT_BULK_O_INDEX + 1).getFormulas()[0][0];
    var oCell = sheet.getRange(rowNumber, WS_SPOT_BULK_O_INDEX + 1);
    var curNote = String(oCell.getNote() || "").trim();
    if (wsIsEmptySale_(cur)) {
      fail("판매 내용이 없는 행입니다 (삭제된 판매).");
      continue;
    }
    var mism = [];
    if (text(cur[WS_B_INDEX]) !== text(it.no)) mism.push("No.");
    if (text(cur[2]) !== text(it.activatedAt)) mism.push("개통일");
    if (text(cur[3]) !== text(it.customer)) mism.push("고객");
    if (digits(cur[4]) !== digits(it.ctn)) mism.push("CTN");
    if (wsSpotBulkModel_(cur[WS_SPOT_BULK_MODEL_INDEX]) !== wsSpotBulkModel_(it.model)) mism.push("모델");
    if (mism.length > 0) {
      fail("장표 내용이 화면과 달라 적용하지 않았습니다 (" + mism.join(", ") + "). 다시 조회해 주세요.");
      continue;
    }
    var date = text(cur[2]);
    if (!wsSpotBulkIsDate_(date)) {
      fail("개통일이 날짜가 아니라 적용하지 않았습니다.");
      continue;
    }
    if (/취소|철회/.test(text(cur[8]))) {
      fail("개통구분이 취소 판매라 적용하지 않았습니다.");
      continue;
    }
    var model = wsSpotBulkModel_(cur[WS_SPOT_BULK_MODEL_INDEX]);
    var condProblem = "";
    for (var ca = 0; ca < cleanAdds.length; ca++) {
      var cc = cleanAdds[ca].cond;
      if (date < cc.from || date > cc.to) condProblem = "개통일이 조건 기간 밖입니다.";
      else if (cc.modelCount > 0 && !cc.models[model]) condProblem = "모델이 조건과 다릅니다.";
    }
    if (condProblem) {
      fail(condProblem + " 적용하지 않았습니다.");
      continue;
    }
    if (oFormula) {
      fail("O열이 수식 칸이라 적용하지 않았습니다.");
      continue;
    }
    var curO = wsSpotBulkONumber_(cur[WS_SPOT_BULK_O_INDEX]);
    if (curO === null) {
      fail("O열 값이 숫자가 아니라 적용하지 않았습니다.");
      continue;
    }
    if (wsComparable_(cur[WS_SPOT_BULK_O_INDEX], tz) !== wsComparable_(String(it.beforeO === undefined ? "" : it.beforeO), tz)) {
      fail("O열 금액이 화면과 달라 적용하지 않았습니다 (그사이 바뀜). 다시 조회해 주세요.");
      continue;
    }
    if (curNote !== String(it.beforeNote || "").trim()) {
      fail("O열 메모가 화면과 달라 적용하지 않았습니다 (그사이 바뀜). 다시 조회해 주세요.");
      continue;
    }
    var already = wsSpotBulkSpotsInNote_(curNote);
    var dup = "";
    for (var d = 0; d < cleanAdds.length; d++) if (already[cleanAdds[d].spot]) dup = "스팟" + cleanAdds[d].spot;
    if (dup) {
      fail("이미 " + dup + " 이(가) 등록된 판매라 적용하지 않았습니다.");
      continue;
    }
    var addAmount = 0;
    for (var s = 0; s < cleanAdds.length; s++) addAmount += cleanAdds[s].amount;
    var saleId = "";
    try {
      if (typeof wsSaleIdFromNote_ === "function") saleId = wsSaleIdFromNote_(sheet.getRange(rowNumber, 3).getNote()) || "";
    } catch (err) {
      saleId = "";
    }
    writes.push({
      res: res,
      cell: oCell,
      sheetName: sheetName,
      row: rowNumber,
      beforeRaw: cur[WS_SPOT_BULK_O_INDEX],
      afterO: curO + addAmount,
      beforeNote: curNote,
      afterNote: wsSpotBulkNoteAfter_(curNote, cleanAdds),
      addAmount: addAmount,
      history: [
        requestId,
        stamp,
        operator,
        WS_SPOT_BULK_APPLIED,
        sheetName,
        rowNumber,
        text(cur[WS_B_INDEX]),
        date,
        saleId,
        model,
        cleanAdds
          .map(function (x) {
            return "스팟" + x.spot;
          })
          .join(", "),
        addAmount,
        cleanAdds
          .map(function (x) {
            return x.cond.text;
          })
          .join(" | "),
        String(cur[WS_SPOT_BULK_O_INDEX] === null || cur[WS_SPOT_BULK_O_INDEX] === undefined ? "" : cur[WS_SPOT_BULK_O_INDEX]),
        String(curO + addAmount),
        curNote,
        "",
        "",
      ],
    });
  }

  // 쓰기: O열 값(숫자)·메모만. 이력은 같은 요청의 모든 판매를 한 번에
  for (var w = 0; w < writes.length; w++) {
    writes[w].cell.setValue(writes[w].afterO);
    writes[w].cell.setNote(writes[w].afterNote);
    writes[w].history[16] = writes[w].afterNote;
  }
  if (writes.length > 0) {
    var start = Math.max(hist.getLastRow(), 1) + 1;
    var hr = hist.getRange(start, 1, writes.length, WS_SPOT_BULK_COLS);
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
  var amount = 0;
  for (var r = 0; r < writes.length; r++) {
    var wr = writes[r];
    var nowV = wsSpotBulkONumber_(wr.cell.getValues()[0][0]);
    var nowN = String(wr.cell.getNote() || "").trim();
    if (nowV === wr.afterO && nowN === wr.afterNote) {
      wr.res.ok = true;
      wr.res.message = "적용";
      applied++;
      amount += wr.addAmount;
    } else {
      wr.res.message = "저장 후 확인에 실패했습니다. 장표 O열을 확인해 주세요.";
    }
  }
  return wsSpotBulkReply_({
    ok: true,
    repeated: false,
    requestId: requestId,
    applied: applied,
    failed: results.length - applied,
    amount: amount,
    results: results,
    message: applied + "건 적용" + (results.length - applied > 0 ? ", " + (results.length - applied) + "건 실패" : ""),
  });
}

/** 되돌리기: 이력의 변경 전 값으로. 지금 값이 이력의 변경 후 값과 같을 때만 */
function wsSpotBulkUndo_(ss, tz, requestId, stamp) {
  var hist = wsSpotBulkSheet_(ss, false);
  if (!hist) return wsSpotBulkFail_("일괄등록 이력이 없습니다.");
  var hp = wsSpotBulkHeaderProblem_(hist);
  if (hp) return wsSpotBulkFail_(WS_SPOT_BULK_SHEET + " 시트 제목이 웹앱과 다릅니다 (" + hp + ")");
  var rows = wsSpotBulkHistoryRows_(hist, tz).filter(function (h) {
    return h.values[0] === requestId && h.values[3] === WS_SPOT_BULK_APPLIED;
  });
  if (rows.length === 0) return wsSpotBulkFail_("되돌릴 수 있는 일괄등록이 없습니다 (이미 되돌렸거나 없는 요청).");
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
    var cur = sheet.getRange(rowNumber, 1, 1, WS_COLUMN_COUNT).getValues()[0];
    if (wsText_(cur[2], tz) !== v[7] || wsText_(cur[WS_B_INDEX], tz) !== v[6] || wsSpotBulkModel_(cur[WS_SPOT_BULK_MODEL_INDEX]) !== v[9]) {
      skipped.push(label + ": 판매 식별값이 이력과 다름");
      continue;
    }
    var cell = sheet.getRange(rowNumber, WS_SPOT_BULK_O_INDEX + 1);
    if (cell.getFormulas()[0][0] || wsComparable_(cur[WS_SPOT_BULK_O_INDEX], tz) !== wsComparable_(v[14], tz) || String(cell.getNote() || "").trim() !== v[16]) {
      skipped.push(label + ": 등록 후 O열 금액·메모가 바뀌어 건너뜀");
      continue;
    }
    var before = v[13];
    var bn = before.replace(/,/g, "");
    cell.setValue(before === "" ? "" : /^-?\d+(\.\d+)?$/.test(bn) ? Number(bn) : before);
    if (v[15]) cell.setNote(v[15]);
    else cell.clearNote();
    hist.getRange(rows[i].row, 4).setValue(WS_SPOT_BULK_UNDONE);
    hist.getRange(rows[i].row, 18).setValue(stamp);
    restored++;
  }
  SpreadsheetApp.flush();
  return wsSpotBulkReply_({
    ok: true,
    restored: restored,
    skipped: skipped,
    message: restored + "건 되돌림" + (skipped.length ? ", " + skipped.length + "건 건너뜀" : ""),
  });
}
