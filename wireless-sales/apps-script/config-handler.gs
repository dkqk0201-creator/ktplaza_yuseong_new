/**
 * 무선 판매 관리 웹앱 — 유입경로 항목 · 캠페인 목록 (Apps Script 에 새 파일 config-handler.gs 로 추가)
 *
 * 숨김 보조 시트 (처음 저장할 때 자동 생성·숨김. 직접 고치지 마세요). 월 시트·양식 시트는 건드리지 않는다.
 *   웹앱유입경로    : 항목 | 별칭(쉼표) | 사용여부(Y/N) | 순서 | 수정 시각
 *                    시트가 없으면 기본 5개(네이버·자점·TM·내방·외부영업). "미확인"은 항목과 별도로 항상 고를 수 있다.
 *                    판매연결에는 항목 이름이 저장되므로 이름 변경·삭제는 받지 않는다 (사용 안 함으로만).
 *   웹앱캠페인      : 캠페인ID | 캠페인명 | 별칭(쉼표) | 유형 | 시작일 | 종료일 | 상태 | 사용여부(Y/N) | 수정 시각
 *                    캠페인ID(CMP-0001)는 Apps Script 가 만든다. 이름을 바꿔도 ID 로 판매가 연결된다.
 *   웹앱캠페인이력  : 변경 시각 | 캠페인ID | 항목 | 변경 전 | 변경 후
 *
 * 요청 (웹앱 서버만, API_SECRET 필요). doPost 는 고치지 않는다 — update-handler.gs 입구(wsHandleSaleUpdate_)가 넘겨준다.
 *   config-get                                   → { inflows, campaigns, inflowVersion, campaignVersion }
 *   config-inflow-save   { items, version }      → 항목 목록 전체 저장 (화면에서 본 version 과 다르면 거부)
 *   config-campaign-save { campaign, version }   → 캠페인 1개 추가(id 없음)·수정, 바뀐 항목은 이력에
 *   config-campaign-attach { campaignId, apply } → 캠페인ID 없이 원문만 있는 판매연결 중 이 캠페인 이름·별칭과
 *                                                  같은 원문을 찾아(apply: false = 건수만) 캠페인ID 를 넣는다
 * 응답 handler = "ws-config"
 */
var WS_CONFIG_HANDLER = "ws-config";
var WS_INFLOW_SHEET = "웹앱유입경로";
var WS_INFLOW_HEADER = ["항목", "별칭", "사용여부", "순서", "수정 시각"];
var WS_CAMPAIGN_SHEET = "웹앱캠페인";
var WS_CAMPAIGN_HEADER = ["캠페인ID", "캠페인명", "별칭", "유형", "시작일", "종료일", "상태", "사용여부", "수정 시각"];
var WS_CAMPAIGN_HISTORY_SHEET = "웹앱캠페인이력";
var WS_CAMPAIGN_HISTORY_HEADER = ["변경 시각", "캠페인ID", "항목", "변경 전", "변경 후"];
var WS_CAMPAIGN_TYPES = ["매장 행사", "신제품 사전예약", "기타"];
var WS_CAMPAIGN_STATUSES = ["예정", "진행", "종료"];
var WS_INFLOW_UNKNOWN = "미확인";
/** 기본 유입경로 (웹앱 lib/inflow-options.ts DEFAULT_INFLOW_OPTIONS 와 같게) */
var WS_INFLOW_DEFAULTS = [
  { name: "네이버", aliases: ["네이버", "플레이스", "스마트플레이스", "네이버플레이스", "블로그", "네이버블로그", "네이버예약"], active: true, order: 1 },
  { name: "자점", aliases: ["자점", "단골", "자점단골", "자점단골고객", "단골고객", "기존고객"], active: true, order: 2 },
  { name: "TM", aliases: ["tm", "텔레마케팅"], active: true, order: 3 },
  { name: "내방", aliases: ["내방", "자연방문", "워크인"], active: true, order: 4 },
  { name: "외부영업", aliases: ["외부영업", "외부", "상가", "전단지"], active: true, order: 5 },
];

/** 두 객체를 합친 새 객체 (Object.assign 대신 — 예전 런타임 호환) */
function wsConfigMerge_(a, b) {
  var out = {};
  for (var k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
  for (var j in b) if (Object.prototype.hasOwnProperty.call(b, j)) out[j] = b[j];
  return out;
}

function wsConfigText_(v) {
  return String(v === null || v === undefined ? "" : v).replace(/^'/, "").trim();
}
function wsConfigKey_(v) {
  return String(v || "").replace(/\s+/g, "").toLowerCase();
}
function wsConfigList_(text) {
  return wsConfigText_(text)
    .split(",")
    .map(function (a) {
      return a.trim();
    })
    .filter(function (a) {
      return a !== "";
    });
}
function wsConfigDate_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, "yyyy-MM-dd");
  var t = wsConfigText_(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : "";
}

/** 보조 시트 (create 가 true 면 없을 때 만들고 숨김) */
function wsConfigSheet_(ss, name, header, create) {
  var sheet = ss.getSheetByName(name);
  if (!sheet && create) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.hideSheet();
  }
  return sheet;
}

/** 유입경로 항목 목록 (시트가 없거나 비어 있으면 기본 5개) */
function wsReadInflows_(ss) {
  var sheet = wsConfigSheet_(ss, WS_INFLOW_SHEET, WS_INFLOW_HEADER, false);
  var out = [];
  if (sheet && sheet.getLastRow() >= 2) {
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, WS_INFLOW_HEADER.length).getValues();
    for (var i = 0; i < rows.length; i++) {
      var name = wsConfigText_(rows[i][0]);
      if (!name) continue;
      var order = Number(rows[i][3]);
      out.push({
        name: name,
        aliases: wsConfigList_(rows[i][1]),
        active: wsConfigText_(rows[i][2]).toUpperCase() !== "N",
        order: Math.floor(order) === order && order >= 1 ? order : out.length + 1,
      });
    }
  }
  if (out.length === 0) {
    out = WS_INFLOW_DEFAULTS.map(function (o) {
      return { name: o.name, aliases: o.aliases.slice(), active: true, order: o.order };
    });
  }
  return out;
}

/** 새 판매에 저장할 수 있는 유입경로 이름 (사용 중 항목 + 미확인) — sale-link.gs 값 검사에 사용 */
function wsActiveInflowNames_(ss) {
  var names = wsReadInflows_(ss)
    .filter(function (o) {
      return o.active;
    })
    .map(function (o) {
      return o.name;
    });
  names.push(WS_INFLOW_UNKNOWN);
  return names;
}

/** 캠페인 목록 */
function wsReadCampaigns_(ss) {
  var sheet = wsConfigSheet_(ss, WS_CAMPAIGN_SHEET, WS_CAMPAIGN_HEADER, false);
  var out = [];
  if (!sheet || sheet.getLastRow() < 2) return out;
  var tz = ss.getSpreadsheetTimeZone();
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, WS_CAMPAIGN_HEADER.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    var id = wsConfigText_(rows[i][0]);
    if (!/^CMP-\d{4}$/.test(id)) continue;
    out.push({
      id: id,
      row: i + 2,
      name: wsConfigText_(rows[i][1]),
      aliases: wsConfigList_(rows[i][2]),
      type: wsConfigText_(rows[i][3]),
      start: wsConfigDate_(rows[i][4], tz),
      end: wsConfigDate_(rows[i][5], tz),
      status: wsConfigText_(rows[i][6]),
      active: wsConfigText_(rows[i][7]).toUpperCase() !== "N",
      updatedAt: rows[i][8] instanceof Date ? Utilities.formatDate(rows[i][8], tz, "yyyy-MM-dd HH:mm") : wsConfigText_(rows[i][8]),
    });
  }
  return out;
}

/** 사용 중 캠페인ID { id: true } — sale-link.gs 값 검사에 사용 */
function wsActiveCampaignIds_(ss) {
  var ids = {};
  var list = wsReadCampaigns_(ss);
  for (var i = 0; i < list.length; i++) if (list[i].active) ids[list[i].id] = true;
  return ids;
}

/** 화면에 돌려줄 모양 (시트 행 번호 등은 빼고) */
function wsCampaignView_(c) {
  return { id: c.id, name: c.name, aliases: c.aliases, type: c.type, start: c.start, end: c.end, status: c.status, active: c.active, updatedAt: c.updatedAt };
}

/** 목록 판 (화면에서 본 판과 같아야 저장) */
function wsConfigVersion_(list) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(list), Utilities.Charset.UTF_8);
  var hex = "";
  for (var i = 0; i < 8; i++) {
    var b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? "0" : "") + b.toString(16);
  }
  return hex;
}

function wsConfigState_(ss) {
  var inflows = wsReadInflows_(ss);
  var campaigns = wsReadCampaigns_(ss).map(wsCampaignView_);
  return {
    inflows: inflows,
    campaigns: campaigns,
    inflowVersion: wsConfigVersion_(inflows),
    campaignVersion: wsConfigVersion_(campaigns),
  };
}

/** 유입경로 목록 검사 (웹앱 lib/inflow-options.ts inflowOptionsError 와 같은 기준) */
function wsInflowItemsError_(items, previous) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) return "항목은 1~20개까지 둘 수 있습니다.";
  var names = {};
  var aliasOwner = {};
  var anyActive = false;
  for (var i = 0; i < items.length; i++) {
    var o = items[i] || {};
    var name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name || name.length > 10) return "항목 이름은 1~10자로 입력해 주세요.";
    if (/[,|]/.test(name)) return "항목 이름에 쉼표(,)나 | 는 쓸 수 없습니다.";
    if (["미확인", "미입력", "확인 필요", "모름"].indexOf(name) >= 0 || name.indexOf("기존값") === 0) return "\"" + name + "\" 은(는) 항목 이름으로 쓸 수 없습니다.";
    if (names[wsConfigKey_(name)]) return "항목 이름 \"" + name + "\" 이(가) 두 번 있습니다.";
    names[wsConfigKey_(name)] = true;
    if (typeof o.active !== "boolean") return "사용 여부가 올바르지 않습니다.";
    if (o.active) anyActive = true;
    if (Math.floor(Number(o.order)) !== Number(o.order) || o.order < 1 || o.order > 999) return "순서는 1~999 사이 숫자여야 합니다.";
    if (!Array.isArray(o.aliases) || o.aliases.length > 20) return "별칭이 올바르지 않습니다.";
    var all = [name].concat(o.aliases);
    for (var a = 0; a < all.length; a++) {
      if (typeof all[a] !== "string") return "별칭이 올바르지 않습니다.";
      var k = wsConfigKey_(all[a]);
      if (!k) continue;
      if (all[a].length > 20 || /[,|]/.test(all[a])) return "별칭은 20자 이내로, 쉼표(,)·| 없이 입력해 주세요.";
      if (k === "미확인" || k === "모름") return "\"" + all[a] + "\" 은(는) 별칭으로 쓸 수 없습니다.";
      if (aliasOwner[k] && aliasOwner[k] !== name) return "\"" + all[a] + "\" 이(가) 두 항목에 있습니다.";
      aliasOwner[k] = name;
    }
  }
  if (!anyActive) return "사용 중인 항목이 하나 이상 있어야 합니다.";
  for (var p = 0; p < previous.length; p++) {
    var kept = false;
    for (var q = 0; q < items.length; q++) if (String(items[q].name).trim() === previous[p].name) kept = true;
    if (!kept) return "\"" + previous[p].name + "\" 항목은 지울 수 없습니다. 사용 안 함으로 바꿔 주세요.";
  }
  return "";
}

/** 캠페인 입력 검사 (웹앱 lib/campaigns.ts campaignInputError 와 같은 기준) */
function wsCampaignInputError_(c, others) {
  var name = typeof c.name === "string" ? c.name.trim() : "";
  var none = ["", "없음", "x", "-", "없어요", "해당없음", "no", "none"];
  if (!name || name.length > 40) return "캠페인명은 1~40자로 입력해 주세요.";
  if (/[|]/.test(name)) return "캠페인명에 | 는 쓸 수 없습니다.";
  if (none.indexOf(wsConfigKey_(name)) >= 0) return "캠페인 없음으로 쓰는 표현은 캠페인명으로 쓸 수 없습니다.";
  if (WS_CAMPAIGN_TYPES.indexOf(c.type) < 0) return "유형을 골라 주세요.";
  if (WS_CAMPAIGN_STATUSES.indexOf(c.status) < 0) return "상태를 골라 주세요.";
  var date = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof c.start !== "string" || (c.start && !date.test(c.start))) return "시작일 형식이 올바르지 않습니다.";
  if (typeof c.end !== "string" || (c.end && !date.test(c.end))) return "종료일 형식이 올바르지 않습니다.";
  if (c.start && c.end && c.start > c.end) return "종료일이 시작일보다 빠릅니다.";
  if (typeof c.active !== "boolean") return "사용 여부가 올바르지 않습니다.";
  if (!Array.isArray(c.aliases) || c.aliases.length > 10) return "별칭은 10개까지 넣을 수 있습니다.";
  var mine = [name];
  for (var a = 0; a < c.aliases.length; a++) {
    if (typeof c.aliases[a] !== "string") return "별칭이 올바르지 않습니다.";
    var t = c.aliases[a].trim();
    if (!t) continue;
    if (t.length > 40 || /[,|]/.test(t)) return "별칭은 40자 이내로, 쉼표(,)·| 없이 입력해 주세요.";
    if (none.indexOf(wsConfigKey_(t)) >= 0) return "캠페인 없음으로 쓰는 표현은 별칭으로 쓸 수 없습니다.";
    mine.push(t);
  }
  for (var m = 0; m < mine.length; m++) {
    var k = wsConfigKey_(mine[m]);
    for (var o = 0; o < others.length; o++) {
      var theirs = [others[o].name].concat(others[o].aliases);
      for (var x = 0; x < theirs.length; x++) {
        if (wsConfigKey_(theirs[x]) === k) return "\"" + mine[m] + "\" 은(는) 이미 \"" + others[o].name + "\" 캠페인에서 쓰고 있습니다.";
      }
    }
  }
  return "";
}

/** 캠페인ID 없이 원문만 있는 판매연결 중 이 캠페인 이름·별칭과 같은 원문 (살아 있는 기록만) */
function wsCampaignAttachTargets_(ss, campaign) {
  var sheet = typeof wsLinkSheet_ === "function" ? wsLinkSheet_(ss, false) : null;
  if (!sheet) return [];
  var keys = {};
  [campaign.name].concat(campaign.aliases).forEach(function (a) {
    var k = wsConfigKey_(a);
    if (k) keys[k] = true;
  });
  var links = wsReadLinks_(sheet);
  var out = [];
  for (var id in links) {
    if (!Object.prototype.hasOwnProperty.call(links, id)) continue;
    var v = links[id].values;
    if (wsConfigText_(v[10])) continue; // 삭제된 판매
    if (wsConfigText_(v[12])) continue; // 이미 캠페인ID 있음
    if (keys[wsConfigKey_(wsConfigText_(v[5]))]) out.push(links[id].row);
  }
  return out;
}

function wsHandleConfig_(body) {
  var reply = function (obj) {
    obj.handler = WS_CONFIG_HANDLER;
    return wsJson_(obj);
  };
  if (!wsAuthorized_(body)) return reply({ ok: false, message: "인증에 실패했습니다." });
  var action = body.action;
  if (action === "config-get") {
    return reply(wsConfigMerge_({ ok: true }, wsConfigState_(wsSpreadsheet_())));
  }
  if (action !== "config-inflow-save" && action !== "config-campaign-save" && action !== "config-campaign-attach") {
    return reply({ ok: false, message: "알 수 없는 설정 요청입니다." });
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return reply({ ok: false, message: "다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요." });
  try {
    var ss = wsSpreadsheet_();
    var state = wsConfigState_(ss);
    var now = new Date();

    if (action === "config-inflow-save") {
      if (String(body.version || "") !== state.inflowVersion) {
        return reply({ ok: false, code: "conflict", message: "그사이 유입경로 항목이 바뀌었습니다. 화면을 새로고침한 뒤 다시 저장해 주세요." });
      }
      var items = body.items;
      var problem = wsInflowItemsError_(items, state.inflows);
      if (problem) return reply({ ok: false, message: problem });
      var sheet = wsConfigSheet_(ss, WS_INFLOW_SHEET, WS_INFLOW_HEADER, true);
      var rows = items.map(function (o) {
        return [
          "'" + o.name.trim(),
          o.aliases
            .map(function (a) {
              return String(a).trim();
            })
            .filter(function (a) {
              return a !== "";
            })
            .join(","),
          o.active ? "Y" : "N",
          Number(o.order),
          now,
        ];
      });
      if (sheet.getLastRow() >= 2) sheet.getRange(2, 1, sheet.getLastRow() - 1, WS_INFLOW_HEADER.length).clearContent();
      sheet.getRange(2, 1, rows.length, WS_INFLOW_HEADER.length).setValues(rows);
      SpreadsheetApp.flush();
      return reply(wsConfigMerge_({ ok: true, message: "유입경로 항목을 저장했습니다." }, wsConfigState_(ss)));
    }

    var all = wsReadCampaigns_(ss);
    if (action === "config-campaign-attach") {
      var targetId = String(body.campaignId || "");
      var campaign = null;
      for (var t = 0; t < all.length; t++) if (all[t].id === targetId) campaign = all[t];
      if (!campaign || !campaign.active) return reply({ ok: false, message: "사용 중인 캠페인을 찾을 수 없습니다." });
      var targets = wsCampaignAttachTargets_(ss, campaign);
      if (body.apply === true && targets.length > 0) {
        var linkSheet = wsLinkSheet_(ss, true);
        for (var r = 0; r < targets.length; r++) {
          linkSheet.getRange(targets[r], 13).setValue("'" + campaign.id);
          linkSheet.getRange(targets[r], 10).setValue(now);
        }
        var hs = wsConfigSheet_(ss, WS_CAMPAIGN_HISTORY_SHEET, WS_CAMPAIGN_HISTORY_HEADER, true);
        hs.getRange(hs.getLastRow() + 1, 1, 1, WS_CAMPAIGN_HISTORY_HEADER.length).setValues([[now, "'" + campaign.id, "판매 연결", "", "'" + targets.length + "건"]]);
        SpreadsheetApp.flush();
      }
      return reply({ ok: true, count: targets.length, applied: body.apply === true, message: body.apply === true ? targets.length + "건을 연결했습니다." : "" });
    }

    // config-campaign-save
    if (String(body.version || "") !== state.campaignVersion) {
      return reply({ ok: false, code: "conflict", message: "그사이 캠페인 목록이 바뀌었습니다. 화면을 새로고침한 뒤 다시 저장해 주세요." });
    }
    var input = body.campaign || {};
    var id = String(input.id || "");
    var existing = null;
    if (id) {
      for (var e = 0; e < all.length; e++) if (all[e].id === id) existing = all[e];
      if (!existing) return reply({ ok: false, message: "수정할 캠페인을 찾을 수 없습니다." });
    }
    var others = all.filter(function (c) {
      return c.id !== id;
    });
    var bad = wsCampaignInputError_(input, others);
    if (bad) return reply({ ok: false, message: bad });
    if (!existing && all.length >= 500) return reply({ ok: false, message: "캠페인은 500개까지 만들 수 있습니다." });
    if (!existing) {
      var max = 0;
      for (var n = 0; n < all.length; n++) max = Math.max(max, Number(all[n].id.slice(4)));
      id = "CMP-" + ("000" + (max + 1)).slice(-4);
    }
    var aliases = input.aliases
      .map(function (a) {
        return a.trim();
      })
      .filter(function (a) {
        return a !== "";
      });
    var next = {
      name: input.name.trim(),
      aliases: aliases.join(","),
      type: input.type,
      start: input.start,
      end: input.end,
      status: input.status,
      active: input.active ? "Y" : "N",
    };
    var row = [
      "'" + id,
      "'" + next.name,
      next.aliases,
      next.type,
      next.start ? "'" + next.start : "",
      next.end ? "'" + next.end : "",
      next.status,
      next.active,
      now,
    ];
    var csheet = wsConfigSheet_(ss, WS_CAMPAIGN_SHEET, WS_CAMPAIGN_HEADER, true);
    var targetRow = existing ? existing.row : csheet.getLastRow() + 1;
    csheet.getRange(targetRow, 1, 1, WS_CAMPAIGN_HEADER.length).setValues([row]);
    // 변경 이력 (바뀐 항목만, 새 캠페인은 "새로 등록" 한 줄)
    var history = [];
    if (!existing) {
      history.push([now, "'" + id, "새로 등록", "", "'" + next.name]);
    } else {
      var before = {
        name: existing.name,
        aliases: existing.aliases.join(","),
        type: existing.type,
        start: existing.start,
        end: existing.end,
        status: existing.status,
        active: existing.active ? "Y" : "N",
      };
      var labels = { name: "캠페인명", aliases: "별칭", type: "유형", start: "시작일", end: "종료일", status: "상태", active: "사용여부" };
      for (var key in labels) {
        if (before[key] !== next[key]) history.push([now, "'" + id, labels[key], "'" + before[key], "'" + next[key]]);
      }
    }
    if (history.length) {
      var hsheet = wsConfigSheet_(ss, WS_CAMPAIGN_HISTORY_SHEET, WS_CAMPAIGN_HISTORY_HEADER, true);
      hsheet.getRange(hsheet.getLastRow() + 1, 1, history.length, WS_CAMPAIGN_HISTORY_HEADER.length).setValues(history);
    }
    SpreadsheetApp.flush();
    return reply(wsConfigMerge_({ ok: true, id: id, message: existing ? "캠페인을 수정했습니다." : "캠페인을 등록했습니다." }, wsConfigState_(ss)));
  } finally {
    lock.releaseLock();
  }
}
