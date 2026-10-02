/**
 * 무선 판매 관리 웹앱 — 판매내역 삭제 기능 (Apps Script에 추가하는 코드)
 *
 * 붙여넣는 방법
 *   1. Apps Script 편집기에서 새 파일 delete-handler.gs 를 만들고 이 파일 내용을 통째로 붙여넣는다.
 *   2. 기존 doPost(e) 함수의 "맨 첫 줄"(조회 코드 두 줄 바로 아래)에 아래 두 줄을 넣는다.
 *      (기존 코드는 지우지 않는다)
 *
 *        var deleteResponse = handleDeleteRequest_(e);
 *        if (deleteResponse) return deleteResponse;
 *
 *   3. 배포 → 배포 관리 → 기존 웹 앱 배포의 연필(수정) → 버전: "새 버전" → 배포.
 *      (웹 앱 주소는 그대로 유지된다)
 *
 * 동작
 *   - 요청 본문의 action 이 "delete" 일 때만 동작한다. 그 외 요청은 null 을 돌려주므로
 *     기존 저장·조회 코드가 그대로 처리한다.
 *   - 스크립트 속성 API_SECRET 과 같은 secret 일 때만 동작한다.
 *   - 행 자체는 지우지 않는다. 대상 행의 A열과 C~AK열의 "값"만 비운다 (서식 유지).
 *   - B열(No.)과 수식이 들어 있는 칸은 절대 건드리지 않는다.
 *   - 원본 양식 시트("무선장표 양식")의 같은 행에서 "-" 인 칸(M·T 등)은 "-" 를 다시 넣어
 *     처음 빈 행 모양으로 되돌린다. 양식 시트가 없으면 가장 가까운 빈 판매 행을 참고한다.
 *   - 행 번호만 믿지 않고 No.(B)·개통일(C)·고객(D)·CTN(E) 이 화면에서 본 값과 모두 같을 때만 지운다.
 *   - LockService 로 한 번에 하나의 삭제만 처리한다.
 */
function handleDeleteRequest_(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return null;
  }
  if (!body || body.action !== "delete") return null;

  function json(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
      ContentService.MimeType.JSON,
    );
  }

  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty("API_SECRET");
  if (!secret || body.secret !== secret) {
    return json({ ok: false, message: "인증에 실패했습니다." });
  }

  var FIRST_ROW = 9;
  var COLUMN_COUNT = 37; // A~AK
  var B_INDEX = 1; // B열(No.)
  var TEMPLATE_SHEET = "무선장표 양식";

  var target = body.target || {};
  var sheetName = String(target.sheet || "");
  var rowNumber = Number(target.row);
  if (!/^(1[0-2]|[1-9])월$/.test(sheetName)) {
    return json({ ok: false, message: "시트 이름이 올바르지 않습니다." });
  }
  if (!(rowNumber >= FIRST_ROW) || Math.floor(rowNumber) !== rowNumber) {
    return json({ ok: false, message: "행 번호가 올바르지 않습니다." });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return json({
      ok: false,
      message: "다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.",
    });
  }

  try {
    var ss =
      SpreadsheetApp.getActiveSpreadsheet() ||
      SpreadsheetApp.openById(props.getProperty("SPREADSHEET_ID"));
    var tz = ss.getSpreadsheetTimeZone();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return json({ ok: false, message: sheetName + " 시트를 찾을 수 없습니다." });
    }
    var lastRow = sheet.getLastRow();
    if (rowNumber > lastRow) {
      return json({ ok: false, message: "해당 행이 장표에 없습니다." });
    }

    var all = sheet
      .getRange(FIRST_ROW, 1, lastRow - FIRST_ROW + 1, COLUMN_COUNT)
      .getValues();
    var index = rowNumber - FIRST_ROW;
    var current = all[index];
    var formulas = sheet.getRange(rowNumber, 1, 1, COLUMN_COUNT).getFormulas()[0];

    function text(v) {
      if (v instanceof Date) return Utilities.formatDate(v, tz, "yyyy-MM-dd");
      return String(v === null || v === undefined ? "" : v).trim();
    }
    function digits(v) {
      return text(v).replace(/\D/g, "");
    }
    function isEmptySale(r) {
      return r[2] === "" && r[3] === "" && r[4] === "";
    }

    // 1) 이미 비어 있는 행이면 지우지 않는다
    if (isEmptySale(current)) {
      return json({
        ok: false,
        message: "이미 비어 있는 행입니다. 판매 현황을 새로고침해 주세요.",
      });
    }

    // 2) 화면에서 본 값과 지금 장표 값이 모두 같을 때만 지운다
    var mismatches = [];
    if (text(current[B_INDEX]) !== text(target.no)) mismatches.push("No.");
    if (text(current[2]) !== text(target.activatedAt)) mismatches.push("개통일");
    if (text(current[3]) !== text(target.customer)) mismatches.push("고객");
    if (digits(current[4]) !== digits(target.ctn)) mismatches.push("CTN");
    if (mismatches.length > 0) {
      return json({
        ok: false,
        message:
          "장표 내용이 화면과 달라 삭제하지 않았습니다 (" +
          mismatches.join(", ") +
          "). 판매 현황을 새로고침한 뒤 다시 확인해 주세요.",
      });
    }

    // 3) 빈 행 모양 참고: 양식 시트의 같은 행 → 없으면 가장 가까운 빈 판매 행 (아래쪽 먼저)
    var reference = null;
    var template = ss.getSheetByName(TEMPLATE_SHEET);
    if (template && template.getLastRow() >= rowNumber) {
      reference = template.getRange(rowNumber, 1, 1, COLUMN_COUNT).getValues()[0];
    }
    for (var down = index + 1; down < all.length && !reference; down++) {
      if (text(all[down][B_INDEX]) !== "" && isEmptySale(all[down])) reference = all[down];
    }
    for (var up = index - 1; up >= 0 && !reference; up--) {
      if (text(all[up][B_INDEX]) !== "" && isEmptySale(all[up])) reference = all[up];
    }

    // 4) A열·C~AK열만, 수식 칸은 건너뛰고, 이어진 칸끼리 묶어서 값만 바꾼다
    var c = 0;
    while (c < COLUMN_COUNT) {
      if (c === B_INDEX || formulas[c] !== "") {
        c++;
        continue;
      }
      var start = c;
      var segment = [];
      while (c < COLUMN_COUNT && c !== B_INDEX && formulas[c] === "") {
        segment.push(reference && reference[c] === "-" ? "-" : "");
        c++;
      }
      sheet.getRange(rowNumber, start + 1, 1, segment.length).setValues([segment]);
    }
    SpreadsheetApp.flush();

    return json({
      ok: true,
      sheet: sheetName,
      row: rowNumber,
      no: text(current[B_INDEX]),
      message: "판매내역이 삭제되었습니다.",
    });
  } finally {
    lock.releaseLock();
  }
}
