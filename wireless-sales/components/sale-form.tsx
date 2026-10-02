"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AmountInput,
  ChoiceGroup,
  CheckChip,
  Field,
  FormSection,
  StatusToggle,
  TextInput,
  TotalRow,
} from "@/components/form-controls";
import { formatCtnInput, formatNumber } from "@/lib/format";
import {
  ADDON_ITEMS,
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
  const [showSuccess, setShowSuccess] = useState(false);

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

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setAttempted(true);
    const result = validateSaleForm(values);
    const first = REQUIRED_FIELDS.find(({ name }) => result[name]);
    if (first) {
      focusField(first.name);
      return;
    }
    // 아직 실제 저장은 하지 않는다 (Google 스프레드시트 연결 전)
    setShowSuccess(true);
  }

  function resetForm() {
    setValues(createInitialValues(today));
    setAttempted(false);
    setShowSuccess(false);
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
              checked={values.inspected}
              onChange={(v) => update("inspected", v)}
            />
            <StatusToggle
              id="sale-paid"
              label="수납"
              checked={values.paid}
              onChange={(v) => update("paid", v)}
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
          <div className="grid grid-cols-1 gap-x-5 gap-y-6 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="제카">
              <div className="space-y-2">
                <StatusToggle
                  id="sale-jecaApplied"
                  label="제카 여부"
                  onText="해당"
                  offText="미해당"
                  checked={values.jecaApplied}
                  onChange={(v) =>
                    setValues((prev) => ({
                      ...prev,
                      jecaApplied: v,
                      jecaAmount: v ? prev.jecaAmount : "",
                    }))
                  }
                />
                <AmountInput
                  id="sale-jecaAmount"
                  ariaLabel="제카 금액"
                  disabled={!values.jecaApplied}
                  value={values.jecaAmount}
                  onChange={(v) => update("jecaAmount", v)}
                />
              </div>
            </Field>

            <Field label="판매무기" htmlFor="sale-weaponType">
              <div className="space-y-2">
                <TextInput
                  id="sale-weaponType"
                  placeholder="종류 입력"
                  autoComplete="off"
                  value={values.weaponType}
                  onChange={(e) => update("weaponType", e.target.value)}
                />
                <StatusToggle
                  id="sale-weaponRegistered"
                  label="등록"
                  onText="등록"
                  offText="미등록"
                  checked={values.weaponRegistered}
                  onChange={(v) => update("weaponRegistered", v)}
                />
              </div>
            </Field>

            <Field label="부가">
              <div className="grid grid-cols-3 gap-2">
                {ADDON_ITEMS.map(({ key, label }) => (
                  <CheckChip
                    key={key}
                    label={label}
                    checked={values.addons[key]}
                    onChange={(v) =>
                      update("addons", { ...values.addons, [key]: v })
                    }
                  />
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                가입한 부가서비스를 모두 선택하세요.
              </p>
            </Field>

            <Field label="유선 가능일" htmlFor="sale-wiredAvailableDate">
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
            <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-0.5 text-sm sm:flex sm:gap-6">
              <div className="min-w-0">
                <dt className="text-xs text-ink-muted">총 확보금액</dt>
                <dd className="truncate font-bold text-ink tabular-nums sm:text-lg">
                  {formatNumber(totals.securedTotal)}원
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink-muted">총 사용금액</dt>
                <dd className="truncate font-bold text-ink tabular-nums sm:text-lg">
                  {formatNumber(totals.usedTotal)}원
                </dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("입력한 내용을 모두 지울까요?")) resetForm();
              }}
              className="hidden h-12 shrink-0 rounded-lg border border-line px-4 text-[15px] font-semibold text-ink-sub hover:bg-zinc-50 sm:block"
            >
              초기화
            </button>
            <button
              type="submit"
              className="h-12 shrink-0 rounded-lg bg-brand px-6 text-base font-bold text-white shadow-sm hover:bg-brand-strong sm:px-10"
            >
              판매 등록
            </button>
          </div>
        </div>
      </div>

      {showSuccess && (
        <SuccessDialog
          onClose={() => setShowSuccess(false)}
          onReset={resetForm}
        />
      )}
    </form>
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
  onClose,
  onReset,
}: {
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
          판매 등록 테스트가 완료되었습니다
        </h2>
        <p id="sale-success-desc" className="mt-1.5 text-sm text-ink-sub">
          입력값 확인만 진행했으며, 실제로 저장되지는 않았습니다.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onReset}
            className="h-11 rounded-lg border border-line text-[15px] font-semibold text-ink-sub hover:bg-zinc-50"
          >
            새로 입력
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onClose}
            className="h-11 rounded-lg bg-brand text-[15px] font-semibold text-white hover:bg-brand-strong"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
