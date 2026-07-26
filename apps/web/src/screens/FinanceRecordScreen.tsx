import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { CommandResult } from "@routiq/contracts";
import { AlertCircle, ArrowLeft, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMeContext } from "../auth/me.js";
import { commandClient } from "../commands/instance.js";
import { createCommandIntent } from "../commands/intent.js";
import { errorMessage } from "../lib/error-message.js";
import {
  formatMoneyXaf,
  parseMoneyXaf,
  toRecordExpensePayload,
  toRecordRevenuePayload,
  type FinanceFormState,
} from "../finance/model.js";
import { canRecordFinance } from "../finance/permissions.js";
import { useCategories } from "../documents/useCategories.js";

type Direction = "EXPENSE" | "REVENUE";

interface ScreenState {
  stage: "form" | "outcome";
  outcome?: CommandResult;
}

export function FinanceRecordScreen() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const me = useMeContext();
  const canRecord = canRecordFinance(me?.role, me?.enabledModules);

  const [screenState, setScreenState] = useState<ScreenState>({ stage: "form" });

  if (me !== undefined && !canRecord) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-semibold">{t("finance.record.title")}</h1>
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {errorMessage(i18n, "MODULE_DISABLED")}
        </p>
      </section>
    );
  }

  const handleOutcomeClose = () => {
    void navigate({ to: "/assets" });
  };

  // Get branch code from branchScope (if array, use first; if "ALL", use empty string)
  const branchCode: string =
    (me && Array.isArray(me.branchScope) && me.branchScope.length > 0
      ? me.branchScope[0]
      : "") ?? "";

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6">
      <button
        type="button"
        className="flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground"
        onClick={() => void navigate({ to: "/assets" })}
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("finance.record.back")}
      </button>
      <h1 className="mt-2 text-2xl font-semibold">{t("finance.record.title")}</h1>

      {screenState.stage === "form" && (
        <RecordForm
          branchCode={branchCode}
          onOutcome={(outcome) => setScreenState({ stage: "outcome", outcome })}
        />
      )}

      {screenState.stage === "outcome" && screenState.outcome && (
        <OutcomeView outcome={screenState.outcome} onClose={handleOutcomeClose} />
      )}
    </section>
  );
}

type RecordPayload = ReturnType<typeof toRecordExpensePayload>;

function RecordForm({
  branchCode,
  onOutcome,
}: {
  branchCode: string;
  onOutcome: (outcome: CommandResult) => void;
}) {
  const { t, i18n } = useTranslation();
  const [entryId] = useState(() => crypto.randomUUID());
  const intentExpenseRef = useRef(createCommandIntent<RecordPayload>(commandClient, "record-expense", 1));
  const intentRevenueRef = useRef(createCommandIntent<RecordPayload>(commandClient, "record-revenue", 1));

  const [direction, setDirection] = useState<Direction>("EXPENSE");
  const categoriesQuery = useCategories(
    direction === "EXPENSE" ? "EXPENSE_CATEGORY" : "REVENUE_CATEGORY",
  );

  const labelOf = (item: { labelFr: string; labelEn: string }) =>
    i18n.resolvedLanguage === "en" ? item.labelEn : item.labelFr;

  // Form state
  const [categoryCode, setCategoryCode] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<
    "CASH" | "MOMO" | "OM" | "BANK" | "OTHER"
  >("CASH");
  const today = new Date().toISOString().split("T")[0];
  const [economicDate, setEconomicDate] = useState(today);
  const [counterpartyName, setCounterpartyName] = useState("");
  const [description, setDescription] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [assetId, setAssetId] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string>();

  const amountMinor = parseMoneyXaf(amountInput);
  const isValid =
    categoryCode &&
    amountMinor !== null &&
    amountMinor > 0 &&
    economicDate &&
    paymentMethod;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isValid || amountMinor === null) return;

    setErrorCode(undefined);
    setSubmitting(true);

    const form: FinanceFormState = {
      entryId,
      branchCode,
      economicDate,
      categoryCode,
      amountMinor,
      paymentMethod,
      ...(counterpartyName ? { counterpartyName } : {}),
      ...(description ? { description } : {}),
      ...(paymentReference ? { paymentReference } : {}),
      ...(assetId ? { assetId } : {}),
    };

    const payload =
      direction === "EXPENSE"
        ? toRecordExpensePayload(form)
        : toRecordRevenuePayload(form);

    const intentRef =
      direction === "EXPENSE" ? intentExpenseRef : intentRevenueRef;

    const result = await intentRef.current.submit(payload);
    setSubmitting(false);

    if (!result.ok) {
      setErrorCode(result.code);
      return;
    }

    onOutcome(result.outcome);
  }

  return (
    <form
      className="mt-6 flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
      onSubmit={(e) => void onSubmit(e)}
    >
      <div className="flex gap-2">
        <button
          type="button"
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
            direction === "EXPENSE"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
          onClick={() => {
            setDirection("EXPENSE");
            setCategoryCode("");
          }}
        >
          {t("finance.record.expenseLabel")}
        </button>
        <button
          type="button"
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
            direction === "REVENUE"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
          onClick={() => {
            setDirection("REVENUE");
            setCategoryCode("");
          }}
        >
          {t("finance.record.revenueLabel")}
        </button>
      </div>

      {errorCode && (
        <div role="alert" className="flex gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 flex-shrink-0" aria-hidden />
          <p>{errorMessage(i18n, errorCode)}</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="category">{t("finance.record.categoryLabel")}</Label>
        {categoriesQuery.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t("finance.record.categoriesFailed")}
          </p>
        )}
        <select
          id="category"
          className="min-h-11 rounded-md border border-input bg-transparent px-3 text-sm"
          value={categoryCode}
          onChange={(e) => setCategoryCode(e.target.value)}
          disabled={categoriesQuery.isPending || categoriesQuery.isError}
          required
        >
          <option value="">{t("finance.record.chooseCategory")}</option>
          {(categoriesQuery.data ?? []).map((c) => (
            <option key={c.code} value={c.code}>
              {labelOf(c)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="amount">{t("finance.record.amountLabel")}</Label>
        <div className="relative">
          <Input
            id="amount"
            type="text"
            inputMode="numeric"
            placeholder={t("finance.record.amountPlaceholder")}
            value={amountInput}
            onChange={(e) => {
              const val = e.target.value.replace(/[^\d\s]/g, "");
              setAmountInput(val);
            }}
            onBlur={(e) => {
              const parsed = parseMoneyXaf(e.target.value);
              if (parsed !== null) {
                setAmountInput(formatMoneyXaf(parsed));
              }
            }}
            className="min-h-11"
            required
          />
          {amountInput && amountMinor !== null && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              XAF
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="payment-method">{t("finance.record.paymentMethodLabel")}</Label>
        <select
          id="payment-method"
          className="min-h-11 rounded-md border border-input bg-transparent px-3 text-sm"
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}
          required
        >
          <option value="CASH">{t("finance.record.paymentMethods.cash")}</option>
          <option value="MOMO">{t("finance.record.paymentMethods.momo")}</option>
          <option value="OM">{t("finance.record.paymentMethods.om")}</option>
          <option value="BANK">{t("finance.record.paymentMethods.bank")}</option>
          <option value="OTHER">{t("finance.record.paymentMethods.other")}</option>
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="economic-date">{t("finance.record.economicDateLabel")}</Label>
        <Input
          id="economic-date"
          type="date"
          value={economicDate}
          onChange={(e) => setEconomicDate(e.target.value)}
          className="min-h-11"
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="counterparty">{t("finance.record.counterpartyLabel")}</Label>
        <Input
          id="counterparty"
          type="text"
          placeholder={t("finance.record.counterpartyPlaceholder")}
          value={counterpartyName}
          onChange={(e) => setCounterpartyName(e.target.value)}
          className="min-h-11"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">{t("finance.record.descriptionLabel")}</Label>
        <Input
          id="description"
          type="text"
          placeholder={t("finance.record.descriptionPlaceholder")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-11"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="payment-ref">{t("finance.record.paymentRefLabel")}</Label>
        <Input
          id="payment-ref"
          type="text"
          placeholder={t("finance.record.paymentRefPlaceholder")}
          value={paymentReference}
          onChange={(e) => setPaymentReference(e.target.value)}
          className="min-h-11"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="asset">{t("finance.record.assetLabel")}</Label>
        <Input
          id="asset"
          type="text"
          placeholder={t("finance.record.assetPlaceholder")}
          value={assetId}
          onChange={(e) => setAssetId(e.target.value)}
          className="min-h-11"
        />
      </div>

      <Button
        type="submit"
        className="min-h-11"
        disabled={!isValid || submitting}
      >
        {submitting
          ? t("finance.record.submitting")
          : t("finance.record.submit")}
      </Button>
    </form>
  );
}

function OutcomeView({
  outcome,
  onClose,
}: {
  outcome: CommandResult;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isPosted = outcome.recordStatus === "POSTED";
  const isSubmitted = outcome.recordStatus === "SUBMITTED";

  return (
    <div className="mt-6 flex flex-col gap-4 rounded-xl border border-green-200 bg-green-50 p-6">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-6 text-green-600" aria-hidden />
        <div>
          <h2 className="font-semibold text-green-900">
            {isPosted
              ? t("finance.record.outcomePosted")
              : isSubmitted
                ? t("finance.record.outcomeSubmitted")
                : t("finance.record.outcomeSuccess")}
          </h2>
          <p className="mt-1 text-sm text-green-800">
            {isPosted
              ? t("finance.record.outcomePostedDesc")
              : isSubmitted
                ? t("finance.record.outcomeSubmittedDesc")
                : t("finance.record.outcomeDesc")}
          </p>
        </div>
      </div>

      {outcome.warnings && outcome.warnings.length > 0 && (
        <div className="mt-2 border-t border-green-200 pt-4">
          <p className="text-xs font-semibold uppercase text-green-900">
            {t("finance.record.warningsLabel")}
          </p>
          <ul className="mt-2 space-y-2">
            {outcome.warnings.map((warning, idx) => (
              <li key={idx} className="flex gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
                <AlertCircle className="mt-0.5 size-4 flex-shrink-0" aria-hidden />
                <span>
                  {warning === "EVIDENCE_MISSING"
                    ? t("finance.record.warningEvidenceMissing")
                    : warning === "LATE_POSTING"
                      ? t("finance.record.warningLatePosting")
                      : warning}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button onClick={onClose} className="min-h-11 mt-4">
        {t("finance.record.done")}
      </Button>
    </div>
  );
}
