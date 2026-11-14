/**
 * 무선 판매 관리 웹앱 — 고불비사용 내역 (Apps Script 에 새 파일 gobulbi.gs 로 추가)
 *
 * 예산관리 화면의 "고불비사용" 기록을 같은 스프레드시트의 별도 시트 "고불비사용내역" 에 보관한다.
 *   - 월별 무선장표(10월 등)·양식 시트에는 아무것도 쓰지 않는다 (N·U·AB·AC 수식·고객 판매정보 그대로).
 *   - 시트가 없으면 첫 등록 때 자동으로 만들고 1행에 제목을 쓴다 (숨기지 않음). 이미 있으면 그 시트를 쓴다.
 *     조회만 할 때는 시트를 만들지 않는다.
 *   - 1행 제목이 아래 WS_GOBULBI_HEADER 와 다르면 아무것도 쓰지 않는다 (잘못된 칸에 저장 방지).
 *   - 지급일 = 등록한 날(스프레드시트 시간대) 자동 기록, 수정 불가. 월별 합계는 지급일 기준.
 *   - 신규 등록은 이번 달만 (요청한 월이 오늘 날짜의 월과 다르면 거부).
 *   - 삭제는 행을 지우지 않고 상태 "삭제" + 삭제일시를 남긴다. 삭제된 내역은 목록·합계에서 뺀다.
 *   - 고유 ID 는 웹앱이 입력창을 열 때 만든다. 같은 ID 로 다시 오면(재전송·두 번 누름) 새로 쓰지 않는다.
 *   - 수정·삭제는 화면에서 본 값(before)이 지금 시트 값과 같을 때만 한다 (그사이 누가 고쳤으면 거부).
 *   - LockService 로 저장·수정·삭제를 한 번에 하나만 처리한다.
 *
 * 요청 (update-handler.gs 의 wsHandleSaleUpdate_ 가 이 action 을 넘겨준다 → doPost 수정 불필요):
 *   { secret, action: "gobulbi", op: "list",   month: "2026-10" }
 *   { secret, action: "gobulbi", op: "create", month: "2026-10", id, content, amount, seller }
 *   { secret, action: "gobulbi", op: "update", id, before: { content, amount, seller, updatedAt }, content, amount, seller }
 *   { secret, action: "gobulbi", op: "delete", id, before: { content, amount, seller, updatedAt } }
 * 응답: { ok, handler: "ws-gobulbi", message, ... }
 *   list   → { month, items: [{ id, payDate, content, amount, seller, createdAt, updatedAt }], total, invalidRows }
 *   create → { item, duplicate }   update → { item }   delete → { id }
 */
var WS_GOBULBI_HANDLER = "ws-gobulbi";
var WS_GOBULBI_SHEET = "고불비사용내역";
var WS_GOBULBI_HEADER = [
  "고유 ID",
  "지급일",
  "내용",
  "금액",
  "판매자",
  "등록일",
  "수정일",
  "상태",
  "삭제일시",
];
var WS_GOBULBI_COLS = WS_GOBULBI_HEADER.length;
var WS_GOBULBI_ACTIVE = "사용";
var WS_GOBULBI_DELETED = "삭제";
var WS_GOBULBI_CONTENT_MAX = 100;
var WS_GOBULBI_AMOUNT_MAX = 10000000;
var WS_GOBULBI_SELLER_MAX = 20;

function wsGobulbiReply_(obj) {
  obj.handler = WS_GOBULBI_HANDLER;
  return wsJson_(obj);
}

function wsGobulbiFail_(message, extra) {
  var obj = { ok: false, message: message };
  if (extra) {
    for (var k in extra) obj[k] = extra[k];
  }
  return wsGobulbiReply_(obj);
}

/** 1행 제목 확인: 맞으면 "", 다르면 문제 설명 */
function wsGobulbiHeaderProblem_(sheet) {
  if (sheet.getLastRow() < 1) return "제목 행이 없습니다.";
  var header = sheet.getRange(1, 1, 1, WS_GOBULBI_COLS).getValues()[0];
  for (var i = 0; i < WS_GOBULBI_COLS; i++) {
    if (String(header[i]).trim() !== WS_GOBULBI_HEADER[i]) {
      return (
        wsColumnLetter_(i + 1) +
        "1 칸 제목이 '" +
        WS_GOBULBI_HEADER[i] +
        "'가 아닙니다 (지금: '" +
        String(header[i]) +
        "')."
      );
    }
  }
  return "";
}

/** 고불비사용내역 시트. create 이면 없을 때 만들고 제목을 쓴다 (숨기지 않음) */
function wsGobulbiSheet_(ss, create) {
  var sheet = ss.getSheetByName(WS_GOBULBI_SHEET);
  if (!sheet && create) {
    sheet = ss.insertSheet(WS_GOBULBI_SHEET);
  }
  if (sheet && create && sheet.getLastRow() === 0) {
    // 새 시트(또는 직접 만든 빈 시트): 제목 행 + 글자 형식 (지급일이 날짜로, 내용이 수식으로 바뀌지 않게)
    sheet.getRange(1, 1, 1, WS_GOBULBI_COLS).setValues([WS_GOBULBI_HEADER]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** 금액 칸 → 원 (숫자·"50,000"·"50000원"). 해석 못 하면 null */
function wsGobulbiAmount_(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  var t = String(v === null || v === undefined ? "" : v)
    .replace(/[\s,]/g, "")
    .replace(/원$/, "");
  return /^-?\d+$/.test(t) ? Number(t) : null;
}

function wsGobulbiStamp_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, "yyyy-MM-dd HH:mm:ss");
  return String(v === null || v === undefined ? "" : v).trim();
}

/** 시트 전체 기록 → [{ row, id, payDate, content, amount, seller, createdAt, updatedAt, status, deletedAt, valid }] */
function wsGobulbiRead_(sheet, tz) {
  var out = [];
  if (!sheet) return out;
  var last = sheet.getLastRow();
  if (last < 2) return out;
  var rows = sheet.getRange(2, 1, last - 1, WS_GOBULBI_COLS).getValues();
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var id = String(r[0]).trim();
    if (!id && String(r[2]).trim() === "" && String(r[3]).trim() === "") continue; // 빈 행
    var payDate = wsText_(r[1], tz);
    var amount = wsGobulbiAmount_(r[3]);
    var status = String(r[7]).trim() || WS_GOBULBI_ACTIVE;
    out.push({
      row: i + 2,
      id: id,
      payDate: payDate,
      content: String(r[2]).trim(),
      amount: amount,
      seller: String(r[4]).trim(),
      createdAt: wsGobulbiStamp_(r[5], tz),
      updatedAt: wsGobulbiStamp_(r[6], tz),
      status: status,
      deletedAt: wsGobulbiStamp_(r[8], tz),
      valid:
        !!id &&
        /^\d{4}-\d{2}-\d{2}$/.test(payDate) &&
        amount !== null &&
        (status === WS_GOBULBI_ACTIVE || status === WS_GOBULBI_DELETED),
    });
  }
  return out;
}

function wsGobulbiView_(rec) {
  return {
    id: rec.id,
    payDate: rec.payDate,
    content: rec.content,
    amount: rec.amount,
    seller: rec.seller,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

/**
 * 내용 칸은 항상 앞에 ' 를 붙여 쓴다 → 구글시트가 글자 그대로 보관 (' 는 값에 남지 않음).
 * "=…" 이 수식으로, "10/5" 가 날짜로, "007" 이 숫자로 바뀌지 않는다.
 */
function wsGobulbiTextCell_(text) {
  return "'" + text;
}

/** 입력 확인. 문제 없으면 { content, amount, seller }, 있으면 { error } */
function wsGobulbiInput_(body) {
  var content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return { error: "내용을 입력해 주세요." };
  if (content.length > WS_GOBULBI_CONTENT_MAX) {
    return { error: "내용은 " + WS_GOBULBI_CONTENT_MAX + "자 이하로 입력해 주세요." };
  }
  if (/[\r\n\t]/.test(content)) return { error: "내용은 한 줄로 입력해 주세요." };
  var amount = body.amount;
  if (
    typeof amount !== "number" ||
    !isFinite(amount) ||
    Math.floor(amount) !== amount ||
    amount < 1 ||
    amount > WS_GOBULBI_AMOUNT_MAX
  ) {
    return { error: "금액은 1원 이상 " + WS_GOBULBI_AMOUNT_MAX + "원 이하의 정수로 입력해 주세요." };
  }
  var seller = typeof body.seller === "string" ? body.seller.trim() : "";
  if (!seller || seller.length > WS_GOBULBI_SELLER_MAX || /^[=+\-@]/.test(seller)) {
    return { error: "판매자를 선택해 주세요." };
  }
  return { content: content, amount: amount, seller: seller };
}

function wsGobulbiFind_(records, id) {
  var found = [];
  for (var i = 0; i < records.length; i++) if (records[i].id === id) found.push(records[i]);
  return found;
}

/** 화면에서 본 값(before)과 지금 기록이 같은지 */
function wsGobulbiSameAsBefore_(rec, before) {
  return (
    !!before &&
    rec.content === String(before.content) &&
    rec.amount === Number(before.amount) &&
    rec.seller === String(before.seller) &&
    rec.updatedAt === String(before.updatedAt)
  );
}

function wsHandleGobulbi_(body) {
  if (!wsAuthorized_(body)) return wsGobulbiFail_("인증에 실패했습니다.");
  var op = String(body.op || "");
  var ss = wsSpreadsheet_();
  var tz = ss.getSpreadsheetTimeZone();

  if (op === "list") {
    var month = String(body.month || "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return wsGobulbiFail_("월 형식이 올바르지 않습니다.");
    var sheet = wsGobulbiSheet_(ss, false);
    if (sheet && sheet.getLastRow() > 0) {
      var problem = wsGobulbiHeaderProblem_(sheet);
      if (problem) {
        return wsGobulbiFail_(
          WS_GOBULBI_SHEET + " 시트 제목이 웹앱과 다릅니다 (" + problem + ") 금액을 잘못 읽지 않도록 불러오지 않았습니다.",
        );
      }
    }
    var items = [];
    var total = 0;
    var invalidRows = 0;
    var records = wsGobulbiRead_(sheet, tz);
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (!rec.valid) {
        // 형식이 잘못된 행: 금액에 넣지 않고 개수만 알린다 (해당 월인지 알 수 없으면 모든 월에 알림)
        if (!/^\d{4}-\d{2}/.test(rec.payDate) || rec.payDate.slice(0, 7) === month) invalidRows++;
        continue;
      }
      if (rec.status !== WS_GOBULBI_ACTIVE || rec.payDate.slice(0, 7) !== month) continue;
      items.push(wsGobulbiView_(rec));
      total += rec.amount;
    }
    return wsGobulbiReply_({
      ok: true,
      month: month,
      items: items,
      total: total,
      invalidRows: invalidRows,
      sheetExists: !!sheet,
    });
  }

  if (op !== "create" && op !== "update" && op !== "delete") {
    return wsGobulbiFail_("요청 형식이 올바르지 않습니다.");
  }
  var id = String(body.id || "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return wsGobulbiFail_("고유 ID 형식이 올바르지 않습니다.");
  var input = null;
  if (op !== "delete") {
    input = wsGobulbiInput_(body);
    if (input.error) return wsGobulbiFail_(input.error);
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return wsGobulbiFail_("다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.");
  }
  try {
    var now = new Date();
    var today = Utilities.formatDate(now, tz, "yyyy-MM-dd");
    var stamp = Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm:ss");

    if (op === "create") {
      var reqMonth = String(body.month || "");
      if (reqMonth !== today.slice(0, 7)) {
        return wsGobulbiFail_(
          "고불비사용 신규 등록은 이번 달(" + today.slice(0, 7) + ")만 할 수 있습니다. 화면을 새로고침해 주세요.",
        );
      }
      var sheetC = wsGobulbiSheet_(ss, true);
      var problemC = wsGobulbiHeaderProblem_(sheetC);
      if (problemC) {
        return wsGobulbiFail_(
          WS_GOBULBI_SHEET + " 시트 제목이 웹앱과 다릅니다 (" + problemC + ") 잘못된 칸에 저장되지 않도록 저장하지 않았습니다.",
        );
      }
      var existing = wsGobulbiFind_(wsGobulbiRead_(sheetC, tz), id);
      if (existing.length > 0) {
        var ex = existing[0];
        if (
          existing.length === 1 &&
          ex.content === input.content &&
          ex.amount === input.amount &&
          ex.seller === input.seller
        ) {
          // 같은 요청이 다시 온 것 (응답이 늦어 다시 누름 등): 새로 쓰지 않고 저장된 기록을 돌려준다
          return wsGobulbiReply_({
            ok: true,
            duplicate: true,
            item: wsGobulbiView_(ex),
            message: "이미 등록된 내역입니다 (다시 저장하지 않음).",
          });
        }
        return wsGobulbiFail_("같은 고유 ID 의 내역이 이미 있어 저장하지 않았습니다. 화면을 새로고침해 주세요.");
      }
      var newRow = Math.max(sheetC.getLastRow(), 1) + 1;
      var target = sheetC.getRange(newRow, 1, 1, WS_GOBULBI_COLS);
      // ID·지급일·판매자·시각·상태 칸은 글자 형식 (지급일·시각이 날짜 값으로 바뀌지 않게). 내용(C)은 ' 로, 금액(D)은 숫자
      sheetC.getRange(newRow, 1, 1, 2).setNumberFormat("@");
      sheetC.getRange(newRow, 5, 1, 5).setNumberFormat("@");
      target.setValues([
        [
          id,
          today,
          wsGobulbiTextCell_(input.content),
          input.amount,
          input.seller,
          stamp,
          stamp,
          WS_GOBULBI_ACTIVE,
          "",
        ],
      ]);
      SpreadsheetApp.flush();
      var saved = wsGobulbiFind_(wsGobulbiRead_(sheetC, tz), id);
      if (saved.length !== 1 || saved[0].amount !== input.amount || saved[0].content !== input.content) {
        return wsGobulbiFail_("저장 후 확인에 실패했습니다. 구글시트의 " + WS_GOBULBI_SHEET + " 시트를 확인해 주세요.");
      }
      return wsGobulbiReply_({
        ok: true,
        duplicate: false,
        item: wsGobulbiView_(saved[0]),
        message: "고불비사용을 등록했습니다.",
      });
    }

    // 수정·삭제
    var sheetU = wsGobulbiSheet_(ss, false);
    if (!sheetU) return wsGobulbiFail_("고불비사용 내역이 없습니다. 화면을 새로고침해 주세요.");
    var problemU = wsGobulbiHeaderProblem_(sheetU);
    if (problemU) {
      return wsGobulbiFail_(
        WS_GOBULBI_SHEET + " 시트 제목이 웹앱과 다릅니다 (" + problemU + ") 잘못된 칸을 고치지 않도록 멈췄습니다.",
      );
    }
    var found = wsGobulbiFind_(wsGobulbiRead_(sheetU, tz), id);
    if (found.length !== 1) {
      return wsGobulbiFail_(
        found.length === 0
          ? "해당 내역을 찾지 못했습니다. 화면을 새로고침해 주세요."
          : "같은 고유 ID 의 내역이 2건 이상이라 고치지 않았습니다. 구글시트를 확인해 주세요.",
      );
    }
    var rec2 = found[0];
    if (!rec2.valid || rec2.status !== WS_GOBULBI_ACTIVE) {
      return wsGobulbiFail_("이미 삭제되었거나 형식이 올바르지 않은 내역입니다. 화면을 새로고침해 주세요.");
    }
    if (!wsGobulbiSameAsBefore_(rec2, body.before)) {
      return wsGobulbiFail_("그사이 내역이 바뀌어 저장하지 않았습니다. 화면을 새로고침한 뒤 다시 확인해 주세요.", {
        current: wsGobulbiView_(rec2),
      });
    }

    if (op === "update") {
      // 지급일(B)·등록일(F)은 그대로. 내용(C)·금액(D)·판매자(E)·수정일(G)만
      sheetU.getRange(rec2.row, 5, 1, 3).setNumberFormat("@");
      sheetU
        .getRange(rec2.row, 3, 1, 5)
        .setValues([[wsGobulbiTextCell_(input.content), input.amount, input.seller, rec2.createdAt, stamp]]);
      SpreadsheetApp.flush();
      var after = wsGobulbiFind_(wsGobulbiRead_(sheetU, tz), id);
      if (after.length !== 1 || after[0].amount !== input.amount || after[0].content !== input.content) {
        return wsGobulbiFail_("수정 후 확인에 실패했습니다. 구글시트의 " + WS_GOBULBI_SHEET + " 시트를 확인해 주세요.");
      }
      return wsGobulbiReply_({ ok: true, item: wsGobulbiView_(after[0]), message: "고불비사용을 수정했습니다." });
    }

    // 삭제: 행은 지우지 않고 수정일(G)·상태(H)·삭제일시(I)만
    sheetU.getRange(rec2.row, 7, 1, 3).setNumberFormat("@");
    sheetU.getRange(rec2.row, 7, 1, 3).setValues([[stamp, WS_GOBULBI_DELETED, stamp]]);
    SpreadsheetApp.flush();
    var del = wsGobulbiFind_(wsGobulbiRead_(sheetU, tz), id);
    if (del.length !== 1 || del[0].status !== WS_GOBULBI_DELETED) {
      return wsGobulbiFail_("삭제 후 확인에 실패했습니다. 구글시트의 " + WS_GOBULBI_SHEET + " 시트를 확인해 주세요.");
    }
    return wsGobulbiReply_({ ok: true, id: id, message: "고불비사용을 삭제했습니다." });
  } finally {
    lock.releaseLock();
  }
}
