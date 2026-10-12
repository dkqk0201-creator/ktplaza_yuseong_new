import { POLICY_NAME_FIELD, cleanPolicyName, policyNameError } from "@/lib/model-policy";
import { NOTE_FIELDS, QUICK_FIELDS, type QuickFieldId } from "@/lib/quick-report";
import { EDITABLE_KEYS, ROW_FORMULA_KEYS } from "@/lib/sale-edit";
import { COLUMN_LABEL, COLUMN_LETTER, SHEET_COLUMNS, type ColumnKey } from "@/lib/sheet-columns";
import type { SheetSale } from "@/lib/sheet-record";
import { W_EXTRA, W_INSTALLMENT, W_PART_KEYS, parseWPart, type WPartKey } from "@/lib/w-split";

/*
 * 간편등록 · 판매 수정 공용 입력 화면 구성 (항목·제목·순서·그룹).
 * - 항목과 순서는 간편등록 양식(QUICK_FIELDS)을 그대로 따른다.
 * - 판매 수정은 같은 그룹·같은 순서로 보여주고, 간편등록에 없는 장표 칸(G·H·O·P·Q·V·AF·AG·AH,
 *   자동 계산 N·U·AB·AC)은 맨 아래 "장표 추가 항목" 으로 따로 보여준다 (아무 칸도 빠지지 않게).
 * - 참고 항목(장표 저장 안 함)은 Apps Script 보조 시트 "웹앱참고" 에 판매 건별로 보관된 값을 읽고 고친다.
 */

export interface QuickGroup {
  title: string;
  /** 그룹 안 항목 (간편등록 순서). children: 그 항목 칸 바로 아래에 함께 보여줄 항목 */
  items: { id: QuickFieldId; children?: QuickFieldId[] }[];
}

export const QUICK_GROUPS: QuickGroup[] = [
  {
    title: "기본 정보",
    items: [
      { id: "activatedAt" },
      { id: "staff" },
      { id: "customer" },
      { id: "excludeIndicator" },
      { id: "ctn" },
      { id: "category" },
      { id: "model" },
      { id: "plan" },
      { id: "planChange" },
    ],
  },
  {
    title: "정책",
    items: [
      { id: "policyBenefit" },
      { id: "policyOther", children: ["modelPolicyName"] },
      { id: "policySecond" },
    ],
  },
  {
    title: "정책사용",
    items: [{ id: "useExtraSupport" }, { id: "useInstallment" }, { id: "usePlan" }],
  },
  {
    title: "2ND",
    items: [
      { id: "second" },
      { id: "secondBenefit" },
      { id: "secondSelfPay" },
      { id: "secondGift" },
    ],
  },
  {
    title: "디초/삼초",
    items: [{ id: "dicho" }, { id: "dichoBenefit" }, { id: "dichoGift" }],
  },
  {
    title: "중고폰&현물",
    items: [
      { id: "usedPhone" },
      { id: "usedPhoneSaleAmount" },
      { id: "usedPhoneUse" },
      { id: "usedPhoneWhere" },
    ],
  },
  {
    title: "제카 · 보험 · 부가 · 동판",
    items: [
      { id: "jeca" },
      { id: "insurance" },
      { id: "addon" },
      { id: "dongpan" },
      { id: "availableDate" },
    ],
  },
  { title: "고객약속사항", items: [{ id: "customerPromise" }] },
];

const FIELD_BY_ID = new Map(QUICK_FIELDS.map((f) => [f.id, f]));

/** 그룹 안에서 보여줄 이름: "정책 → 고객혜택" → "ㄴ 고객혜택", 그룹 첫 항목(2ND 등)은 그대로 */
export function fieldLabel(id: QuickFieldId): string {
  if (id === POLICY_NAME_FIELD) return "ㄴ 정책명";
  const label = FIELD_BY_ID.get(id)?.label ?? id;
  const arrow = label.lastIndexOf("→ ");
  return arrow >= 0 ? `ㄴ ${label.slice(arrow + 2)}` : label;
}

/** 장표 열 안내 ("→ S열 모델정책") 또는 참고 항목 안내 */
export function columnHint(key: ColumnKey): string {
  return `→ ${COLUMN_LETTER[key]}열 ${COLUMN_LABEL[key]}`;
}
export const NOTE_HINT = "장표 저장 안 함 (참고)";

/* ---------- 판매 수정: 항목 → 장표 열 / 참고내용 ---------- */

/**
 * 참고내용(웹앱참고) 항목 id: 장표 저장 안 함 항목 + 2ND 첫 줄 원문
 * + W열 세부 금액(wExtraSupport·wInstallment — 판매 수정의 추가지원금·고혜(기존할부금) 입력이 함께 바꿈)
 */
export type NoteFieldId = (typeof NOTE_FIELDS)[number]["id"] | WPartKey;
/** 화면 입력칸이 있는 참고 항목 (장표 저장 안 함) */
export const NOTE_FIELD_IDS: readonly NoteFieldId[] = NOTE_FIELDS.map((f) => f.id);
/** 판매 수정으로 고칠 수 있는 참고내용 키 전부 (Apps Script notes.gs WS_EDITABLE_NOTE_FIELDS 와 같게 유지) */
export const EDITABLE_NOTE_KEYS: readonly NoteFieldId[] = [...NOTE_FIELD_IDS, ...W_PART_KEYS];
const NOTE_SET = new Set<string>(EDITABLE_NOTE_KEYS);
export function isNoteField(id: string): id is NoteFieldId {
  return NOTE_SET.has(id);
}
function isWPart(id: string): id is WPartKey {
  return id === W_EXTRA || id === W_INSTALLMENT;
}

/** 판매 수정 입력칸 1개 */
export type EditSpec =
  | { kind: "column"; id: QuickFieldId; key: ColumnKey; label: string; hint: string }
  | { kind: "note"; id: QuickFieldId; field: NoteFieldId; label: string; hint: string }
  /** W열 합계의 한 부분 (추가지원금 / 고혜(기존할부금)) — W열 = 두 입력의 합, 세부는 참고내용 */
  | { kind: "wpart"; id: QuickFieldId; part: WPartKey; label: string; hint: string };

/** W열 합산 항목 안내 */
export const W_HINT = "→ W열 (추가지원금 + 고혜(기존할부금) 합계)";

/**
 * 간편등록 항목 1개 → 판매 수정 입력칸 (보통 1개).
 * 2ND 는 간편등록에서 한 칸이지만 장표(AD열 O/X)와 참고(직원이 적은 글자)에 나뉘어 저장되므로
 * 수정 화면에서는 참고 글자 칸 + 바로 아래 AD열 칸 두 개로 보여준다 (자동 변환 없이 둘 다 직접 고침).
 */
export function editSpecsFor(id: QuickFieldId): EditSpec[] {
  const field = FIELD_BY_ID.get(id);
  if (!field) return [];
  const label = fieldLabel(id);
  if (id === "second") {
    return [
      { kind: "note", id, field: "second", label: "2ND (보고 내용)", hint: NOTE_HINT },
      {
        kind: "column",
        id,
        key: "secondPerformance",
        label: "ㄴ 2ND 실적 (O/X)",
        hint: columnHint("secondPerformance"),
      },
    ];
  }
  if (id === "useExtraSupport") return [{ kind: "wpart", id, part: W_EXTRA, label, hint: W_HINT }];
  if (id === "useInstallment") return [{ kind: "wpart", id, part: W_INSTALLMENT, label, hint: W_HINT }];
  if (field.column) {
    return [{ kind: "column", id, key: field.column, label, hint: columnHint(field.column) }];
  }
  if (isNoteField(id)) {
    return [{ kind: "note", id, field: id, label, hint: NOTE_HINT }];
  }
  return [];
}

/** 판매 수정 화면 그룹 (간편등록과 같은 그룹·순서) */
export function editGroups(): { title: string; items: { main: EditSpec[]; children: EditSpec[] }[] }[] {
  return QUICK_GROUPS.map((g) => ({
    title: g.title,
    items: g.items.map((item) => ({
      main: editSpecsFor(item.id),
      children: (item.children ?? []).flatMap(editSpecsFor),
    })),
  }));
}

/**
 * 간편등록 양식에 없는 장표 칸 (판매 수정 맨 아래 "장표 추가 항목", 장표 열 순서).
 * N·U·AB·AC(행별 수식)는 자동 계산 표시만. No.(B)는 수정 불가 표시라 제외.
 */
export function extraColumnKeys(): ColumnKey[] {
  const used = new Set<ColumnKey>();
  for (const g of editGroups())
    for (const it of g.items)
      for (const s of [...it.main, ...it.children]) {
        if (s.kind === "column") used.add(s.key);
        if (s.kind === "wpart") used.add("usedExtraSupport"); // W열은 두 입력의 합계로만 고친다
      }
  const allowed = new Set<ColumnKey>([...EDITABLE_KEYS, ...ROW_FORMULA_KEYS]);
  return SHEET_COLUMNS.map((c) => c.key).filter((k) => allowed.has(k) && !used.has(k));
}

/* ---------- 참고내용 변경 ---------- */

export const NOTE_MAX = 500;

export interface NoteChange {
  field: NoteFieldId;
  /** 화면에서 본(보관된) 값 */
  before: string;
  /** 새 값 ("" = 지우기) */
  after: string;
}

/** 입력 정리: 정책명은 공백 정리, 나머지는 앞뒤 공백만 제거 */
export function cleanNote(field: NoteFieldId, value: string): string {
  return field === POLICY_NAME_FIELD ? cleanPolicyName(value) : value.trim();
}

/** 지금 보관된 참고내용 값 */
export function noteOriginal(sale: Pick<SheetSale, "notes">, field: NoteFieldId): string {
  return cleanNote(field, sale.notes?.[field] ?? "");
}

/** 원래 값과 입력값을 비교해 바뀐 참고 항목만 (참고 항목 순서) */
export function diffNotes(
  sale: Pick<SheetSale, "notes">,
  edited: Partial<Record<NoteFieldId, string>>,
): NoteChange[] {
  const out: NoteChange[] = [];
  for (const field of NOTE_FIELD_IDS) {
    const value = edited[field];
    if (value === undefined) continue;
    const before = noteOriginal(sale, field);
    const after = cleanNote(field, value);
    if (after !== before) out.push({ field, before, after });
  }
  return out;
}

/** 참고 항목 입력 검사 (문제 없으면 null) */
export function noteError(field: NoteFieldId, value: string): string | null {
  if (field === POLICY_NAME_FIELD) return policyNameError(value);
  if (isWPart(field)) return parseWPart(value) === undefined ? "금액은 숫자로 입력해 주세요." : null;
  return value.trim().length > NOTE_MAX ? `${NOTE_MAX}자 이내로 입력해 주세요.` : null;
}

/** 참고 항목 화면 이름 (변경 확인 목록용) */
export function noteLabel(field: NoteFieldId): string {
  if (field === "second") return "2ND (보고 내용)";
  if (field === W_EXTRA) return "정책사용 → 추가지원금 (W열 세부)";
  if (field === W_INSTALLMENT) return "정책사용 → 고혜(기존할부금) (W열 세부)";
  if (field === POLICY_NAME_FIELD) return "정책 → 정책명";
  return FIELD_BY_ID.get(field as QuickFieldId)?.label ?? field;
}
