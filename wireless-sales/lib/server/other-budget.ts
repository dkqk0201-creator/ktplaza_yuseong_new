import "server-only";
import { AppsScriptError, postToAppsScript, shortText } from "@/lib/server/apps-script";
import {
  OTHER_BUDGET_HANDLER,
  otherTotals,
  parseOtherItem,
  type OtherBudgetBefore,
  type OtherBudgetInput,
  type OtherBudgetItem,
  type OtherBudgetMonth,
} from "@/lib/other-budget";

/* 예산관리 기타 예산 — Apps Script other-budget.gs 와 통신 (별도 시트 "기타예산내역"에만 저장) */

const NOT_DEPLOYED =
  "Apps Script에 기타 예산 코드(other-budget.gs)와 최신 update-handler.gs 가 배포되어 있지 않아 처리하지 않았습니다.";

async function postOther(payload: Record<string, unknown>, rejected: string) {
  let data: Record<string, unknown>;
  try {
    data = await postToAppsScript({ action: "other-budget", ...payload }, rejected);
  } catch (error) {
    if (error instanceof AppsScriptError && error.code === "rejected" && error.details.handler !== OTHER_BUDGET_HANDLER) {
      throw new AppsScriptError("rejected", NOT_DEPLOYED, { notDeployed: true });
    }
    throw error;
  }
  if (data.handler !== OTHER_BUDGET_HANDLER) throw new AppsScriptError("rejected", NOT_DEPLOYED, { notDeployed: true });
  return data;
}

function parseList(raw: unknown): OtherBudgetItem[] {
  if (!Array.isArray(raw)) throw new AppsScriptError("bad_response", "기타 예산 조회 응답 형식이 올바르지 않습니다.");
  return raw.map((r) => {
    const item = parseOtherItem(r);
    if (!item) throw new AppsScriptError("bad_response", "기타 예산 항목 형식이 올바르지 않습니다.");
    return item;
  });
}

export async function listOtherBudgetFromAppsScript(month: string): Promise<OtherBudgetMonth> {
  const data = await postOther({ op: "list", month }, "Apps Script가 기타 예산 조회를 거부했습니다.");
  if (data.month !== month) throw new AppsScriptError("bad_response", "기타 예산 조회 응답의 월이 다릅니다.");
  const items = parseList(data.items);
  const deleted = data.deleted === undefined ? [] : parseList(data.deleted);
  if (items.some((i) => i.month !== month) || deleted.some((i) => i.month !== month)) {
    throw new AppsScriptError("bad_response", "기타 예산 조회 응답에 다른 월 항목이 섞여 있습니다.");
  }
  const t = otherTotals(items);
  // 합계를 웹앱에서 다시 계산해 Apps Script 합계와 맞는지 확인
  if (t.gain !== data.gain || t.deduct !== data.deduct || t.net !== data.net) {
    throw new AppsScriptError("bad_response", "기타 예산 합계가 내역과 맞지 않습니다.");
  }
  return { month, items, deleted, ...t, invalidRows: typeof data.invalidRows === "number" ? data.invalidRows : 0 };
}

function savedItem(data: Record<string, unknown>, id: string): OtherBudgetItem {
  const item = parseOtherItem(data.item);
  if (!item || item.id !== id) throw new AppsScriptError("bad_response", "기타 예산 저장 응답을 확인하지 못했습니다. 새로고침해 확인해 주세요.");
  return item;
}

const same = (item: OtherBudgetItem, input: OtherBudgetInput) =>
  item.name === input.name && item.kind === input.kind && item.amount === input.amount && item.memo === input.memo;

export async function createOtherBudgetInAppsScript(month: string, id: string, input: OtherBudgetInput) {
  const data = await postOther({ op: "create", month, id, ...input }, "Apps Script가 기타 예산 등록을 거부했습니다.");
  const item = savedItem(data, id);
  if (!same(item, input) || item.month !== month) {
    throw new AppsScriptError("bad_response", "저장된 기타 예산 내용이 요청과 다릅니다. 새로고침해 확인해 주세요.");
  }
  return { item, duplicate: data.duplicate === true, message: shortText(data.message) };
}

export async function updateOtherBudgetInAppsScript(id: string, before: OtherBudgetBefore, input: OtherBudgetInput) {
  const data = await postOther({ op: "update", id, before, ...input }, "Apps Script가 기타 예산 수정을 거부했습니다.");
  const item = savedItem(data, id);
  if (!same(item, input)) throw new AppsScriptError("bad_response", "수정된 기타 예산 내용이 요청과 다릅니다. 새로고침해 확인해 주세요.");
  return { item, message: shortText(data.message) };
}

export async function changeOtherBudgetStatusInAppsScript(op: "delete" | "restore", id: string, before: OtherBudgetBefore) {
  const data = await postOther({ op, id, before }, `Apps Script가 기타 예산 ${op === "delete" ? "삭제" : "복구"}를 거부했습니다.`);
  const item = savedItem(data, id);
  return { item, message: shortText(data.message) };
}
