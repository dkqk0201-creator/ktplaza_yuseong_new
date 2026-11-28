/**
 * 무선 판매 관리 웹앱 — 기타 예산 (Apps Script 에 새 파일 other-budget.gs 로 추가)
 *
 * 고객혜택과 별도로 점장이 직접 등록하는 확보(+)·차감(-) 예산. 같은 스프레드시트의 별도 시트에만 저장한다:
 *   "기타예산내역"     — 항목 1건 = 1행 (고유 ID·적용 월·항목명·구분·금액·메모·등록/수정일시·상태·삭제일시)
 *   "기타예산변경이력" — 등록·수정·삭제·복구마다 1행 (변경 전/후 금액·내용)
 *   - 월별 무선장표(N·U·AB·AC 수식·판매정보)·양식 시트에는 아무것도 쓰지 않는다.
 *     → 고객혜택·스팟·현금예산·고불비·AC열 계산값은 바뀌지 않는다. 웹앱이 최종 매장 총예산에만 더한다.
 *   - 시트가 없으면 첫 등록 때 자동으로 만들고 1행에 제목을 쓴다. 조회만 할 때는 만들지 않는다.
 *   - 1행 제목이 아래와 다르면 아무것도 쓰지 않는다.
 *   - 금액은 항상 양수로 저장하고 구분(확보/차감)으로 부호를 정한다.
 *   - 삭제는 행을 지우지 않고 상태 "삭제" + 삭제일시. 삭제된 항목은 복구(restore)할 수 있다.
 *   - 고유 ID 는 웹앱이 입력창을 열 때 만든다. 같은 ID 로 다시 오면 새로 쓰지 않는다 (중복 등록 방지).
 *   - 수정·삭제·복구는 화면에서 본 값(before)이 지금 시트 값과 같을 때만.
 *   - 저장 후 다시 읽어 확인한다. LockService 로 한 번에 하나만 처리한다.
 *
 * 요청 (update-handler.gs 의 wsHandleSaleUpdate_ 가 이 action 을 넘겨준다 → doPost 수정 불필요):
 *   { secret, action: "other-budget", op: "list",    month: "2026-11" }
 *   { secret, action: "other-budget", op: "create",  month, id, name, kind: "gain"|"deduct", amount, memo }
 *   { secret, action: "other-budget", op: "update",  id, before: { name, kind, amount, memo, updatedAt }, name, kind, amount, memo }
 *   { secret, action: "other-budget", op: "delete",  id, before }
 *   { secret, action: "other-budget", op: "restore", id, before }
 * 응답: { ok, handler: "ws-other-budget", message, ... }
 *   list → { month, items, deleted, gain, deduct, net, invalidRows }
 */
var WS_OTHER_HANDLER = "ws-other-budget";
var WS_OTHER_SHEET = "기타예산내역";
var WS_OTHER_HISTORY_SHEET = "기타예산변경이력";
var WS_OTHER_HEADER = ["고유 ID", "적용 월", "항목명", "구분", "금액", "메모", "등록일시", "수정일시", "상태", "삭제일시"];
var WS_OTHER_HISTORY_HEADER = ["일시", "고유 ID", "작업", "적용 월", "항목명", "구분", "변경 전 금액", "변경 후 금액", "변경 전 내용", "변경 후 내용"];
var WS_OTHER_COLS = WS_OTHER_HEADER.length;
var WS_OTHER_ACTIVE = "사용";
var WS_OTHER_DELETED = "삭제";
var WS_OTHER_KIND_TEXT = { gain: "확보", deduct: "차감" };
var WS_OTHER_NAME_MAX = 40;
var WS_OTHER_MEMO_MAX = 100;
var WS_OTHER_AMOUNT_MAX = 100000000;

function wsOtherReply_(obj) {
  obj.handler = WS_OTHER_HANDLER;
  return wsJson_(obj);
}
function wsOtherFail_(message, extra) {
  var obj = { ok: false, message: message };
  if (extra) for (var k in extra) obj[k] = extra[k];
  return wsOtherReply_(obj);
}

function wsOtherHeaderProblem_(sheet, header) {
  if (sheet.getLastRow() < 1) return "제목 행이 없습니다.";
  var row = sheet.getRange(1, 1, 1, header.length).getValues()[0];
  for (var i = 0; i < header.length; i++) {
    if (String(row[i]).trim() !== header[i]) {
      return wsColumnLetter_(i + 1) + "1 칸 제목이 '" + header[i] + "'가 아닙니다 (지금: '" + String(row[i]) + "').";
    }
  }
  return "";
}

function wsOtherSheetOf_(ss, name, header, create) {
  var sheet = ss.getSheetByName(name);
  if (!sheet && create) sheet = ss.insertSheet(name);
  if (sheet && create && sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function wsOtherAmount_(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  var t = String(v === null || v === undefined ? "" : v).replace(/[\s,]/g, "").replace(/원$/, "");
  return /^\d+$/.test(t) ? Number(t) : null;
}

function wsOtherStamp_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, "yyyy-MM-dd HH:mm:ss");
  return String(v === null || v === undefined ? "" : v).trim();
}

function wsOtherMonthText_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, "yyyy-MM");
  return String(v === null || v === undefined ? "" : v).trim().replace(/^'/, "");
}

function wsOtherRead_(sheet, tz) {
  var out = [];
  if (!sheet || sheet.getLastRow() < 2) return out;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, WS_OTHER_COLS).getValues();
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var id = String(r[0]).trim();
    if (!id && String(r[2]).trim() === "" && String(r[4]).trim() === "") continue;
    var month = wsOtherMonthText_(r[1], tz);
    var kindText = String(r[3]).trim();
    var kind = kindText === "확보" ? "gain" : kindText === "차감" ? "deduct" : "";
    var amount = wsOtherAmount_(r[4]);
    var status = String(r[8]).trim() || WS_OTHER_ACTIVE;
    out.push({
      row: i + 2,
      id: id,
      month: month,
      name: String(r[2]).trim().replace(/^'/, ""),
      kind: kind,
      amount: amount,
      memo: String(r[5]).trim().replace(/^'/, ""),
      createdAt: wsOtherStamp_(r[6], tz),
      updatedAt: wsOtherStamp_(r[7], tz),
      status: status,
      deletedAt: wsOtherStamp_(r[9], tz),
      valid:
        !!id &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(month) &&
        !!kind &&
        amount !== null &&
        amount >= 1 &&
        (status === WS_OTHER_ACTIVE || status === WS_OTHER_DELETED),
    });
  }
  return out;
}

function wsOtherView_(rec) {
  return {
    id: rec.id,
    month: rec.month,
    name: rec.name,
    kind: rec.kind,
    amount: rec.amount,
    memo: rec.memo,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    deletedAt: rec.deletedAt,
  };
}

/** 글자 칸은 항상 ' 를 붙여 쓴다 (수식·날짜·숫자로 바뀌지 않게) */
function wsOtherText_(t) {
  return "'" + t;
}

function wsOtherInput_(body) {
  var name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { error: "예산 항목명을 입력해 주세요." };
  if (name.length > WS_OTHER_NAME_MAX) return { error: "항목명은 " + WS_OTHER_NAME_MAX + "자 이하로 입력해 주세요." };
  if (/[\r\n\t]/.test(name)) return { error: "항목명은 한 줄로 입력해 주세요." };
  if (body.kind !== "gain" && body.kind !== "deduct") return { error: "구분(확보/차감)을 선택해 주세요." };
  var amount = body.amount;
  if (typeof amount !== "number" || !isFinite(amount) || Math.floor(amount) !== amount || amount < 1 || amount > WS_OTHER_AMOUNT_MAX) {
    return { error: "금액은 1원 이상 " + WS_OTHER_AMOUNT_MAX + "원 이하의 정수로 입력해 주세요." };
  }
  var memo = typeof body.memo === "string" ? body.memo.trim() : "";
  if (memo.length > WS_OTHER_MEMO_MAX) return { error: "메모는 " + WS_OTHER_MEMO_MAX + "자 이하로 입력해 주세요." };
  if (/[\r\n\t]/.test(memo)) return { error: "메모는 한 줄로 입력해 주세요." };
  return { name: name, kind: body.kind, amount: amount, memo: memo };
}

function wsOtherFind_(records, id) {
  return records.filter(function (r) {
    return r.id === id;
  });
}

function wsOtherSameAsBefore_(rec, before) {
  return (
    !!before &&
    rec.name === String(before.name) &&
    rec.kind === String(before.kind) &&
    rec.amount === Number(before.amount) &&
    rec.memo === String(before.memo) &&
    rec.updatedAt === String(before.updatedAt)
  );
}

function wsOtherSummary_(rec) {
  return rec ? rec.name + " / " + WS_OTHER_KIND_TEXT[rec.kind] + " / " + rec.memo : "";
}

function wsOtherLog_(ss, stamp, op, rec, beforeRec) {
  var h = wsOtherSheetOf_(ss, WS_OTHER_HISTORY_SHEET, WS_OTHER_HISTORY_HEADER, true);
  if (wsOtherHeaderProblem_(h, WS_OTHER_HISTORY_HEADER)) throw new Error("변경이력 시트 제목이 다릅니다.");
  var row = Math.max(h.getLastRow(), 1) + 1;
  var r = h.getRange(row, 1, 1, WS_OTHER_HISTORY_HEADER.length);
  r.setNumberFormat("@");
  r.setValues([
    [
      stamp,
      rec.id,
      op,
      rec.month,
      rec.name,
      WS_OTHER_KIND_TEXT[rec.kind] || "",
      beforeRec ? String(beforeRec.amount) : "",
      op === "삭제" ? "" : String(rec.amount),
      beforeRec ? wsOtherSummary_(beforeRec) : "",
      op === "삭제" ? "" : wsOtherSummary_(rec),
    ],
  ]);
}

function wsHandleOtherBudget_(body) {
  if (!wsAuthorized_(body)) return wsOtherFail_("인증에 실패했습니다.");
  var op = String(body.op || "");
  var ss = wsSpreadsheet_();
  var tz = ss.getSpreadsheetTimeZone();

  if (op === "list") {
    var month = String(body.month || "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return wsOtherFail_("월 형식이 올바르지 않습니다.");
    var sheet = wsOtherSheetOf_(ss, WS_OTHER_SHEET, WS_OTHER_HEADER, false);
    if (sheet && sheet.getLastRow() > 0) {
      var problem = wsOtherHeaderProblem_(sheet, WS_OTHER_HEADER);
      if (problem) return wsOtherFail_(WS_OTHER_SHEET + " 시트 제목이 웹앱과 다릅니다 (" + problem + ") 금액을 잘못 읽지 않도록 불러오지 않았습니다.");
    }
    var items = [];
    var deleted = [];
    var gain = 0;
    var deduct = 0;
    var invalidRows = 0;
    var records = wsOtherRead_(sheet, tz);
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (!rec.valid) {
        if (!/^\d{4}-\d{2}$/.test(rec.month) || rec.month === month) invalidRows++;
        continue;
      }
      if (rec.month !== month) continue;
      if (rec.status === WS_OTHER_DELETED) {
        deleted.push(wsOtherView_(rec));
        continue;
      }
      items.push(wsOtherView_(rec));
      if (rec.kind === "gain") gain += rec.amount;
      else deduct += rec.amount;
    }
    return wsOtherReply_({
      ok: true,
      month: month,
      items: items,
      deleted: deleted,
      gain: gain,
      deduct: deduct,
      net: gain - deduct,
      invalidRows: invalidRows,
      sheetExists: !!sheet,
    });
  }

  if (op !== "create" && op !== "update" && op !== "delete" && op !== "restore") return wsOtherFail_("요청 형식이 올바르지 않습니다.");
  var id = String(body.id || "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return wsOtherFail_("고유 ID 형식이 올바르지 않습니다.");
  var input = null;
  if (op === "create" || op === "update") {
    input = wsOtherInput_(body);
    if (input.error) return wsOtherFail_(input.error);
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return wsOtherFail_("다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.");
  try {
    var stamp = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss");
    var create = op === "create";
    var sh = wsOtherSheetOf_(ss, WS_OTHER_SHEET, WS_OTHER_HEADER, create);
    if (!sh) return wsOtherFail_("기타 예산 내역이 없습니다. 화면을 새로고침해 주세요.");
    var hp = wsOtherHeaderProblem_(sh, WS_OTHER_HEADER);
    if (hp) return wsOtherFail_(WS_OTHER_SHEET + " 시트 제목이 웹앱과 다릅니다 (" + hp + ") 저장하지 않았습니다.");
    var hist = wsOtherSheetOf_(ss, WS_OTHER_HISTORY_SHEET, WS_OTHER_HISTORY_HEADER, false);
    if (hist && hist.getLastRow() > 0) {
      var hhp = wsOtherHeaderProblem_(hist, WS_OTHER_HISTORY_HEADER);
      if (hhp) return wsOtherFail_(WS_OTHER_HISTORY_SHEET + " 시트 제목이 웹앱과 다릅니다 (" + hhp + ") 저장하지 않았습니다.");
    }
    var found = wsOtherFind_(wsOtherRead_(sh, tz), id);

    if (create) {
      var month2 = String(body.month || "");
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month2) || month2 < "2024-01" || month2 > "2099-12") return wsOtherFail_("적용 월 형식이 올바르지 않습니다.");
      if (found.length > 0) {
        var ex = found[0];
        if (found.length === 1 && ex.month === month2 && ex.name === input.name && ex.kind === input.kind && ex.amount === input.amount && ex.memo === input.memo) {
          return wsOtherReply_({ ok: true, duplicate: true, item: wsOtherView_(ex), message: "이미 등록된 항목입니다 (다시 저장하지 않음)." });
        }
        return wsOtherFail_("같은 고유 ID 의 항목이 이미 있어 저장하지 않았습니다. 화면을 새로고침해 주세요.");
      }
      var newRow = Math.max(sh.getLastRow(), 1) + 1;
      sh.getRange(newRow, 1, 1, 2).setNumberFormat("@");
      sh.getRange(newRow, 4, 1, 1).setNumberFormat("@");
      sh.getRange(newRow, 7, 1, 4).setNumberFormat("@");
      sh.getRange(newRow, 1, 1, WS_OTHER_COLS).setValues([
        [id, month2, wsOtherText_(input.name), WS_OTHER_KIND_TEXT[input.kind], input.amount, wsOtherText_(input.memo), stamp, stamp, WS_OTHER_ACTIVE, ""],
      ]);
      SpreadsheetApp.flush();
      var saved = wsOtherFind_(wsOtherRead_(sh, tz), id);
      if (saved.length !== 1 || !saved[0].valid || saved[0].amount !== input.amount || saved[0].name !== input.name || saved[0].kind !== input.kind) {
        return wsOtherFail_("저장 후 확인에 실패했습니다. 구글시트의 " + WS_OTHER_SHEET + " 시트를 확인해 주세요.");
      }
      try {
        wsOtherLog_(ss, stamp, "등록", saved[0], null);
      } catch (err) {
        // 이력 기록 실패: 저장은 됐으므로 알림만
        return wsOtherReply_({ ok: true, duplicate: false, item: wsOtherView_(saved[0]), historySaved: false, message: "기타 예산을 등록했습니다 (변경이력 기록 실패)." });
      }
      return wsOtherReply_({ ok: true, duplicate: false, item: wsOtherView_(saved[0]), message: "기타 예산을 등록했습니다." });
    }

    if (found.length !== 1) {
      return wsOtherFail_(found.length === 0 ? "해당 항목을 찾지 못했습니다. 화면을 새로고침해 주세요." : "같은 고유 ID 의 항목이 2건 이상이라 고치지 않았습니다. 구글시트를 확인해 주세요.");
    }
    var rec2 = found[0];
    var wantStatus = op === "restore" ? WS_OTHER_DELETED : WS_OTHER_ACTIVE;
    if (!rec2.valid || rec2.status !== wantStatus) {
      return wsOtherFail_(op === "restore" ? "삭제된 항목이 아닙니다. 화면을 새로고침해 주세요." : "이미 삭제되었거나 형식이 올바르지 않은 항목입니다. 화면을 새로고침해 주세요.");
    }
    if (!wsOtherSameAsBefore_(rec2, body.before)) {
      return wsOtherFail_("그사이 항목이 바뀌어 저장하지 않았습니다. 화면을 새로고침한 뒤 다시 확인해 주세요.", { current: wsOtherView_(rec2) });
    }

    if (op === "update") {
      sh.getRange(rec2.row, 4, 1, 1).setNumberFormat("@");
      sh.getRange(rec2.row, 8, 1, 1).setNumberFormat("@");
      sh.getRange(rec2.row, 3, 1, 4).setValues([[wsOtherText_(input.name), WS_OTHER_KIND_TEXT[input.kind], input.amount, wsOtherText_(input.memo)]]);
      sh.getRange(rec2.row, 8).setValue(stamp);
    } else if (op === "delete") {
      sh.getRange(rec2.row, 8, 1, 3).setNumberFormat("@");
      sh.getRange(rec2.row, 8, 1, 3).setValues([[stamp, WS_OTHER_DELETED, stamp]]);
    } else {
      sh.getRange(rec2.row, 8, 1, 3).setNumberFormat("@");
      sh.getRange(rec2.row, 8, 1, 3).setValues([[stamp, WS_OTHER_ACTIVE, ""]]);
    }
    SpreadsheetApp.flush();
    var after = wsOtherFind_(wsOtherRead_(sh, tz), id);
    var okAfter =
      after.length === 1 &&
      after[0].valid &&
      (op === "update"
        ? after[0].amount === input.amount && after[0].name === input.name && after[0].kind === input.kind && after[0].memo === input.memo && after[0].status === WS_OTHER_ACTIVE
        : after[0].status === (op === "delete" ? WS_OTHER_DELETED : WS_OTHER_ACTIVE));
    if (!okAfter) return wsOtherFail_("저장 후 확인에 실패했습니다. 구글시트의 " + WS_OTHER_SHEET + " 시트를 확인해 주세요.");
    var opText = op === "update" ? "수정" : op === "delete" ? "삭제" : "복구";
    var historySaved = true;
    try {
      wsOtherLog_(ss, stamp, opText, after[0], rec2);
    } catch (err) {
      historySaved = false;
    }
    return wsOtherReply_({
      ok: true,
      item: wsOtherView_(after[0]),
      historySaved: historySaved,
      message: "기타 예산을 " + opText + "했습니다." + (historySaved ? "" : " (변경이력 기록 실패)"),
    });
  } finally {
    lock.releaseLock();
  }
}
