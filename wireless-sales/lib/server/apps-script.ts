import "server-only";
import { COLUMN_COUNT, type SheetRowArray } from "@/lib/sheet-columns";

/*
 * Google Apps Script 웹앱과 통신한다.
 * - 저장: { secret, action: "save", row } → 판매 1건(A~AL 38칸, null 칸은 건드리지 않음)
 *         { secret, action: "save", rows } → 여러 건을 한 번에 (잠금·장표 읽기 1번)
 * - 조회: { secret, action: "list", sheet? } → 월 시트의 판매내역 (없으면 이번 달)
 * - 삭제: { secret, action: "delete", target }
 * - 목표: { secret, action: "goal-get" | "goal-set", month, goal? }
 * 주소와 비밀값은 서버 환경변수에서만 읽고, 어떤 경우에도 응답·로그에 넣지 않는다.
 * 어느 월 시트·어느 행인지는 Apps Script가 정한다.
 */

export type AppsScriptErrorCode =
  | "not_configured"
  | "timeout"
  | "network"
  | "bad_response"
  | "rejected";

export class AppsScriptError extends Error {
  constructor(
    public readonly code: AppsScriptErrorCode,
    message: string,
    /** Apps Script 가 거부할 때 함께 보낸 정보 (예: 조회 가능한 월 시트 목록) */
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AppsScriptError";
  }
}

export interface AppsScriptSaveResult {
  sheet: string;
  row: number;
  no: string;
  message: string;
}

const REQUEST_TIMEOUT_MS = 30_000;
/** 여러 건 저장은 건수만큼 쓰기가 늘어나므로 조금 더 기다린다 */
const BATCH_TIMEOUT_MS = 60_000;
/** Apps Script save-handler.gs 의 WS_SAVE_BATCH_MAX 와 같아야 한다 */
export const SAVE_BATCH_MAX = 30;

function readConfig(): { url: string; secret: string } {
  const url = process.env.APPS_SCRIPT_URL?.trim();
  const secret = process.env.APPS_SCRIPT_API_SECRET?.trim();
  if (!url || !secret) {
    throw new AppsScriptError(
      "not_configured",
      "APPS_SCRIPT_URL 또는 APPS_SCRIPT_API_SECRET 환경변수가 설정되지 않았습니다.",
    );
  }
  try {
    new URL(url);
  } catch {
    throw new AppsScriptError(
      "not_configured",
      "APPS_SCRIPT_URL 환경변수가 올바른 주소가 아닙니다.",
    );
  }
  return { url, secret };
}

function shortText(value: unknown, maxLength = 200): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

/** Apps Script에 요청을 보내고 ok: true 인 JSON 응답만 돌려준다. */
async function postToAppsScript(
  payload: Record<string, unknown>,
  rejectedMessage: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const { url, secret } = readConfig();

  let response: Response;
  try {
    // Apps Script는 응답을 다른 주소로 넘겨주므로(redirect) 따라가야 결과를 받을 수 있다
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, ...payload }),
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut =
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new AppsScriptError(
      timedOut ? "timeout" : "network",
      timedOut
        ? "Apps Script 응답 시간이 초과되었습니다."
        : "Apps Script에 연결하지 못했습니다.",
    );
  }

  const body = await response.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body);
  } catch {
    // JSON 이 아니면(예: Apps Script 오류 페이지) 원인 확인용으로 응답 앞부분 글자를 함께 남긴다
    const snippet = body
      .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#39;|&quot;|&amp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    throw new AppsScriptError(
      "bad_response",
      `Apps Script 응답을 읽을 수 없습니다. (HTTP ${response.status}${snippet ? `: ${snippet}` : ""})`,
    );
  }

  if (data.ok !== true) {
    throw new AppsScriptError(
      "rejected",
      shortText(data.message) || rejectedMessage,
      data,
    );
  }
  return data;
}

export async function saveRowToAppsScript(
  row: SheetRowArray,
): Promise<AppsScriptSaveResult> {
  checkRow(row);
  const data = await postToAppsScript(
    { action: "save", row },
    "Apps Script가 저장을 거부했습니다.",
  );

  const sheet = shortText(data.sheet, 50);
  const no = data.no === undefined || data.no === null ? "" : String(data.no);
  const rowNumber = Number(data.row);
  // UMNP 판매는 No. 가 빈칸 (B열 판매 No. 없음)
  if (!sheet || !Number.isInteger(rowNumber)) {
    throw new AppsScriptError(
      "bad_response",
      "Apps Script 응답에 저장 위치(sheet, row, no)가 없습니다.",
    );
  }

  return { sheet, row: rowNumber, no, message: shortText(data.message) };
}

function checkRow(row: SheetRowArray) {
  if (row.length !== COLUMN_COUNT) {
    throw new AppsScriptError(
      "bad_response",
      `전송할 행이 ${COLUMN_COUNT}칸(A~AL)이 아닙니다.`,
    );
  }
  if (row[1] !== null) {
    throw new AppsScriptError("bad_response", "B열(No.)은 보낼 수 없습니다.");
  }
}

export type AppsScriptBatchItem =
  | {
      ok: true;
      sheet: string;
      row: number;
      no: string;
      /** 참고내용을 보조 시트에 보관했는지 (Apps Script 가 예전 버전이면 false) */
      notesSaved: boolean;
    }
  | { ok: false; error: AppsScriptError };

/**
 * 여러 건을 Apps Script 한 번 호출로 저장한다 (잠금·열 구조 확인·장표 읽기 1번).
 * 결과는 보낸 순서대로 건별 성공/실패.
 * Apps Script 가 아직 예전 버전(여러 건 저장 미지원)이면, 아무것도 쓰지 않고
 * 거부한 것이 확실하므로 1건씩 저장하는 예전 방식으로 이어서 처리한다.
 */
export async function saveRowsToAppsScript(
  rows: SheetRowArray[],
  /** rows 와 같은 순서의 판매보고 참고내용 (장표 A~AL 이 아닌 보조 시트에 보관) */
  notes?: (Record<string, string> | null)[],
): Promise<AppsScriptBatchItem[]> {
  if (rows.length === 0 || rows.length > SAVE_BATCH_MAX) {
    throw new AppsScriptError(
      "bad_response",
      `한 번에 1~${SAVE_BATCH_MAX}건까지 저장할 수 있습니다.`,
    );
  }
  rows.forEach(checkRow);

  let data: Record<string, unknown>;
  try {
    data = await postToAppsScript(
      notes ? { action: "save", rows, notes } : { action: "save", rows },
      "Apps Script가 저장을 거부했습니다.",
      BATCH_TIMEOUT_MS,
    );
  } catch (error) {
    // 예전 save-handler 는 row 가 없으면 저장 전에 "38칸(A~AL)이 아닙니다" 로 거부한다
    if (
      error instanceof AppsScriptError &&
      error.code === "rejected" &&
      error.message.includes("칸(A~AL)이 아닙니다")
    ) {
      const fallback: AppsScriptBatchItem[] = [];
      for (const row of rows) {
        try {
          fallback.push({
            ok: true,
            notesSaved: false,
            ...(await saveRowToAppsScript(row)),
          });
        } catch (e) {
          if (!(e instanceof AppsScriptError)) throw e;
          fallback.push({ ok: false, error: e });
        }
      }
      return fallback;
    }
    throw error;
  }

  const sheet = shortText(data.sheet, 50);
  const results = Array.isArray(data.results) ? data.results : null;
  if (!sheet || !results || results.length !== rows.length) {
    throw new AppsScriptError(
      "bad_response",
      "Apps Script 응답에 건별 저장 결과가 없습니다.",
    );
  }
  const notesSaved = data.notesSaved === true;
  return results.map((item): AppsScriptBatchItem => {
    const r = (item ?? {}) as Record<string, unknown>;
    const rowNumber = Number(r.row);
    const no = r.no === undefined || r.no === null ? "" : String(r.no);
    // UMNP 판매는 No. 가 빈칸
    if (r.ok === true && Number.isInteger(rowNumber)) {
      return { ok: true, sheet, row: rowNumber, no, notesSaved };
    }
    if (r.ok === true) {
      return {
        ok: false,
        error: new AppsScriptError(
          "bad_response",
          "Apps Script 응답에 저장 위치(row, no)가 없습니다.",
        ),
      };
    }
    return {
      ok: false,
      error: new AppsScriptError(
        "rejected",
        shortText(r.message) || "Apps Script가 저장을 거부했습니다.",
      ),
    };
  });
}

export interface AppsScriptListRow {
  /** 장표의 실제 행 번호 (9행부터) */
  row: number;
  /** B열 No. */
  no: string;
  /** A~AL 38칸 값 */
  values: unknown[];
  /** 판매보고 참고내용 (보조 시트, 이 판매에 정확히 연결된 경우만) */
  notes?: Record<string, string>;
  /** O열(SPOT정책) 셀 메모 원문 */
  spotNote?: string;
}

export interface AppsScriptListResult {
  sheet: string;
  rows: AppsScriptListRow[];
  /** 스프레드시트에 있는 월 시트 이름 (예: ["9월", "10월"]) */
  sheets: string[];
}

/** 참고내용: 글자 값만 (항목 id 는 영문) */
function parseNotes(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (/^[A-Za-z]{1,40}$/.test(k) && typeof v === "string" && v.trim()) {
      out[k] = v.slice(0, 500);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** O열 메모: 글자만, 앞뒤 공백 제거, 2000자까지 */
function parseSpotNoteText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, 2000);
  return text || undefined;
}

export function monthSheetNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(String).filter((name) => /^(1[0-2]|[1-9])월$/.test(name))
    : [];
}

/** 월 시트의 판매내역을 읽어 온다. sheet 가 없으면 Apps Script가 이번 달 시트를 고른다. */
export async function listRowsFromAppsScript(
  sheet?: string,
): Promise<AppsScriptListResult> {
  const data = await postToAppsScript(
    sheet ? { action: "list", sheet } : { action: "list" },
    "Apps Script가 조회를 거부했습니다.",
  );

  const sheetName = shortText(data.sheet, 50);
  if (!sheetName || !Array.isArray(data.rows)) {
    throw new AppsScriptError(
      "bad_response",
      "Apps Script 조회 응답에 sheet 또는 rows가 없습니다.",
    );
  }

  const rows: AppsScriptListRow[] = [];
  for (const item of data.rows as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const { row, no, values } = item as Record<string, unknown>;
    const rowNumber = Number(row);
    if (!Number.isInteger(rowNumber) || !Array.isArray(values)) continue;
    rows.push({
      row: rowNumber,
      no: no === undefined || no === null ? "" : String(no),
      values: values.slice(0, COLUMN_COUNT),
      notes: parseNotes((item as Record<string, unknown>).notes),
      spotNote: parseSpotNoteText((item as Record<string, unknown>).spotNote),
    });
  }
  return { sheet: sheetName, rows, sheets: monthSheetNames(data.sheets) };
}

/** 삭제 대상: 화면에서 본 판매 건의 위치와 확인용 값 */
export interface DeleteTarget {
  sheet: string;
  row: number;
  no: string;
  activatedAt: string;
  customer: string;
  ctn: string;
}

/**
 * 판매 1건 삭제를 요청한다. Apps Script가 장표의 현재 값(No.·개통일·고객·CTN)을
 * 다시 확인한 뒤 A열·C~AL열 값만 비운다 (행 삭제 아님, B열 유지).
 */
export async function deleteRowFromAppsScript(
  target: DeleteTarget,
): Promise<{ sheet: string; row: number; no: string }> {
  const data = await postToAppsScript(
    { action: "delete", target },
    "Apps Script가 삭제를 거부했습니다.",
  );
  const sheet = shortText(data.sheet, 50);
  const rowNumber = Number(data.row);
  if (!sheet || !Number.isInteger(rowNumber)) {
    throw new AppsScriptError(
      "bad_response",
      "Apps Script 삭제 응답에 sheet 또는 row가 없습니다.",
    );
  }
  return {
    sheet,
    row: rowNumber,
    no: data.no === undefined || data.no === null ? "" : String(data.no),
  };
}

/** 월별 무선 목표 읽기 (month: "2026-10"). 저장된 목표가 없으면 null */
export async function getGoalFromAppsScript(
  month: string,
): Promise<number | null> {
  const data = await postToAppsScript(
    { action: "goal-get", month },
    "Apps Script가 목표 조회를 거부했습니다.",
  );
  if (data.goal === null || data.goal === undefined) return null;
  const goal = Number(data.goal);
  if (!Number.isFinite(goal)) {
    throw new AppsScriptError(
      "bad_response",
      "목표 응답 형식이 올바르지 않습니다.",
    );
  }
  return goal;
}

/** 월별 무선 목표 저장 */
export async function setGoalInAppsScript(
  month: string,
  goal: number,
): Promise<number> {
  const data = await postToAppsScript(
    { action: "goal-set", month, goal },
    "Apps Script가 목표 저장을 거부했습니다.",
  );
  return Number(data.goal);
}

/** 수정할 칸 1개: col 0=A … 37=AL (B·C 는 서버·Apps Script 모두에서 거부) */
export interface UpdateCell {
  col: number;
  /** 화면에서 본 값 (장표 현재 값과 대조) */
  before: string;
  /** 새 값 (금액은 숫자, 지우기는 "") */
  value: string | number;
}

/**
 * 쓰지 않고 현재 값만 확인하는 칸 (중고판매 Z·AA 수정 시 AB·AC 재계산에 쓴 N·U·Z·AA·AB·AC).
 * value 가 없으므로 이 확인 기능이 없는 예전 update-handler.gs 는 요청 전체를
 * "형식 오류"로 거부한다 → 아무 칸도 쓰지 않는다 (확인 없이 덮어쓰는 일이 없다).
 */
export interface UpdateCheckCell {
  col: number;
  before: string;
  check: true;
}

/** 예전 update-handler.gs 가 확인 칸을 받았을 때 돌려주는 거부 문구 */
const OLD_HANDLER_FORMAT_ERROR = "수정할 항목 형식이 올바르지 않습니다.";

/** update-handler.gs 가 모든 응답에 붙이는 표시 (다른 수정 코드의 응답과 구분) */
export const SALE_UPDATE_HANDLER = "ws-sale-update";

/**
 * 기존 판매 1건 수정: { action: "sale-update", target, changes }
 * target.sheet 는 실제 월 시트 이름("10월")이어야 한다 ("2026년 10월" 같은 화면 표시용 글자 금지).
 * Apps Script 가 같은 시트·같은 행의 No.·개통일·고객·CTN 과 바꿀 칸의 현재 값을 확인한 뒤
 * 바뀐 칸만 고친다. 새 행을 찾지 않는다.
 */
export async function updateRowInAppsScript(
  target: DeleteTarget,
  changes: UpdateCell[],
  checks: UpdateCheckCell[] = [],
  /** onlyChanges: 바꿀 칸만 쓴다 (Apps Script 가 N·U·AB·AC 수식 변환도 하지 않음) */
  options: { onlyChanges?: boolean } = {},
): Promise<{ sheet: string; row: number; no: string; values: unknown[] }> {
  if (
    changes.length === 0 ||
    [...changes, ...checks].some((c) => c.col === 1 || c.col === 2)
  ) {
    throw new AppsScriptError(
      "bad_response",
      "No.(B열)·개통일(C열)은 수정할 수 없습니다.",
    );
  }
  if (!/^(1[0-2]|[1-9])월$/.test(target.sheet)) {
    throw new AppsScriptError(
      "bad_response",
      `월 시트 이름이 올바르지 않습니다: ${target.sheet}`,
    );
  }
  const notDeployed = (reply: string) =>
    new AppsScriptError(
      "rejected",
      "Apps Script에 최신 판매 수정 코드(update-handler.gs)가 배포되어 있지 않아 수정하지 않았습니다. " +
        "안내대로 update-handler.gs 교체·doPost 한 줄 추가 후 새 버전으로 배포해 주세요." +
        (reply ? ` (Apps Script 응답: ${reply})` : ""),
    );
  let data: Record<string, unknown>;
  try {
    data = await postToAppsScript(
      {
        action: "sale-update",
        target,
        changes: [...changes, ...checks],
        ...(options.onlyChanges ? { keepRowFormulas: true } : {}),
      },
      "Apps Script가 수정을 거부했습니다.",
    );
  } catch (error) {
    // 확인 칸을 모르는 예전 update-handler.gs: 아무것도 쓰지 않고 거부했다
    if (
      checks.length > 0 &&
      error instanceof AppsScriptError &&
      error.code === "rejected" &&
      error.details.handler === SALE_UPDATE_HANDLER &&
      error.message === OLD_HANDLER_FORMAT_ERROR
    ) {
      throw new AppsScriptError(
        "rejected",
        "중고판매(Z·AA) 수정은 Apps Script에 최신 update-handler.gs 를 배포해야 저장할 수 있습니다. " +
          "이번 수정은 장표에 저장되지 않았습니다. (다른 항목 수정은 지금도 가능합니다)",
      );
    }
    // 우리 update-handler 가 아닌 다른 코드가 대답했으면 원인을 분명히 알려준다
    if (
      error instanceof AppsScriptError &&
      error.code === "rejected" &&
      error.details.handler !== SALE_UPDATE_HANDLER
    ) {
      throw notDeployed(error.message);
    }
    throw error;
  }
  if (data.handler !== SALE_UPDATE_HANDLER) throw notDeployed("");
  const sheet = shortText(data.sheet, 50);
  const rowNumber = Number(data.row);
  if (
    !sheet ||
    rowNumber !== target.row ||
    !Array.isArray(data.values) ||
    data.values.length < COLUMN_COUNT
  ) {
    throw new AppsScriptError(
      "bad_response",
      "Apps Script 수정 응답을 확인하지 못했습니다. update-handler.gs 가 추가·배포되었는지 확인해 주세요.",
    );
  }
  return {
    sheet,
    row: rowNumber,
    no: data.no === undefined || data.no === null ? "" : String(data.no),
    values: data.values.slice(0, COLUMN_COUNT),
  };
}
