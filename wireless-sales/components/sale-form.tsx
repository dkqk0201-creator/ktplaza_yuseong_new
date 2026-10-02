"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AmountInput,
  ChoiceGroup,
  Field,
  FormSection,
  StatusToggle,
  TextArea,
  TextInput,
  TotalRow,
} from "@/components/form-controls";
import { formatCtnInput, formatNumber } from "@/lib/format";
import {
  DONGPAN_OPTIONS,
  OX_OPTIONS,
  PLAN_CHANGES,
  REQUIRED_FIELDS,
  SALE_CATEGORIES,
  SECURED_ITEMS,
  USED_ITEMS,
  calculateTotals,
  createInitialValues,
  fieldId,
  validateSaleForm,
  type RequiredField,
  type SaleFormValues,
} from "@/lib/sale-form";
import { useSalesData } from "@/components/sales-data-provider";
import { postSale } from "@/lib/save-sale-api";

interface SaveError {
  message: string;
  errors?: string[];
}

export function SaleForm({
  today,
  staffOptions,
}: {
  today: string;
  staffOptions: string[];
}) {
  const [values, setValues] = useState<SaleFormValues>(() =>
    createInitialValues(today),
  );
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  // 상태 반영 전 빠른 연속 클릭까지 막기 위한 즉시 잠금
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const [saved, setSaved] = useState<{ sheet: string; no: string } | null>(
    null,
  );
  const [lastSavedKey, setLastSavedKey] = useState<string | null>(null);
  const { invalidate } = useSalesData();

  const totals = calculateTotals(values);
  // 첫 등록 시도 이후부터 오류를 표시하고, 입력하는 즉시 사라지게 한다
  const errors = attempted ? validateSaleForm(values) : {};
  const missingFields = REQUIRED_FIELDS.filter(({ name }) => errors[name]);

  function update<K extends keyof SaleFormValues>(
    key: K,
    value: SaleFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function focusField(name: RequiredField) {
    const el = document.getElementById(fieldId(name));
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus({ preventScroll: true });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;

    setAttempted(true);
    const result = validateSaleForm(values);
    const first = REQUIRED_FIELDS.find(({ name }) => result[name]);
    if (first) {
      focusField(first.name);
      return;
    }

    // 방금 저장한 내용을 실수로 한 번 더 저장하는 것을 막는다
    const key = JSON.stringify(values);
    if (
      key === lastSavedKey &&
      !window.confirm("방금 저장한 내용과 같습니다. 한 번 더 저장할까요?")
    ) {
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const response = await postSale(values);
    savingRef.current = false;
    setSaving(false);

    if (response.ok) {
      setSaved({ sheet: response.sheet, no: response.no });
      setLastSavedKey(key);
      // 대시보드·판매 현황이 최신 장표를 보도록 공유 데이터를 무효화하고 다시 읽는다
      void invalidate();
    } else {
      // 실패해도 입력값은 그대로 둔다
      setSaveError({ message: response.message, errors: response.errors });
    }
  }

  function resetForm() {
    setValues(createInitialValues(today));
    setAttempted(false);
    setSaved(null);
    setSaveError(null);
    setLastSavedKey(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <p className="mb-4 text-sm text-ink-sub">
        <span className="font-semibold text-brand">*</span> 표시는 필수 입력
        항목입니다.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {/* 1. 기본 개통정보 */}
        <FormSection step={1} title="기본 개통정보" className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
            <Field
              label="개통일"
              htmlFor={fieldId("activatedAt")}
              required
              error={errors.activatedAt}
            >
              <TextInput
                id={fieldId("activatedAt")}
                type="date"
                value={values.activatedAt}
                invalid={!!errors.activatedAt}
                onChange={(e) => update("activatedAt", e.target.value)}
              />
            </Field>

            <Field
              label="고객명"
              htmlFor={fieldId("customer")}
              required
              error={errors.customer}
            >
              <TextInput
                id={fieldId("customer")}
                placeholder="예: 홍길동"
                autoComplete="off"
                value={values.customer}
                invalid={!!errors.customer}
                onChange={(e) => update("customer", e.target.value)}
              />
            </Field>

            <Field
              label="CTN"
              htmlFor={fieldId("ctn")}
              required
              error={errors.ctn}
            >
              <TextInput
                id={fieldId("ctn")}
                type="tel"
                inputMode="numeric"
                autoComplete="off"
                placeholder="010-0000-0000"
                className="tabular-nums"
                value={formatCtnInput(values.ctn)}
                invalid={!!errors.ctn}
                onChange={(e) =>
                  update("ctn", e.target.value.replace(/\D/g, "").slice(0, 11))
                }
              />
            </Field>

            <Field
              label="개통구분"
              htmlFor={fieldId("category")}
              group
              required
              error={errors.category}
            >
              <ChoiceGroup
                id={fieldId("category")}
                label="개통구분"
                options={SALE_CATEGORIES}
                columns={3}
                value={values.category}
                invalid={!!errors.category}
                onChange={(v) => update("category", v)}
              />
            </Field>

            <Field
              label="모델명"
              htmlFor={fieldId("model")}
              required
              error={errors.model}
            >
              <TextInput
                id={fieldId("model")}
                placeholder="예: 갤럭시 S25"
                autoComplete="off"
                value={values.model}
                invalid={!!errors.model}
                onChange={(e) => update("model", e.target.value)}
              />
            </Field>

            <Field
              label="요금제"
              htmlFor={fieldId("plan")}
              required
              error={errors.plan}
            >
              <TextInput
                id={fieldId("plan")}
                placeholder="예: 5G 심플 110GB"
                autoComplete="off"
                value={values.plan}
                invalid={!!errors.plan}
                onChange={(e) => update("plan", e.target.value)}
              />
            </Field>

            <Field
              label="요금제 유지/변경"
              htmlFor={fieldId("planChange")}
              group
              required
              error={errors.planChange}
            >
              <ChoiceGroup
                id={fieldId("planChange")}
                label="요금제 유지/변경"
                options={PLAN_CHANGES}
                columns={2}
                value={values.planChange}
                invalid={!!errors.planChange}
                onChange={(v) => update("planChange", v)}
              />
            </Field>

            <Field
              label="직원명"
              htmlFor={fieldId("staff")}
              group
              required
              error={errors.staff}
            >
              <ChoiceGroup
                id={fieldId("staff")}
                label="직원명"
                options={staffOptions}
                value={values.staff}
                invalid={!!errors.staff}
                onChange={(v) => update("staff", v)}
              />
            </Field>

            <Field
              label="추후 고객약속"
              htmlFor="sale-customerPromise"
              className="sm:col-span-2"
            >
              <TextArea
                id="sale-customerPromise"
                rows={3}
                placeholder={
                  "나중에 고객에게 해줘야 할 일을 적어 주세요.\n예: 12월 1일 부가서비스 해지 / 6개월 후 요금제 변경 연락"
                }
                value={values.customerPromise}
                onChange={(e) => update("customerPromise", e.target.value)}
              />
            </Field>
          </div>
        </FormSection>

        {/* 2. 업무 처리 확인 */}
        <FormSection
          step={2}
          title="업무 처리 확인"
          description="눌러서 완료 여부를 바꿉니다"
        >
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
            <StatusToggle
              id="sale-inspected"
              label="검수"
              checked={values.inspected === "O"}
              onChange={(v) => update("inspected", v ? "O" : "X")}
            />
            <StatusToggle
              id="sale-paid"
              label="수납"
              checked={values.paid === "O"}
              onChange={(v) => update("paid", v ? "O" : "X")}
            />
          </div>
        </FormSection>

        {/* 3. 확보금액 */}
        <FormSection step={3} title="확보금액">
          <AmountList
            prefix="secured"
            items={SECURED_ITEMS}
            values={values.secured}
            onChange={(key, v) =>
              update("secured", { ...values.secured, [key]: v })
            }
          />
          <TotalRow label="총 확보금액" value={totals.securedTotal} />
        </FormSection>

        {/* 4. 고객혜택 / 사용금액 */}
        <FormSection step={4} title="고객혜택 / 사용금액">
          <AmountRow
            id="sale-customerBenefitTotal"
            label="고객혜택 총액"
            value={values.customerBenefitTotal}
            onChange={(v) => update("customerBenefitTotal", v)}
          />
          <p className="mt-1.5 text-xs text-ink-muted">
            고객에게 제공하기로 한 혜택 총액 (총 사용금액에는 포함되지 않음)
          </p>
          <p className="mt-4 mb-3 border-t border-line pt-4 text-xs font-semibold text-ink-sub">
            혜택 사용내역
          </p>
          <AmountList
            prefix="used"
            items={USED_ITEMS}
            values={values.used}
            onChange={(key, v) => update("used", { ...values.used, [key]: v })}
          />
          <TotalRow label="총 사용금액" value={totals.usedTotal} />
        </FormSection>

        {/* 5. 중고판매 */}
        <FormSection step={5} title="중고판매">
          <div className="space-y-3">
            <AmountRow
              id="sale-usedPhoneSale"
              label="판매금액"
              value={values.usedPhoneSale}
              onChange={(v) => update("usedPhoneSale", v)}
            />
            <AmountRow
              id="sale-usedPhoneUsed"
              label="사용금액"
              value={values.usedPhoneUsed}
              onChange={(v) => update("usedPhoneUsed", v)}
            />
          </div>
          <TotalRow
            label="잔여금액"
            value={totals.usedPhoneRemaining}
            tone={totals.usedPhoneRemaining < 0 ? "negative" : "default"}
          />
          <p className="mt-2 text-xs text-ink-muted">
            잔여금액 = 판매금액 − 사용금액
          </p>
        </FormSection>

        {/* 6. 추가 관리 */}
        <FormSection
          step={6}
          title="추가 관리"
          className="lg:col-span-2 xl:col-span-3"
        >
          <div className="grid grid-cols-2 gap-x-5 gap-y-6 xl:grid-cols-4">
            <Field label="2ND 실적" htmlFor="sale-secondPerformance" group>
              <ChoiceGroup
                id="sale-secondPerformance"
                label="2ND 실적"
                options={OX_OPTIONS}
                columns={2}
                variant="ox"
                value={values.secondPerformance}
                onChange={(v) => update("secondPerformance", v)}
              />
            </Field>

            <Field label="제카 실적" htmlFor="sale-jecaPerformance" group>
              <ChoiceGroup
                id="sale-jecaPerformance"
                label="제카 실적"
                options={OX_OPTIONS}
                columns={2}
                variant="ox"
                value={values.jecaPerformance}
                onChange={(v) => update("jecaPerformance", v)}
              />
            </Field>

            <Field
              label="제카 확보예산"
              htmlFor="sale-jecaBudget"
              className="col-span-2 sm:col-span-1"
            >
              <AmountInput
                id="sale-jecaBudget"
                value={values.jecaBudget}
                onChange={(v) => update("jecaBudget", v)}
              />
              <p className="mt-1.5 text-xs text-ink-muted">
                총 확보금액에는 포함되지 않음
              </p>
            </Field>

            <Field
              label="판매무기"
              htmlFor="sale-weaponType"
              className="col-span-2 sm:col-span-1"
            >
              <div className="space-y-2">
                <TextInput
                  id="sale-weaponType"
                  placeholder="종류 (예: 롯데, 신한, 국민)"
                  autoComplete="off"
                  value={values.weaponType}
                  onChange={(e) => update("weaponType", e.target.value)}
                />
                <div className="flex items-center gap-3">
                  <span className="shrink-0 text-sm font-medium text-ink-sub">
                    등록
                  </span>
                  <div className="flex-1">
                    <ChoiceGroup
                      id="sale-weaponRegistered"
                      label="판매무기 등록"
                      options={OX_OPTIONS}
                      columns={2}
                      variant="ox"
                      value={values.weaponRegistered}
                      onChange={(v) => update("weaponRegistered", v)}
                    />
                  </div>
                </div>
              </div>
            </Field>

            <Field label="필S" htmlFor="sale-pilS" group>
              <ChoiceGroup
                id="sale-pilS"
                label="필S"
                options={OX_OPTIONS}
                columns={2}
                variant="ox"
                value={values.pilS}
                onChange={(v) => update("pilS", v)}
              />
            </Field>

            <Field label="필L" htmlFor="sale-pilL" group>
              <ChoiceGroup
                id="sale-pilL"
                label="필L"
                options={OX_OPTIONS}
                columns={2}
                variant="ox"
                value={values.pilL}
                onChange={(v) => update("pilL", v)}
              />
            </Field>

            <Field
              label="동판"
              htmlFor="sale-dongpan"
              group
              className="col-span-2 sm:col-span-1"
            >
              <ChoiceGroup
                id="sale-dongpan"
                label="동판"
                options={DONGPAN_OPTIONS}
                columns={4}
                variant="ox"
                value={values.dongpan}
                onChange={(v) => update("dongpan", v)}
              />
            </Field>

            <Field
              label="유선 가능일"
              htmlFor="sale-wiredAvailableDate"
              className="col-span-2 sm:col-span-1"
            >
              <TextInput
                id="sale-wiredAvailableDate"
                type="date"
                value={values.wiredAvailableDate}
                onChange={(e) => update("wiredAvailableDate", e.target.value)}
              />
            </Field>
          </div>
        </FormSection>
      </div>

      {missingFields.length > 0 && (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3"
        >
          <p className="text-sm font-semibold text-rose-700">
            필수 항목 {missingFields.length}개를 확인해 주세요.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {missingFields.map(({ name, label }) => (
              <button
                key={name}
                type="button"
                onClick={() => focusField(name)}
                className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 하단 고정 등록 영역 */}
      <div className="sticky bottom-16 z-10 mt-4 md:bottom-4">
        <div className="rounded-xl border border-line bg-white/95 p-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur sm:p-4">
          {saveError && (
            <div
              role="alert"
              className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700"
            >
              <p className="font-semibold">⚠ {saveError.message}</p>
              {saveError.errors && saveError.errors.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {saveError.errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-xs text-rose-600/80">
                입력한 내용은 그대로 남아 있습니다.
              </p>
            </div>
          )}
          {missingFields.length > 0 && (
            <button
              type="button"
              onClick={() => focusField(missingFields[0].name)}
              className="mb-2 block w-full text-left text-xs font-semibold text-rose-600 hover:underline"
            >
              ⚠ 필수 항목 {missingFields.length}개 미입력 · 눌러서 이동
            </button>
          )}
          <div className="flex items-center gap-3">
            <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-1.5 text-sm lg:flex lg:gap-6">
              <BarStat label="총 확보금액" value={totals.securedTotal} />
              <BarStat label="총 사용금액" value={totals.usedTotal} />
              <BarStat label="중고 잔여" value={totals.usedPhoneRemaining} />
              <BarStat label="최종 합계" value={totals.finalTotal} emphasis />
            </dl>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                if (window.confirm("입력한 내용을 모두 지울까요?")) resetForm();
              }}
              className="hidden h-12 shrink-0 rounded-lg border border-line px-4 text-[15px] font-semibold text-ink-sub hover:bg-zinc-50 sm:block"
            >
              초기화
            </button>
            <button
              type="submit"
              disabled={saving}
              aria-busy={saving}
              className="flex h-12 shrink-0 items-center gap-2 rounded-lg bg-brand px-6 text-base font-bold text-white shadow-sm hover:bg-brand-strong disabled:cursor-wait disabled:opacity-70 sm:px-10"
            >
              {saving && (
                <span
                  aria-hidden
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                />
              )}
              {saving ? "저장 중..." : "판매 등록"}
            </button>
          </div>
        </div>
      </div>

      {saved && (
        <SuccessDialog
          sheet={saved.sheet}
          no={saved.no}
          onClose={() => setSaved(null)}
          onReset={resetForm}
        />
      )}
    </form>
  );
}

function BarStat({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`min-w-0 ${emphasis ? "lg:border-l lg:border-line lg:pl-6" : ""}`}
    >
      <dt
        className={`text-xs ${emphasis ? "font-semibold text-brand" : "text-ink-muted"}`}
      >
        {label}
      </dt>
      <dd
        className={`truncate font-bold tabular-nums sm:text-lg ${
          value < 0 ? "text-rose-600" : emphasis ? "text-brand" : "text-ink"
        }`}
      >
        {formatNumber(value)}원
      </dd>
    </div>
  );
}

function AmountRow({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (digits: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-[15px] font-medium text-ink">
        {label}
      </label>
      <div className="w-44 shrink-0 sm:w-48">
        <AmountInput id={id} value={value} onChange={onChange} />
      </div>
    </div>
  );
}

function AmountList<K extends string>({
  prefix,
  items,
  values,
  onChange,
}: {
  prefix: string;
  items: readonly { key: K; label: string }[];
  values: Record<K, string>;
  onChange: (key: K, digits: string) => void;
}) {
  return (
    <div className="space-y-3">
      {items.map(({ key, label }) => (
        <AmountRow
          key={key}
          id={`sale-${prefix}-${key}`}
          label={label}
          value={values[key]}
          onChange={(v) => onChange(key, v)}
        />
      ))}
    </div>
  );
}

function SuccessDialog({
  sheet,
  no,
  onClose,
  onReset,
}: {
  sheet: string;
  no: string;
  onClose: () => void;
  onReset: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sale-success-title"
        aria-describedby="sale-success-desc"
        className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-2xl text-emerald-600">
          ✓
        </div>
        <h2 id="sale-success-title" className="mt-4 text-lg font-bold text-ink">
          판매 등록이 완료되었습니다
        </h2>
        <p
          id="sale-success-desc"
          className="mt-1.5 text-base font-semibold text-ink"
        >
          {sheet} / No.{no}에 저장되었습니다.
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          새 판매를 입력하려면 입력 내용을 비워 주세요.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-lg border border-line text-[15px] font-semibold text-ink-sub hover:bg-zinc-50"
          >
            닫기
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onReset}
            className="h-11 rounded-lg bg-brand text-[15px] font-semibold text-white hover:bg-brand-strong"
          >
            새 판매 입력
          </button>
        </div>
      </div>
    </div>
  );
}
