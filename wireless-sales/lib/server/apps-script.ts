import "server-only";
import type { SheetRowArray } from "@/lib/sheet-mapping";

/*
 * Google Apps Script 웹앱으로 판매 1건(A~AK 37칸)을 보낸다.
 * 주소와 비밀값은 서버 환경변수에서만 읽고, 어떤 경우에도 응답·로그에 넣지 않는다.
 * 어느 월 시트·어느 행에 저장할지는 Apps Script가 정한다.
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

export async function saveRowToAppsScript(
  row: SheetRowArray,
): Promise<AppsScriptSaveResult> {
  if (row.length !== 37) {
    throw new AppsScriptError("bad_response", "전송할 행이 37칸이 아닙니다.");
  }
  const { url, secret } = readConfig();

  let response: Response;
  try {
    // Apps Script는 응답을 다른 주소로 넘겨주므로(redirect) 따라가야 결과를 받을 수 있다
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, row }),
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
      shortText(data.message) || "Apps Script가 저장을 거부했습니다.",
    );
  }

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
