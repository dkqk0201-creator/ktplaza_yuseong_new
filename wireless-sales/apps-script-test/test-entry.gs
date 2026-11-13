/**
 * 무선 판매 관리 웹앱 — 테스트 전용 진입 파일 (인증 테스트용, auth-login 브랜치. 테스트 전용 Apps Script 프로젝트에만 넣는다)
 *
 * ★ 운영 Apps Script(기존 '무선장표 웹앱 테스트' 프로젝트 포함)에는 절대 넣지 않는다.
 *   넣으면 운영 시트 연결을 거부해 운영이 멈춘다 (운영 데이터가 바뀌는 방향의 실패는 아님).
 *
 * 테스트 프로젝트 = 어느 시트에도 붙지 않은 "독립(standalone)" 새 프로젝트.
 * 파일은 정확히 다음 12개 (그 밖의 파일, 특히 기존 Code.gs·기본 Code.gs·total-row.gs 는 두지 않는다):
 *   common.gs, notes.gs, save-handler.gs, update-handler.gs, delete-handler.gs, list-handler.gs,
 *   inspection-review.gs, gobulbi.gs, goal-handler.gs, auth-handler.gs, sale-link.gs, test-entry.gs(이 파일)
 * 웹에서 부를 수 있는 진입 함수는 이 파일의 doPost·doGet 둘뿐이다. 편집기에서 직접 실행해도 되는 함수는
 * wsTestSelfCheck(읽기 전용 점검)와 auth-handler.gs 의 wsAuthReset(로그인 잠금 해제 — 테스트 프로젝트의 스크립트 속성만 바꿈)이다.
 *
 * 스크립트 속성 (코드·GitHub 에 값을 적지 않는다):
 *   SPREADSHEET_ID = 테스트 시트 ID (아래 WS_TEST_CONFIG.SPREADSHEET_ID 와 같아야 함)
 *   API_SECRET     = 테스트 전용 무작위 값 (운영 값과 반드시 다르게)
 *
 * 모든 요청의 순서 (시트 칸을 읽거나 쓰기 전에 1·2 가 먼저):
 *   1) 인증: 스크립트 속성 API_SECRET 과 요청 secret 이 같아야 함 (시트에 접근하지 않음)
 *   2) 테스트 시트 연결 확인 (wsTestGuard_): 하나라도 어긋나면 읽기·쓰기 모두 거부
 *      - 이 프로젝트가 시트에 붙어 있지 않음 (getActiveSpreadsheet() 가 없어야 함)
 *      - 기존 Code.gs 의 CONFIG 가 없음 (운영 Code.gs 가 섞이지 않았는지)
 *      - WS_TEST_CONFIG.SPREADSHEET_ID · 스크립트 속성 SPREADSHEET_ID · 핸들러가 실제로 여는 시트(wsSpreadsheet_)의 ID 가 모두 같음
 *      - 그 ID 가 운영 시트가 아님 (운영 ID 는 코드에 적지 않고 SHA-256 값으로만 비교)
 *      - 시트 이름에 "테스트" 가 있음
 *      - 필요한 핸들러 파일이 모두 있음
 *   3) action "ws-env-check": 연결 확인 결과만 돌려준다 (읽기 전용, 시트 칸에 접근하지 않음)
 *   4) 기존 핸들러를 운영과 같은 순서로 한 번씩, 처음으로 응답한 핸들러에서 멈춘다:
 *      wsHandleSaleUpdate_ → handleGoalRequest_ → handleSaveRequest_ → handleDeleteRequest_ → handleListRequest_
 *      (wsHandleSaleUpdate_ 가 inspection-review·gobulbi·auth-login·auth-check·auth-logout 요청도 넘겨받는다)
 */
var WS_TEST_ENTRY = "test-entry";
var WS_TEST_ENTRY_VERSION = 1;
var WS_TEST_CONFIG = {
  // 테스트 시트 "무선장표 테스트전용" (가짜 데이터 전용, 2026-11-05 새로 만든 독립 파일)
  SPREADSHEET_ID: "1qM57jAfArHW1CGTfpKYJWeFQZ01EEL5CM1L7BWatti4",
  NAME_MUST_INCLUDE: "테스트",
};
// 운영 시트 ID 의 SHA-256 (16진수). ID 자체는 코드에 적지 않는다
var WS_TEST_PROD_ID_SHA256 = ["1abf293ff422814926724c91f55505ff5173b28f65d856223c4a7a6bb12f98e3"];
var WS_TEST_HANDLERS = [
  "wsHandleSaleUpdate_",
  "handleGoalRequest_",
  "handleSaveRequest_",
  "handleDeleteRequest_",
  "handleListRequest_",
];
// 핸들러 외에 반드시 있어야 하는 파일 (파일마다 그 파일에만 있는 함수로 확인)
var WS_TEST_REQUIRED_FILES = {
  "common.gs": function () { return typeof wsSpreadsheet_ === "function" && typeof wsJson_ === "function"; },
  "notes.gs": function () { return typeof wsSaveNotesForRows_ === "function"; },
  "save-handler.gs": function () { return typeof handleSaveRequest_ === "function" && typeof wsRowFormula_ === "function"; },
  "update-handler.gs": function () { return typeof wsHandleSaleUpdate_ === "function"; },
  "delete-handler.gs": function () { return typeof handleDeleteRequest_ === "function"; },
  "list-handler.gs": function () { return typeof handleListRequest_ === "function"; },
  "inspection-review.gs": function () { return typeof wsHandleInspectionReview_ === "function"; },
  "gobulbi.gs": function () { return typeof wsHandleGobulbi_ === "function"; },
  "goal-handler.gs": function () { return typeof handleGoalRequest_ === "function"; },
  "auth-handler.gs": function () { return typeof wsHandleAuth_ === "function"; },
  "sale-link.gs": function () { return typeof wsHandleSaleLink_ === "function"; },
};

function wsTestSha256_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  var hex = "";
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? "0" : "") + b.toString(16);
  }
  return hex;
}
function wsTestIsProdId_(id) {
  return !!id && WS_TEST_PROD_ID_SHA256.indexOf(wsTestSha256_(id)) !== -1;
}

/** 테스트 시트 연결 확인. 문제가 있으면 문제 목록(글자), 없으면 { ss } */
function wsTestCheck_() {
  var problems = [];
  var configId = String(WS_TEST_CONFIG.SPREADSHEET_ID || "");
  var propId = String(PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID") || "");
  if (!configId) problems.push("WS_TEST_CONFIG.SPREADSHEET_ID 없음");
  if (wsTestIsProdId_(configId)) problems.push("WS_TEST_CONFIG 에 운영 시트 ID");
  if (!propId) problems.push("스크립트 속성 SPREADSHEET_ID 없음");
  if (wsTestIsProdId_(propId)) problems.push("스크립트 속성 SPREADSHEET_ID 가 운영 시트");
  if (configId && propId && configId !== propId) problems.push("WS_TEST_CONFIG 와 스크립트 속성 SPREADSHEET_ID 가 다름");
  if (typeof CONFIG !== "undefined") problems.push("기존 Code.gs(CONFIG)가 프로젝트에 있음");
  var active = null;
  try {
    active = SpreadsheetApp.getActiveSpreadsheet();
  } catch (err) {
    active = null;
  }
  if (active) problems.push("시트에 붙은 프로젝트 (독립 프로젝트가 아님)");
  var missing = [];
  for (var i = 0; i < WS_TEST_HANDLERS.length; i++) {
    if (typeof globalThis[WS_TEST_HANDLERS[i]] !== "function") missing.push(WS_TEST_HANDLERS[i]);
  }
  for (var f in WS_TEST_REQUIRED_FILES) {
    if (!WS_TEST_REQUIRED_FILES[f]()) missing.push(f);
  }
  if (missing.length > 0) problems.push("빠진 파일·핸들러: " + missing.join(", "));
  // 앞의 문제가 있으면 시트를 열지 않는다
  if (problems.length > 0) return { problems: problems };

  var ss = null;
  try {
    ss = wsSpreadsheet_(); // 핸들러가 실제로 쓰는 바로 그 경로
  } catch (err) {
    return { problems: ["테스트 시트를 열 수 없음"] };
  }
  var id = ss && ss.getId ? String(ss.getId()) : "";
  if (!id) problems.push("열린 시트 ID 없음");
  if (wsTestIsProdId_(id)) problems.push("열린 시트가 운영 시트");
  if (id !== configId) problems.push("열린 시트가 테스트 시트가 아님");
  var name = ss && ss.getName ? String(ss.getName()) : "";
  if (name.indexOf(WS_TEST_CONFIG.NAME_MUST_INCLUDE) === -1) problems.push("시트 이름에 '테스트' 없음");
  if (problems.length > 0) return { problems: problems };
  return { problems: [], ss: ss, id: id, name: name };
}

/** 요청 본문·인증 — common.gs 가 빠져 있어도 동작하도록 이 파일 안에서 따로 (시트에 접근하지 않음) */
function wsTestBody_(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    return body && typeof body === "object" ? body : null;
  } catch (err) {
    return null;
  }
}
function wsTestAuthorized_(body) {
  var secret = PropertiesService.getScriptProperties().getProperty("API_SECRET");
  return !!secret && typeof body.secret === "string" && body.secret === secret;
}

function wsTestReply_(obj) {
  obj.entry = WS_TEST_ENTRY;
  obj.entryVersion = WS_TEST_ENTRY_VERSION;
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  // 1) 인증 (시트에 접근하지 않음)
  var body = wsTestBody_(e);
  if (!body || !wsTestAuthorized_(body)) {
    return wsTestReply_({ ok: false, message: "인증에 실패했습니다." });
  }
  // 2) 테스트 시트 연결 확인 — 실패하면 읽기·쓰기 모두 하지 않는다
  var check = wsTestCheck_();
  if (check.problems.length > 0) {
    return wsTestReply_({ ok: false, handler: "ws-test-guard", message: "테스트 보호: " + check.problems.join(" / ") });
  }
  // 3) 연결 확인만 (읽기 전용)
  if (body.action === "ws-env-check") {
    return wsTestReply_({
      ok: true,
      handler: "ws-test-guard",
      name: check.name,
      idTail: check.id.slice(-6),
      handlers: WS_TEST_HANDLERS.slice(),
    });
  }
  // 4) 기존 핸들러를 운영과 같은 순서로 한 번씩
  for (var i = 0; i < WS_TEST_HANDLERS.length; i++) {
    var out = globalThis[WS_TEST_HANDLERS[i]](e);
    if (out) return out;
  }
  return wsTestReply_({ ok: false, message: "알 수 없는 요청입니다." });
}

/** 웹 GET 은 아무 데이터에도 접근하지 않는다 */
function doGet() {
  return wsTestReply_({ ok: false, message: "POST 요청만 받습니다." });
}

/** 편집기에서 ▶ 실행하는 읽기 전용 점검 (결과는 실행 로그에). 시트 칸에는 접근하지 않는다 */
function wsTestSelfCheck() {
  var check = wsTestCheck_();
  var entryOk = String(doPost).indexOf("wsTestCheck_") !== -1;
  var secretSet = !!PropertiesService.getScriptProperties().getProperty("API_SECRET");
  var lines = [
    "doPost 가 test-entry.gs 의 것: " + (entryOk ? "예" : "아니오 (다른 파일에 doPost 가 있음 — 지우세요)"),
    "API_SECRET 설정: " + (secretSet ? "예" : "아니오"),
    check.problems.length === 0
      ? "테스트 시트 연결: 정상 (" + check.name + ", ID 끝 " + check.id.slice(-6) + ")"
      : "테스트 시트 연결: 거부 — " + check.problems.join(" / "),
  ];
  console.log(lines.join("\n"));
  return entryOk && secretSet && check.problems.length === 0;
}
