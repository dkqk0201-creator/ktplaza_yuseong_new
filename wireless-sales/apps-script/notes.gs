/**
 * 무선 판매 관리 웹앱 — 판매보고 참고내용 보관 (Apps Script 에 새 파일 notes.gs 로 추가)
 *
 * 직원 판매보고 중 장표(A~AL)에 저장하지 않는 참고 항목(예: 중고폰&현물 판매, 어디에)을
 * 같은 스프레드시트의 숨김 보조 시트 "웹앱참고" 에 판매 건별로 보관한다.
 *   - 무선장표 월 시트·양식 시트의 열 구조는 바꾸지 않는다.
 *   - 판매 건 연결 키 = 월 시트 | 개통일(C) | CTN 숫자(E) | 고객명(D)  (행 번호는 쓰지 않음 → 재정렬해도 안전)
 *   - 저장(save-handler): 새 판매의 키로 덮어쓰기 (참고내용이 없으면 그 키의 기록을 지움)
 *   - 조회(list-handler): 키가 정확히 한 판매에만 맞을 때만 그 판매에 붙인다 (같은 키 판매가 2건이면 붙이지 않음)
 *   - 수정(update-handler): 고객명(D)·CTN(E)을 바꾸면 키를 새 값으로 옮긴다
 *   - 삭제(delete-handler): 그 판매의 키 기록을 지운다
 *   - 정책명(modelPolicyName): S열 모델정책 금액의 정책명. 장표에는 쓰지 않고 여기만 보관한다.
 *     판매 수정(update-handler, sale-update)에서 이 항목 하나만 바꿀 수 있다 (다른 참고 항목은 그대로 유지).
 *     같은 키(개통일·CTN·고객)를 가진 판매가 장표에 2건 이상이면 다른 판매에 붙을 수 있으므로 저장하지 않는다.
 * 보조 시트는 처음 저장할 때 자동으로 만들고 숨긴다. 직접 고치지 마세요.
 */
var WS_NOTES_SHEET = "웹앱참고";
var WS_NOTES_HEADER = ["키", "월 시트", "개통일", "고객", "CTN", "참고내용(JSON)", "저장 시각"];
var WS_NOTES_COLS = WS_NOTES_HEADER.length;

/** 판매 행(38칸 값) → 연결 키. 개통일·CTN 이 없으면 "" */
function wsNoteKey_(sheetName, rowValues, tz) {
  var date = wsText_(rowValues[2], tz);
  var ctn = wsText_(rowValues[4], tz).replace(/\D/g, "");
  var customer = wsText_(rowValues[3], tz).replace(/^'/, "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !ctn) return "";
  return sheetName + "|" + date + "|" + ctn + "|" + customer;
}

/** 보조 시트 (create 가 true 면 없을 때 만들고 숨김) */
function wsNotesSheet_(ss, create) {
  var sheet = ss.getSheetByName(WS_NOTES_SHEET);
  if (!sheet && create) {
    sheet = ss.insertSheet(WS_NOTES_SHEET);
    sheet.getRange(1, 1, 1, WS_NOTES_COLS).setValues([WS_NOTES_HEADER]);
    sheet.hideSheet();
  }
  return sheet;
}

/** 보조 시트 전체 { key: { row, notes } } */
function wsReadNotes_(sheet) {
  var map = {};
  if (!sheet) return map;
  var last = sheet.getLastRow();
  if (last < 2) return map;
  var rows = sheet.getRange(2, 1, last - 1, WS_NOTES_COLS).getValues();
  for (var i = 0; i < rows.length; i++) {
    var key = String(rows[i][0] || "");
    if (!key) continue;
    var notes = null;
    try {
      notes = JSON.parse(String(rows[i][5] || "{}"));
    } catch (err) {
      notes = null;
    }
    if (notes && typeof notes === "object") map[key] = { row: i + 2, notes: notes };
  }
  return map;
}

/** 참고내용 객체 정리: 글자 값만, 빈 값 제외. 남는 것이 없으면 null */
function wsCleanNotes_(notes) {
  if (!notes || typeof notes !== "object") return null;
  var out = {};
  var count = 0;
  for (var k in notes) {
    if (!Object.prototype.hasOwnProperty.call(notes, k)) continue;
    if (!/^[A-Za-z]{1,40}$/.test(k)) continue;
    var v = notes[k];
    if (typeof v !== "string") continue;
    v = v.trim().slice(0, 500);
    if (!v) continue;
    out[k] = v;
    count++;
  }
  return count > 0 ? out : null;
}

/** 키 기록 저장(덮어쓰기). notes 가 비어 있으면 그 키 기록을 지운다 */
function wsWriteNote_(ss, key, info, notes) {
  if (!key) return;
  var clean = wsCleanNotes_(notes);
  var sheet = wsNotesSheet_(ss, !!clean);
  if (!sheet) return;
  var existing = wsReadNotes_(sheet)[key];
  if (!clean) {
    if (existing) sheet.deleteRow(existing.row);
    return;
  }
  var record = [
    "'" + key,
    "'" + info.sheet,
    "'" + info.date,
    "'" + info.customer,
    "'" + info.ctn,
    "'" + JSON.stringify(clean),
    new Date(),
  ];
  if (existing) {
    sheet.getRange(existing.row, 1, 1, WS_NOTES_COLS).setValues([record]);
  } else {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, WS_NOTES_COLS).setValues([record]);
  }
}

/** 판매 행 값으로 키·정보 */
function wsNoteInfo_(sheetName, rowValues, tz) {
  return {
    key: wsNoteKey_(sheetName, rowValues, tz),
    sheet: sheetName,
    date: wsText_(rowValues[2], tz),
    customer: wsText_(rowValues[3], tz).replace(/^'/, ""),
    ctn: wsText_(rowValues[4], tz),
  };
}

/** 판매 저장 후: 저장된 행들의 실제 값으로 키를 만들어 참고내용 덮어쓰기 */
function wsSaveNotesForRows_(ss, sheet, tz, results, notesList) {
  if (!Array.isArray(notesList)) return false;
  for (var k = 0; k < results.length; k++) {
    if (!results[k] || !results[k].ok) continue;
    var values = sheet.getRange(results[k].row, 1, 1, WS_COLUMN_COUNT).getValues()[0];
    var info = wsNoteInfo_(sheet.getName(), values, tz);
    wsWriteNote_(ss, info.key, info, notesList[k]);
  }
  return true;
}

/** 판매 삭제 전 값으로 그 판매의 참고내용 지우기 */
function wsDeleteNoteForRow_(ss, sheetName, rowValues, tz) {
  var key = wsNoteKey_(sheetName, rowValues, tz);
  if (!key) return;
  var sheet = wsNotesSheet_(ss, false);
  if (!sheet) return;
  var existing = wsReadNotes_(sheet)[key];
  if (existing) sheet.deleteRow(existing.row);
}

/** 판매 수정으로 고객명·CTN 이 바뀌었을 때 참고내용 키를 새 값으로 옮기기 */
function wsMoveNoteForRow_(ss, sheetName, beforeValues, afterValues, tz) {
  var from = wsNoteKey_(sheetName, beforeValues, tz);
  var info = wsNoteInfo_(sheetName, afterValues, tz);
  if (!from || !info.key || from === info.key) return;
  var sheet = wsNotesSheet_(ss, false);
  if (!sheet) return;
  var existing = wsReadNotes_(sheet)[from];
  if (!existing) return;
  var notes = existing.notes;
  sheet.deleteRow(existing.row);
  wsWriteNote_(ss, info.key, info, notes);
}

/** 판매 수정 화면에서 고칠 수 있는 참고내용 항목 (정책명만. 나머지는 판매보고 원문이라 고치지 않음) */
var WS_EDITABLE_NOTE_FIELDS = { modelPolicyName: true };

/** 월 시트에서 이 키를 가진 판매 행 수 (행 번호·No. 와 무관) */
function wsCountNoteKey_(sheet, tz, key) {
  if (!key) return 0;
  var last = sheet.getLastRow();
  if (last < WS_FIRST_ROW) return 0;
  var values = sheet
    .getRange(WS_FIRST_ROW, 1, last - WS_FIRST_ROW + 1, WS_COLUMN_COUNT)
    .getValues();
  var name = sheet.getName();
  var n = 0;
  for (var i = 0; i < values.length; i++) {
    if (wsNoteKey_(name, values[i], tz) === key) n++;
  }
  return n;
}

/** 키의 참고내용 중 한 항목의 현재 값 (없으면 "") */
function wsNoteValue_(ss, key, field) {
  if (!key) return "";
  var sheet = wsNotesSheet_(ss, false);
  if (!sheet) return "";
  var rec = wsReadNotes_(sheet)[key];
  var v = rec && rec.notes ? rec.notes[field] : "";
  return typeof v === "string" ? v.trim() : "";
}

/** 키의 참고내용 중 한 항목만 바꾼다 (다른 항목은 그대로). value 가 "" 이면 그 항목만 지운다. 저장 후 참고내용 반환 */
function wsPatchNote_(ss, info, field, value) {
  if (!info.key) return {};
  var sheet = wsNotesSheet_(ss, false);
  var existing = sheet ? wsReadNotes_(sheet)[info.key] : null;
  var notes = {};
  if (existing && existing.notes) {
    for (var k in existing.notes) {
      if (Object.prototype.hasOwnProperty.call(existing.notes, k)) notes[k] = existing.notes[k];
    }
  }
  if (value) notes[field] = value;
  else delete notes[field];
  wsWriteNote_(ss, info.key, info, notes);
  var after = wsNotesSheet_(ss, false);
  var rec = after ? wsReadNotes_(after)[info.key] : null;
  return (rec && wsCleanNotes_(rec.notes)) || {};
}

/**
 * 조회용: 월 시트 판매 행들에 참고내용 붙이기.
 * rows: [{ row, no, values }] → 같은 키가 정확히 1건인 판매에만 notes 를 붙인다.
 */
function wsAttachNotes_(ss, sheetName, rows, tz) {
  var sheet = wsNotesSheet_(ss, false);
  if (!sheet) return;
  var map = wsReadNotes_(sheet);
  var keys = [];
  var count = {};
  for (var i = 0; i < rows.length; i++) {
    var key = wsNoteKey_(sheetName, rows[i].values, tz);
    keys.push(key);
    if (key) count[key] = (count[key] || 0) + 1;
  }
  for (var j = 0; j < rows.length; j++) {
    var k = keys[j];
    if (k && count[k] === 1 && map[k]) rows[j].notes = map[k].notes;
  }
}
