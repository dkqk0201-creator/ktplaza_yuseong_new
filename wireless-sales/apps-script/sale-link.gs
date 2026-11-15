/**
 * 무선 판매 관리 웹앱 — 판매 고유 ID · 판매연결 정보 (Apps Script 에 새 파일 sale-link.gs 로 추가)
 *
 * 판매 고유 ID (saleId)
 *   - 새 판매를 저장할 때 Utilities.getUuid() 로 만들어, 그 판매 행 C열(개통일) 셀 메모에 한 줄로 적는다:
 *       웹앱판매ID: 0f8e…(36자)
 *     (C열 메모에 다른 글이 있으면 그대로 두고 이 줄만 더하거나 바꾼다)
 *   - 웹앱 저장의 개통일 정렬은 A·C~AL 메모를 판매와 함께 옮기므로(save-handler wsWriteSortedBlock_) ID 가 판매를 따라간다.
 *     판매 수정은 C열을 바꾸지 않으므로 ID 도 그대로다. 판매 삭제는 이 줄을 지운다.
 *   - 월 시트 열은 추가하지 않는다. 고객명·CTN 조합에 기대지 않으므로 같은 날 같은 고객 판매 2건도 각각 구분된다.
 *   - 같은 ID 가 두 행 이상에 있으면(시트에서 행을 복사한 경우 등) 그 판매들은 "ID 중복"으로 표시하고
 *     판매연결 정보를 붙이지도, 저장하지도 않는다 (잘못된 판매에 연결되는 것을 막음 — 점장 확인 필요).
 *   - 확인값: 판매연결 기록마다 그 판매의 "개통일 + CTN 숫자" 를 SHA-256 으로 줄인 값(16자)을 함께 둔다
 *     (전화번호 자체는 저장하지 않음). 조회할 때 행의 값과 확인값이 다르면 — 예: 장표에서 값만 붙여넣어
 *     메모(ID)와 판매 내용이 서로 다른 행이 된 경우 — "확인 필요(mismatch)" 로 표시하고 연결 정보를 붙이지 않는다.
 *     웹앱의 판매 수정으로 CTN 을 고치면 확인값도 함께 바꾼다 (update-handler). 장표에서 직접 고치면 확인 필요가 된다.
 *     확인 필요인 판매는 예전 기록을 그 판매로 옮기지 않고, 점장이 "새 판매 ID 로 다시 연결"할 때만
 *     새 ID 를 만들고 예전 기록은 분리(삭제 시각 기록)한다 — 다른 판매의 유입경로가 넘어오지 않게.
 *   - 예전 판매(ID 없음)는 판매 수정 화면에서 판매연결을 처음 저장할 때, 그 행이 화면과 같은지
 *     (행·No.·개통일·고객·CTN) 확인한 뒤 그 행에만 ID 를 만든다. 일괄 부여는 아래 편집기 함수로 (별도 승인 후 실행).
 *
 * 판매연결 정보 — 숨김 보조 시트 "웹앱판매연결" (처음 저장할 때 자동 생성·숨김. 직접 고치지 마세요)
 *   판매ID | 월 시트 | 개통일 | 판매 직원ID | 유입경로 | 캠페인 | 굿바이 | 가망고객ID | TM발굴직원ID | 수정 시각 | 삭제 시각 | 확인값
 *   | 캠페인ID | 리본방식 | 등록요청ID | 유입경로원문     ← 2026-11-15 추가 (예전 12칸 시트는 처음 쓸 때 제목만 이어 붙임)
 *   - 굿바이 칸 = 화면 이름 "리본" (O/X). 리본방식 = 자동(중고폰&현물 판매로 판정) / 수동(점장이 고름)
 *   - 캠페인 칸 = 직원이 보고한 원문, 캠페인ID = 캠페인 목록(config-handler.gs "웹앱캠페인")과 맞춘 ID
 *   - 유입경로 = 항목 이름(config-handler.gs "웹앱유입경로"의 사용 중 항목 또는 미확인), 유입경로원문 = 목록에 없던 카톡 원문
 *   - 등록요청ID = 간편등록 화면이 판매 카드마다 만든 ID. 같은 ID 로 다시 오면 판매를 또 쓰지 않는다 (save-handler.gs).
 *     판매 행 C열 메모에도 "웹앱등록요청ID: <ID>" 줄로 판매 ID 와 함께 적는다 (판매를 쓰는 순간 함께 기록 → 연결 저장이 실패해도 재전송 중복 방지)
 *   고객 이름·전화번호는 저장하지 않는다. 판매를 삭제하면 기록을 지우지 않고 삭제 시각만 남긴다 (향후 연동 이력).
 *
 * 요청 (웹앱 서버만, API_SECRET 필요):
 *   sale-link-set { target: { sheet, row, no, activatedAt, customer, ctn }, saleId: 화면에서 본 ID(없으면 ""),
 *                   staffId, patches: [{ field, before, value }], relink: true(확인 필요 판매를 새 ID 로 다시 연결할 때만) }
 *     → 화면에서 본 값(before)과 지금 저장된 값이 하나라도 다르면 아무것도 쓰지 않고 거부한다.
 *   응답 handler = "ws-sale-link"
 */
var WS_SALE_LINK_HANDLER = "ws-sale-link";
var WS_LINK_SHEET = "웹앱판매연결";
var WS_LINK_HEADER = [
  "판매ID",
  "월 시트",
  "개통일",
  "판매 직원ID",
  "유입경로",
  "캠페인",
  "굿바이",
  "가망고객ID",
  "TM발굴직원ID",
  "수정 시각",
  "삭제 시각",
  "확인값",
  "캠페인ID",
  "리본방식",
  "등록요청ID",
  "유입경로원문",
];
var WS_LINK_COLS = WS_LINK_HEADER.length;
/** 저장할 수 있는 항목 → 열 번호(0부터) */
var WS_LINK_FIELD_COL = {
  staffId: 3, inflow: 4, campaign: 5, goodbye: 6, prospectId: 7, tmStaffId: 8,
  campaignId: 12, ribbonMode: 13, requestId: 14, inflowRaw: 15,
};
var WS_LINK_EDITABLE = {
  inflow: true, campaign: true, goodbye: true, prospectId: true, tmStaffId: true,
  campaignId: true, ribbonMode: true, inflowRaw: true,
};
/** 기본 유입경로 (config-handler.gs 의 "웹앱유입경로" 시트가 없을 때). 2026-11-15 확정 5개 + 미확인 */
var WS_INFLOW_SOURCES = ["네이버", "자점", "TM", "내방", "외부영업", "미확인"];
var WS_REQUEST_ID_PREFIX = "웹앱등록요청ID: ";
var WS_REQUEST_ID_RE = /(^|\n)웹앱등록요청ID: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\n|$)/;
var WS_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var WS_SALE_ID_PREFIX = "웹앱판매ID: ";
var WS_SALE_ID_RE = /(^|\n)웹앱판매ID: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\n|$)/;
var WS_DATE_COLUMN = 3; // C열

/** 확인값: 개통일(글자) + CTN 숫자 → SHA-256 앞 16자 (전화번호를 저장하지 않고 같은 판매인지 확인) */
function wsSaleCheck_(rowValues, tz) {
  var date = wsText_(rowValues[2], tz);
  var ctn = wsText_(rowValues[4], tz).replace(/\D/g, "");
  if (!date || !ctn) return "";
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, date + "|" + ctn, Utilities.Charset.UTF_8);
  var hex = "";
  for (var i = 0; i < 8; i++) {
    var b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? "0" : "") + b.toString(16);
  }
  return hex;
}

/** 셀 메모 글에서 판매 ID (없으면 "") */
function wsSaleIdFromNote_(note) {
  var m = WS_SALE_ID_RE.exec(String(note || ""));
  return m ? m[2] : "";
}
/** 메모 글에 판매 ID 줄을 넣거나 바꾼 결과 (id 가 "" 이면 그 줄만 뺀다). 다른 글은 그대로 */
function wsNoteWithSaleId_(note, id) {
  var lines = String(note || "")
    .split("\n")
    .filter(function (line) {
      return line.indexOf(WS_SALE_ID_PREFIX) !== 0;
    });
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (id) lines.push(WS_SALE_ID_PREFIX + id);
  return lines.join("\n");
}

/** 셀 메모 글에서 등록요청 ID (없으면 "") */
function wsRequestIdFromNote_(note) {
  var m = WS_REQUEST_ID_RE.exec(String(note || ""));
  return m ? m[2] : "";
}
/** 메모 글에서 등록요청 ID 줄을 뺀 결과 (다른 글은 그대로) */
function wsNoteWithoutRequestId_(note) {
  var lines = String(note || "")
    .split("\n")
    .filter(function (line) {
      return line.indexOf(WS_REQUEST_ID_PREFIX) !== 0;
    });
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
/** 새 판매 C열 메모: 판매 ID 줄 + (있으면) 등록요청 ID 줄 */
function wsNewSaleNote_(saleId, requestId) {
  return WS_SALE_ID_PREFIX + saleId + (requestId ? "\n" + WS_REQUEST_ID_PREFIX + requestId : "");
}

/** 월 시트 판매 영역 C열 메모 → 행 번호별 ID 와 ID 별 개수 */
function wsSaleIdsOfSheet_(sheet) {
  var last = sheet.getLastRow();
  var out = { byRow: {}, count: {} };
  if (last < WS_FIRST_ROW) return out;
  var notes = sheet.getRange(WS_FIRST_ROW, WS_DATE_COLUMN, last - WS_FIRST_ROW + 1, 1).getNotes();
  for (var i = 0; i < notes.length; i++) {
    var id = wsSaleIdFromNote_(notes[i][0]);
    if (!id) continue;
    out.byRow[WS_FIRST_ROW + i] = id;
    out.count[id] = (out.count[id] || 0) + 1;
  }
  return out;
}

function wsLinkSheet_(ss, create) {
  var sheet = ss.getSheetByName(WS_LINK_SHEET);
  if (!sheet && create) {
    sheet = ss.insertSheet(WS_LINK_SHEET);
    sheet.getRange(1, 1, 1, WS_LINK_COLS).setValues([WS_LINK_HEADER]);
    sheet.hideSheet();
  } else if (sheet && create) {
    // 예전 12칸 시트: 뒤에 새 칸 제목만 이어 붙인다 (기존 기록·칸은 그대로)
    var head = sheet.getRange(1, 1, 1, WS_LINK_COLS).getValues()[0];
    for (var h = 0; h < WS_LINK_COLS; h++) {
      if (String(head[h] || "") === "") sheet.getRange(1, h + 1).setValue(WS_LINK_HEADER[h]);
    }
  }
  return sheet;
}

/** 보조 시트 전체 { saleId: { row, values } } */
function wsReadLinks_(sheet) {
  var map = {};
  if (!sheet) return map;
  var last = sheet.getLastRow();
  if (last < 2) return map;
  var rows = sheet.getRange(2, 1, last - 1, WS_LINK_COLS).getValues();
  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i][0] || "").replace(/^'/, "");
    if (id) map[id] = { row: i + 2, values: rows[i] };
  }
  return map;
}

function wsLinkText_(v) {
  return String(v === null || v === undefined ? "" : v).replace(/^'/, "").trim();
}

/** 기록 → 화면용 값 */
function wsLinkObject_(values) {
  return {
    inflow: wsLinkText_(values[4]),
    campaign: wsLinkText_(values[5]),
    goodbye: wsLinkText_(values[6]),
    prospectId: wsLinkText_(values[7]),
    tmStaffId: wsLinkText_(values[8]),
    staffId: wsLinkText_(values[3]),
    campaignId: wsLinkText_(values[12]),
    ribbonMode: wsLinkText_(values[13]),
    requestId: wsLinkText_(values[14]),
    inflowRaw: wsLinkText_(values[15]),
  };
}

/**
 * 값 검사에 쓰는 설정: 사용 중 유입경로 이름(+미확인), 사용 중 캠페인ID.
 * config-handler.gs 가 없으면 기본 유입경로, 캠페인ID 는 형식만 검사.
 */
function wsLinkConfig_(ss) {
  return {
    inflows: typeof wsActiveInflowNames_ === "function" ? wsActiveInflowNames_(ss) : WS_INFLOW_SOURCES,
    campaigns: typeof wsActiveCampaignIds_ === "function" ? wsActiveCampaignIds_(ss) : null,
  };
}

/** 항목 값 검사 (웹앱 lib/sale-link.ts linkValueError 와 같은 기준). 문제 있으면 안내 문구. cfg = wsLinkConfig_(ss) (없으면 기본값) */
function wsLinkValueError_(field, value, cfg) {
  var v = String(value || "").trim();
  if (!v) return "";
  if (field === "inflow") {
    var names = cfg && cfg.inflows ? cfg.inflows : WS_INFLOW_SOURCES;
    return names.indexOf(v) >= 0 ? "" : "유입경로는 목록에서 골라 주세요.";
  }
  if (field === "goodbye") return v === "O" || v === "X" ? "" : "리본은 O 또는 X 로 입력해 주세요.";
  if (field === "campaignId") {
    if (!/^CMP-\d{4}$/.test(v)) return "캠페인 ID 형식이 올바르지 않습니다.";
    if (cfg && cfg.campaigns && !Object.prototype.hasOwnProperty.call(cfg.campaigns, v)) return "사용 중인 캠페인이 아닙니다. 캠페인 목록을 확인해 주세요.";
    return "";
  }
  if (field === "ribbonMode") return v === "자동" || v === "수동" ? "" : "리본 방식이 올바르지 않습니다.";
  if (field === "inflowRaw") return v.length <= 40 ? "" : "유입경로 원문은 40자까지 보관합니다.";
  if (field === "requestId") return WS_UUID_RE.test(v) ? "" : "등록 요청 ID 형식이 올바르지 않습니다.";
  if (field === "campaign") return v.length <= 40 ? "" : "캠페인명은 40자 이내로 입력해 주세요.";
  if (field === "prospectId") return v.length <= 40 && /^[\w-]+$/.test(v) ? "" : "가망고객 ID 형식이 올바르지 않습니다.";
  if (field === "tmStaffId" || field === "staffId") return /^st-\d{3}$/.test(v) ? "" : "직원 ID 형식이 올바르지 않습니다.";
  return "알 수 없는 항목입니다.";
}

/** 기록 쓰기 (없으면 새 줄). fields: { 항목: 값 } — 적힌 항목만 바꾼다 */
function wsWriteLink_(ss, saleId, info, fields) {
  var sheet = wsLinkSheet_(ss, true);
  var existing = wsReadLinks_(sheet)[saleId];
  var values = existing ? existing.values.slice() : ["'" + saleId];
  while (values.length < WS_LINK_COLS) values.push("");
  values[1] = "'" + info.sheet;
  values[2] = "'" + info.date;
  if (info.check) values[11] = "'" + info.check;
  for (var f in fields) {
    if (!Object.prototype.hasOwnProperty.call(fields, f)) continue;
    if (!Object.prototype.hasOwnProperty.call(WS_LINK_FIELD_COL, f)) continue;
    var v = String(fields[f] || "").trim();
    values[WS_LINK_FIELD_COL[f]] = v ? "'" + v : "";
  }
  values[9] = new Date();
  values[10] = "";
  var row = existing ? existing.row : sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, WS_LINK_COLS).setValues([values]);
  return wsLinkObject_(values);
}

/**
 * 판매 저장 직후 (save-handler): 저장된 새 판매마다 ID 를 만들어 C열 메모에 적고, 판매연결 정보(links[k])를 저장한다.
 * links: [{ inflow, campaign, goodbye, staffId } | null, …] (results 와 같은 순서, 없어도 됨)
 * results[k].saleId 에 만든 ID 를 적는다. 반환: true(모두 저장) / false(일부 실패 — 판매 저장은 그대로)
 */
function wsSaveLinksSafely_(ss, sheet, tz, results, links) {
  try {
    var ok = true;
    var cfg = wsLinkConfig_(ss);
    var existingLinks = null;
    for (var k = 0; k < results.length; k++) {
      if (!results[k] || !results[k].ok) continue;
      var link = Array.isArray(links) ? links[k] : null;
      var requestId = link && typeof link === "object" && WS_UUID_RE.test(String(link.requestId || "")) ? String(link.requestId) : "";
      var id = results[k].saleId || "";
      if (!id) {
        // 판매 ID 를 미리 만들지 않은 저장(예전 방식·등록요청 ID 없음): 지금 C열 메모에 적는다
        var cell = sheet.getRange(results[k].row, WS_DATE_COLUMN);
        id = Utilities.getUuid();
        cell.setNote(wsNoteWithSaleId_(cell.getNote(), id));
        results[k].saleId = id;
      }
      // 같은 등록 요청 재전송: 판매연결 기록이 이미 있으면 그대로 둔다 (그사이 점장이 고친 값을 덮지 않음)
      if (results[k].repeated) {
        if (existingLinks === null) existingLinks = wsReadLinks_(wsLinkSheet_(ss, false));
        if (existingLinks[id]) continue;
      }
      var fields = {};
      var any = false;
      if (link && typeof link === "object") {
        for (var f in WS_LINK_FIELD_COL) {
          if (!Object.prototype.hasOwnProperty.call(link, f)) continue;
          if (f === "requestId") continue;
          var value = String(link[f] || "").trim();
          if (!value) continue;
          if (wsLinkValueError_(f, value, cfg)) {
            ok = false;
            continue;
          }
          fields[f] = value;
          any = true;
        }
      }
      if (requestId) {
        fields.requestId = requestId;
        any = true;
      }
      if (any) {
        var rowValues = sheet.getRange(results[k].row, 1, 1, WS_COLUMN_COUNT).getValues()[0];
        wsWriteLink_(ss, id, { sheet: sheet.getName(), date: wsText_(rowValues[2], tz), check: wsSaleCheck_(rowValues, tz) }, fields);
      }
    }
    SpreadsheetApp.flush();
    return ok;
  } catch (err) {
    return false;
  }
}

/**
 * 조회 (list-handler): 판매마다 saleId·saleIdState 를 붙이고, ID 가 그 행에만 있고 확인값이 행과 맞을 때만 link 를 붙인다.
 * rows: [{ row, no, values }]
 * saleIdState: none(ID 없음) / ok / duplicate(같은 ID 가 다른 행에도) / mismatch(확인값이 행과 다름 — 확인 필요)
 */
function wsAttachLinks_(ss, sheet, rows, tz) {
  var ids = wsSaleIdsOfSheet_(sheet);
  var links = wsReadLinks_(wsLinkSheet_(ss, false));
  var name = sheet.getName();
  for (var i = 0; i < rows.length; i++) {
    var id = ids.byRow[rows[i].row] || "";
    if (!id) {
      rows[i].saleIdState = "none";
      continue;
    }
    rows[i].saleId = id;
    if (ids.count[id] !== 1) {
      rows[i].saleIdState = "duplicate";
      continue;
    }
    var rec = links[id];
    if (rec && !wsLinkText_(rec.values[10])) {
      var check = wsLinkText_(rec.values[11]);
      // 다른 월 시트로 복사된 ID, 또는 행의 개통일·CTN 이 기록과 다르면 붙이지 않는다 (확인 필요)
      if (wsLinkText_(rec.values[1]) !== name || (check && check !== wsSaleCheck_(rows[i].values, tz))) {
        rows[i].saleIdState = "mismatch";
        continue;
      }
      rows[i].link = wsLinkObject_(rec.values);
    }
    rows[i].saleIdState = "ok";
  }
}

/**
 * 판매 수정 직후 (update-handler): 웹앱으로 개통일·CTN 이 바뀌면 그 판매 기록의 확인값을 새 값으로.
 * 수정 전 행과 기록의 확인값이 맞을 때만 바꾼다 (이미 확인 필요인 기록은 그대로 둔다).
 */
function wsRefreshLinkCheck_(ss, sheet, rowNumber, before, after, tz) {
  var oldCheck = wsSaleCheck_(before, tz);
  var newCheck = wsSaleCheck_(after, tz);
  if (oldCheck === newCheck) return;
  var id = wsSaleIdFromNote_(sheet.getRange(rowNumber, WS_DATE_COLUMN).getNote());
  if (!id || wsSaleIdsOfSheet_(sheet).count[id] !== 1) return;
  var linkSheet = wsLinkSheet_(ss, false);
  var rec = wsReadLinks_(linkSheet)[id];
  if (!rec || wsLinkText_(rec.values[11]) !== oldCheck) return;
  linkSheet.getRange(rec.row, 12).setValue(newCheck ? "'" + newCheck : "");
}

/** 판매 삭제 (delete-handler): 그 행 C열 메모의 ID 줄을 지우고, 판매연결 기록에 삭제 시각을 남긴다 */
function wsClearSaleLinkForRow_(ss, sheet, rowNumber) {
  var cell = sheet.getRange(rowNumber, WS_DATE_COLUMN);
  var note = cell.getNote();
  var id = wsSaleIdFromNote_(note);
  if (!id) {
    if (wsRequestIdFromNote_(note)) cell.setNote(wsNoteWithoutRequestId_(note));
    return;
  }
  // 판매 ID 줄과 등록요청 ID 줄을 함께 지운다 (지운 판매로 재전송이 "이미 저장됨" 처리되지 않게)
  cell.setNote(wsNoteWithoutRequestId_(wsNoteWithSaleId_(note, "")));
  var linkSheet = wsLinkSheet_(ss, false);
  var rec = wsReadLinks_(linkSheet)[id];
  if (rec) linkSheet.getRange(rec.row, 11).setValue(new Date());
}

/**
 * 판매연결 저장 요청의 형식 검사 (잠금 전, 장표를 읽지 않음). 문제 있으면 안내 문구, 없으면 "".
 * body: { saleId, patches: [{ field, before, value }], staffId }
 */
function wsLinkRequestError_(body, cfg) {
  var expectedId = String(body.saleId || "");
  if (expectedId && !WS_UUID_RE.test(expectedId)) return "판매 ID 형식이 올바르지 않습니다.";
  var patches = body.patches;
  if (!Array.isArray(patches) || patches.length === 0 || patches.length > 10) return "저장할 항목이 없습니다.";
  var seen = {};
  for (var p = 0; p < patches.length; p++) {
    var item = patches[p] || {};
    if (
      !Object.prototype.hasOwnProperty.call(WS_LINK_EDITABLE, item.field) ||
      seen[item.field] ||
      typeof item.before !== "string" ||
      typeof item.value !== "string"
    ) {
      return "저장할 항목 형식이 올바르지 않습니다.";
    }
    var bad = wsLinkValueError_(item.field, item.value, cfg);
    if (bad) return bad;
    seen[item.field] = true;
  }
  var staffId = String(body.staffId || "");
  if (staffId && wsLinkValueError_("staffId", staffId)) return "직원 ID 형식이 올바르지 않습니다.";
  return "";
}

/**
 * 판매연결 저장 준비 (잠금 안, 아무것도 쓰지 않음). 판매 행(current)이 화면의 판매인지는 호출하는 쪽이 이미 확인했다.
 * 판매 ID·ID 중복·확인값(mismatch)·화면에서 본 값(before)을 확인한다.
 * 반환: { error, code } 또는 { id, rec, live, mismatch }
 */
function wsLinkPrepare_(ss, sheet, sheetName, rowNumber, current, tz, body) {
  var ids = wsSaleIdsOfSheet_(sheet);
  var id = ids.byRow[rowNumber] || "";
  var relink = body.relink === true;
  if (id !== String(body.saleId || "")) {
    return { error: "판매 ID 가 화면과 다릅니다. 화면을 새로고침한 뒤 다시 확인해 주세요." };
  }
  if (id && ids.count[id] !== 1) {
    return { code: "duplicate_id", error: "같은 판매 ID 가 장표의 다른 행에도 있어 저장하지 않았습니다 (행 복사 등). 점장 확인이 필요합니다." };
  }
  var rec = id ? wsReadLinks_(wsLinkSheet_(ss, false))[id] : null;
  var rowCheck = wsSaleCheck_(current, tz);
  var live = !!rec && !wsLinkText_(rec.values[10]);
  var mismatch =
    live && (wsLinkText_(rec.values[1]) !== sheetName || (wsLinkText_(rec.values[11]) && wsLinkText_(rec.values[11]) !== rowCheck));
  if (mismatch && !relink) {
    return {
      code: "mismatch",
      error: "이 판매의 개통일·CTN 이 판매연결 기록과 달라 저장하지 않았습니다 (장표에서 값만 옮긴 경우 등). 점장 확인 후 '새 판매 ID 로 다시 연결'을 사용해 주세요.",
    };
  }
  if (relink && !mismatch) return { error: "다시 연결할 필요가 없는 판매입니다. 화면을 새로고침해 주세요." };
  var now = live && !mismatch ? wsLinkObject_(rec.values) : null;
  for (var q = 0; q < body.patches.length; q++) {
    var have = now ? now[body.patches[q].field] : "";
    if (have !== body.patches[q].before.trim()) {
      return { error: "저장된 판매연결 값이 화면과 달라 저장하지 않았습니다. 화면을 새로고침해 주세요." };
    }
  }
  return { id: id, rec: rec, live: live, mismatch: mismatch };
}

/**
 * 판매연결 저장 (잠금 안). prep = wsLinkPrepare_ 결과, rowValues = 저장 시점의 판매 행 (수정 후 값).
 * 다시 연결(relink)이면 예전 기록을 분리하고 새 ID, 예전 판매(ID 없음)면 이 행에만 새 ID.
 */
function wsLinkCommit_(ss, sheet, sheetName, rowNumber, rowValues, tz, prep, body) {
  var id = prep.id;
  if (prep.mismatch) {
    // 예전 기록은 이 판매로 옮기지 않는다: 분리(삭제 시각)하고 이 행에 새 ID
    wsLinkSheet_(ss, false).getRange(prep.rec.row, 11).setValue(new Date());
    id = "";
  }
  if (!id) {
    id = Utilities.getUuid();
    var cell = sheet.getRange(rowNumber, WS_DATE_COLUMN);
    cell.setNote(wsNoteWithSaleId_(cell.getNote(), id));
  }
  var fields = {};
  for (var w = 0; w < body.patches.length; w++) fields[body.patches[w].field] = body.patches[w].value;
  var staffId = String(body.staffId || "");
  if (staffId) fields.staffId = staffId;
  var saved = wsWriteLink_(ss, id, { sheet: sheetName, date: wsText_(rowValues[2], tz), check: wsSaleCheck_(rowValues, tz) }, fields);
  return { saleId: id, link: saved };
}

function wsHandleSaleLink_(body) {
  var reply = function (obj) {
    obj.handler = WS_SALE_LINK_HANDLER;
    return wsJson_(obj);
  };
  if (!wsAuthorized_(body)) return reply({ ok: false, message: "인증에 실패했습니다." });
  var target = body.target || {};
  var sheetName = String(target.sheet || "").replace(/\s/g, "");
  var rowNumber = Number(target.row);
  if (!wsIsMonthSheetName_(sheetName)) return reply({ ok: false, message: "월 시트 이름이 올바르지 않습니다." });
  if (!(rowNumber >= WS_FIRST_ROW) || Math.floor(rowNumber) !== rowNumber) {
    return reply({ ok: false, message: "행 번호가 올바르지 않습니다." });
  }
  var formatError = wsLinkRequestError_(body, null);
  if (formatError) return reply({ ok: false, message: formatError });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return reply({ ok: false, message: "다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요." });
  try {
    var ss = wsSpreadsheet_();
    // 사용 중 유입경로·캠페인 기준 검사 (설정 시트를 읽어야 하므로 잠금 안에서)
    var cfgError = wsLinkRequestError_(body, wsLinkConfig_(ss));
    if (cfgError) return reply({ ok: false, message: cfgError });
    var tz = ss.getSpreadsheetTimeZone();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return reply({ ok: false, message: sheetName + " 시트를 찾을 수 없습니다." });
    var problem = wsLayoutProblem_(sheet);
    if (problem) return reply({ ok: false, message: sheetName + " 시트의 열 구조가 웹앱과 다릅니다 (" + problem + ")" });
    if (rowNumber > sheet.getLastRow()) return reply({ ok: false, message: "해당 행이 장표에 없습니다." });
    var current = sheet.getRange(rowNumber, 1, 1, WS_COLUMN_COUNT).getValues()[0];
    if (wsIsEmptySale_(current)) return reply({ ok: false, message: "판매 내용이 없는 행입니다. 화면을 새로고침해 주세요." });
    var text = function (v) {
      return wsText_(v, tz);
    };
    var mismatches = [];
    if (text(current[WS_B_INDEX]) !== text(target.no)) mismatches.push("No.");
    if (text(current[2]) !== text(target.activatedAt)) mismatches.push("개통일");
    if (text(current[3]) !== text(target.customer)) mismatches.push("고객");
    if (text(current[4]).replace(/\D/g, "") !== text(target.ctn).replace(/\D/g, "")) mismatches.push("CTN");
    if (mismatches.length) {
      return reply({ ok: false, message: "장표 내용이 화면과 달라 저장하지 않았습니다 (" + mismatches.join(", ") + "). 화면을 새로고침해 주세요." });
    }
    var prep = wsLinkPrepare_(ss, sheet, sheetName, rowNumber, current, tz, body);
    if (prep.error) return reply(prep.code ? { ok: false, code: prep.code, message: prep.error } : { ok: false, message: prep.error });
    var saved = wsLinkCommit_(ss, sheet, sheetName, rowNumber, current, tz, prep, body);
    SpreadsheetApp.flush();
    return reply({ ok: true, sheet: sheetName, row: rowNumber, saleId: saved.saleId, link: saved.link });
  } finally {
    lock.releaseLock();
  }
}

/**
 * 편집기에서 ▶ 실행 (예전 판매 ID 일괄 부여 — 미리보기, 아무것도 바꾸지 않음).
 * 시트 이름을 아래 WS_BACKFILL_SHEET 에 적고 실행하면 ID 없는 판매 수·ID 중복 행을 실행 로그에 적는다.
 */
var WS_BACKFILL_SHEET = "";
function wsSaleIdBackfillPreview() {
  return wsSaleIdBackfill_(false);
}
/** 편집기에서 ▶ 실행 (예전 판매 ID 일괄 부여 — 실제 적용). ※ 운영에서는 별도 승인 후에만 실행 */
function wsSaleIdBackfillApply() {
  return wsSaleIdBackfill_(true);
}
function wsSaleIdBackfill_(apply) {
  var ss = wsSpreadsheet_();
  var sheet = ss.getSheetByName(WS_BACKFILL_SHEET);
  if (!wsIsMonthSheetName_(WS_BACKFILL_SHEET) || !sheet) {
    console.log("WS_BACKFILL_SHEET 에 월 시트 이름(예: 11월)을 적은 뒤 실행하세요.");
    return null;
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var last = sheet.getLastRow();
    var summary = { sheet: WS_BACKFILL_SHEET, sales: 0, withId: 0, assigned: 0, duplicateRows: [] };
    if (last < WS_FIRST_ROW) return summary;
    var values = sheet.getRange(WS_FIRST_ROW, 1, last - WS_FIRST_ROW + 1, WS_COLUMN_COUNT).getValues();
    var ids = wsSaleIdsOfSheet_(sheet);
    for (var i = 0; i < values.length; i++) {
      if (wsIsEmptySale_(values[i])) continue;
      var row = WS_FIRST_ROW + i;
      summary.sales++;
      var id = ids.byRow[row];
      if (id) {
        summary.withId++;
        if (ids.count[id] !== 1) summary.duplicateRows.push(row);
        continue;
      }
      if (apply) {
        var cell = sheet.getRange(row, WS_DATE_COLUMN);
        cell.setNote(wsNoteWithSaleId_(cell.getNote(), Utilities.getUuid()));
      }
      summary.assigned++;
    }
    console.log(
      (apply ? "[적용] " : "[미리보기] ") + summary.sheet + " 판매 " + summary.sales + "건 / 이미 ID " + summary.withId +
        "건 / " + (apply ? "새로 부여 " : "부여 예정 ") + summary.assigned + "건 / ID 중복 행: " +
        (summary.duplicateRows.join(", ") || "없음"),
    );
    return summary;
  } finally {
    lock.releaseLock();
  }
}
