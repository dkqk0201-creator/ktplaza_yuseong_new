import "server-only";
import type { SheetRowArray } from "@/lib/sheet-mapping";

/*
 * Google Apps Script 웹앱과 통신한다.
 * - 저장: { secret, row } → 판매 1건(A~AK 37칸) 저장
 * - 조회: { secret, action: "list" } → 이번 달 시트의 판매내역
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
    throw new AppsScriptError(
      "bad_response",
      `Apps Script 응답을 읽을 수 없습니다. (HTTP ${response.status})`,
    );
  }

  if (data.ok !== true) {
    throw new AppsScriptError(
      "rejected",
      shortText(data.message) || rejectedMessage,
    );
  }
  return data;
}

export async function saveRowToAppsScript(
  row: SheetRowArray,
): Promise<AppsScriptSaveResult> {
  if (row.length !== 37) {
    throw new AppsScriptError("bad_response", "전송할 행이 37칸이 아닙니다.");
  }
  const data = await postToAppsScript(
    { row },
    "Apps Script가 저장을 거부했습니다.",
  );

  const sheet = shortText(data.sheet, 50);
  const no = data.no === undefined || data.no === null ? "" : String(data.no);
  const rowNumber = Number(data.row);
  if (!sheet || !no || !Number.isInteger(rowNumber)) {
    throw new AppsScriptError(
      "bad_response",
      "Apps Script 응답에 저장 위치(sheet, row, no)가 없습니다.",
    );
  }

  return { sheet, row: rowNumber, no, message: shortText(data.message) };
}

export interface AppsScriptListRow {
  /** 장표의 실제 행 번호 (9행부터) */
  row: number;
  /** B열 No. */
  no: string;
  /** A~AK 37칸 값 */
  values: unknown[];
}

export interface AppsScriptListResult {
  sheet: string;
  rows: AppsScriptListRow[];
}

/** 이번 달 시트의 판매내역을 읽어 온다. 어느 시트인지는 Apps Script가 정한다. */
export async function listRowsFromAppsScript(): Promise<AppsScriptListResult> {
  const data = await postToAppsScript(
    { action: "list" },
    "Apps Script가 조회를 거부했습니다.",
  );

  const sheet = shortText(data.sheet, 50);
  if (!sheet || !Array.isArray(data.rows)) {
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
      values: values.slice(0, 37),
    });
  }
  return { sheet, rows };
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
 * 다시 확인한 뒤 A열·C~AK열 값만 비운다 (행 삭제 아님, B열 유지).
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
