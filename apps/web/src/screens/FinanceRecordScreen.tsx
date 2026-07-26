import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "@tanstack/react-router";
import type { CommandResult } from "@routiq/contracts";
import { AlertCircle, CheckCircle2, WalletCards } from "lucide-react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { EmptyState, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { FileUpload } from "@/components/ui/file-upload";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
import { useAssetRegistrationReference } from "../assets/reference.js";
import { FinanceNav } from "../finance/FinanceNav.js";

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
  const reference = useAssetRegistrationReference();

  const [screenState, setScreenState] = useState<ScreenState>({ stage: "form" });

  if (me !== undefined && !canRecord) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-6">
        <PageHeader title={t("finance.record.title")} />
        <EmptyState
          className="mt-6"
          icon={<WalletCards className="size-7" aria-hidden />}
          message={errorMessage(i18n, "MODULE_DISABLED")}
        />
      </section>
    );
  }

  const handleOutcomeClose = () => {
    void navigate({ to: "/assets" });
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6">
      <PageHeader
        title={t("finance.record.title")}
        onBack={() => void navigate({ to: "/assets" })}
        backLabel={t("finance.record.back")}
      />
      <FinanceNav />

      {screenState.stage === "form" && (
        <RecordForm
          branches={reference.data?.branches ?? []}
          branchesLoading={reference.isPending}
          branchesFailed={reference.isError}
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

const PAYMENT_METHODS = ["CASH", "MOMO", "OM", "BANK", "OTHER"] as const;

interface RecordFormValues {
  direction: Direction;
  branchCode: string;
  categoryCode: string;
  amountInput: string;
  paymentMethod: (typeof PAYMENT_METHODS)[number];
  economicDate: string;
  counterpartyName: string;
  description: string;
  paymentReference: string;
  assetId: string;
}

function RecordForm({
  branches,
  branchesLoading,
  branchesFailed,
  onOutcome,
}: {
  branches: Array<{ code: string; name: string }>;
  branchesLoading: boolean;
  branchesFailed: boolean;
  onOutcome: (outcome: CommandResult) => void;
}) {
  const { t, i18n } = useTranslation();
  const [entryId] = useState(() => crypto.randomUUID());
  const intentExpenseRef = useRef(createCommandIntent<RecordPayload>(commandClient, "record-expense", 1));
  const intentRevenueRef = useRef(createCommandIntent<RecordPayload>(commandClient, "record-revenue", 1));

  const formSchema = useMemo(
    () =>
      z.object({
        direction: z.enum(["EXPENSE", "REVENUE"]),
        branchCode: z.string().min(1, t("form.errors.required")),
        categoryCode: z.string().min(1, t("form.errors.required")),
        amountInput: z.string().refine(
          (value) => {
            const amount = parseMoneyXaf(value);
            return amount !== null && amount > 0;
          },
          t("form.errors.number"),
        ),
        paymentMethod: z.enum(PAYMENT_METHODS),
        economicDate: z.string().min(1, t("form.errors.required")),
        counterpartyName: z.string(),
        description: z.string(),
        paymentReference: z.string(),
        assetId: z.string(),
      }),
    [t],
  );
  const form = useForm<RecordFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      direction: "EXPENSE",
      branchCode: "",
      categoryCode: "",
      amountInput: "",
      paymentMethod: "CASH",
      economicDate: new Date().toISOString().split("T")[0]!,
      counterpartyName: "",
      description: "",
      paymentReference: "",
      assetId: "",
    },
  });
  const direction = form.watch("direction");
  const branchCode = form.watch("branchCode");
  const categoryCode = form.watch("categoryCode");
  const amountInput = form.watch("amountInput");
  const paymentMethod = form.watch("paymentMethod");
  const economicDate = form.watch("economicDate");
  const categoriesQuery = useCategories(
    direction === "EXPENSE" ? "EXPENSE_CATEGORY" : "REVENUE_CATEGORY",
  );

  const labelOf = (item: { labelFr: string; labelEn: string }) =>
    i18n.resolvedLanguage === "en" ? item.labelEn : item.labelFr;

  const [errorCode, setErrorCode] = useState<string>();
  const [artifactIds, setArtifactIds] = useState<string[]>([]);
  const [attachmentsUploading, setAttachmentsUploading] = useState(false);

  // Preselect branch if only one is available
  useEffect(() => {
    if (branches.length === 1 && branchCode === "") {
      const firstBranch = branches[0];
      if (firstBranch) {
        form.setValue("branchCode", firstBranch.code, { shouldValidate: true });
      }
    }
  }, [branches, branchCode, form]);

  const amountMinor = parseMoneyXaf(amountInput);
  const isValid =
    branchCode &&
    categoryCode &&
    amountMinor !== null &&
    amountMinor > 0 &&
    economicDate &&
    paymentMethod;

  async function onSubmit(values: RecordFormValues) {
    if (!isValid || amountMinor === null) return;

    setErrorCode(undefined);

    const financeForm: FinanceFormState = {
      entryId,
      branchCode: values.branchCode,
      economicDate: values.economicDate,
      categoryCode: values.categoryCode,
      amountMinor,
      paymentMethod: values.paymentMethod,
      ...(values.counterpartyName ? { counterpartyName: values.counterpartyName } : {}),
      ...(values.description ? { description: values.description } : {}),
      ...(values.paymentReference ? { paymentReference: values.paymentReference } : {}),
      ...(values.assetId ? { assetId: values.assetId } : {}),
    };

    const payload =
      values.direction === "EXPENSE"
        ? toRecordExpensePayload(financeForm)
        : toRecordRevenuePayload(financeForm);

    const intentRef =
      values.direction === "EXPENSE" ? intentExpenseRef : intentRevenueRef;

    const result = await intentRef.current.submit(
      payload,
      artifactIds.length > 0 ? { sourceArtifactIds: artifactIds } : {},
    );

    if (!result.ok) {
      setErrorCode(result.code);
      return;
    }

    onOutcome(result.outcome);
  }

  return (
    <Form {...form}>
      <form
        className="mt-6 flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
        onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
      >
        <FormField name="direction">
          <FormItem>
            <div className="flex gap-2">
              {(["EXPENSE", "REVENUE"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                    direction === value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                  onClick={() => {
                    form.setValue("direction", value, { shouldDirty: true });
                    form.setValue("categoryCode", "", {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }}
                >
                  {t(
                    value === "EXPENSE"
                      ? "finance.record.expenseLabel"
                      : "finance.record.revenueLabel",
                  )}
                </button>
              ))}
            </div>
            <FormMessage />
          </FormItem>
        </FormField>

        {errorCode && (
          <div role="alert" className="flex gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 flex-shrink-0" aria-hidden />
            <p>{errorMessage(i18n, errorCode)}</p>
          </div>
        )}

        <FormField name="branchCode">
          <FormItem>
            <FormLabel htmlFor="branch">{t("finance.record.branchLabel")}</FormLabel>
            {branchesFailed && (
              <FormDescription role="alert" className="text-destructive">
                {t("finance.record.branchesFailed")}
              </FormDescription>
            )}
            <FormControl>
              <Select
                value={branchCode || null}
                onValueChange={(value) =>
                  form.setValue("branchCode", value ?? "", {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
                disabled={branchesLoading || branchesFailed}
              >
                <SelectTrigger id="branch" className="min-h-11 w-full">
                  <SelectValue placeholder={t("finance.record.chooseBranch")} />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.code} value={branch.code}>
                      {branch.name} ({branch.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField name="categoryCode">
          <FormItem>
            <FormLabel htmlFor="category">{t("finance.record.categoryLabel")}</FormLabel>
            {categoriesQuery.isError && (
              <FormDescription role="alert" className="text-destructive">
                {t("finance.record.categoriesFailed")}
              </FormDescription>
            )}
            <FormControl>
              <Select
                value={categoryCode || null}
                onValueChange={(value) =>
                  form.setValue("categoryCode", value ?? "", {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
                disabled={categoriesQuery.isPending || categoriesQuery.isError}
              >
                <SelectTrigger id="category" className="min-h-11 w-full">
                  <SelectValue placeholder={t("finance.record.chooseCategory")} />
                </SelectTrigger>
                <SelectContent>
                  {(categoriesQuery.data ?? []).map((category) => (
                    <SelectItem key={category.code} value={category.code}>
                      {labelOf(category)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField name="amountInput">
          <FormItem>
            <FormLabel htmlFor="amount">{t("finance.record.amountLabel")}</FormLabel>
            <FormControl>
              <div className="relative">
                <Input
                  id="amount"
                  type="text"
                  inputMode="numeric"
                  placeholder={t("finance.record.amountPlaceholder")}
                  value={amountInput}
                  onChange={(event) => {
                    form.setValue(
                      "amountInput",
                      event.target.value.replace(/[^\d\s]/g, ""),
                      { shouldDirty: true, shouldValidate: true },
                    );
                  }}
                  onBlur={(event) => {
                    const parsed = parseMoneyXaf(event.target.value);
                    if (parsed !== null) {
                      form.setValue("amountInput", formatMoneyXaf(parsed), {
                        shouldTouch: true,
                        shouldValidate: true,
                      });
                    }
                  }}
                  className="min-h-11"
                />
                {amountInput && amountMinor !== null && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    XAF
                  </span>
                )}
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField name="paymentMethod">
          <FormItem>
            <FormLabel htmlFor="payment-method">
              {t("finance.record.paymentMethodLabel")}
            </FormLabel>
            <FormControl>
              <Select
                value={paymentMethod}
                onValueChange={(value) => {
                  if (value) {
                    form.setValue("paymentMethod", value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }
                }}
              >
                <SelectTrigger id="payment-method" className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((method) => (
                    <SelectItem key={method} value={method}>
                      {t(`finance.record.paymentMethods.${paymentMethodKey(method)}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField name="economicDate">
          <FormItem>
            <FormLabel htmlFor="economic-date">
              {t("finance.record.economicDateLabel")}
            </FormLabel>
            <FormControl>
              <Input
                id="economic-date"
                type="date"
                className="min-h-11"
                {...form.register("economicDate")}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField name="counterpartyName">
          <FormItem>
            <FormLabel htmlFor="counterparty">
              {t("finance.record.counterpartyLabel")}
            </FormLabel>
            <FormControl>
              <Input
                id="counterparty"
                type="text"
                placeholder={t("finance.record.counterpartyPlaceholder")}
                className="min-h-11"
                {...form.register("counterpartyName")}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField name="description">
          <FormItem>
            <FormLabel htmlFor="description">
              {t("finance.record.descriptionLabel")}
            </FormLabel>
            <FormControl>
              <Textarea
                id="description"
                placeholder={t("finance.record.descriptionPlaceholder")}
                className="min-h-24"
                {...form.register("description")}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField name="paymentReference">
          <FormItem>
            <FormLabel htmlFor="payment-ref">
              {t("finance.record.paymentRefLabel")}
            </FormLabel>
            <FormControl>
              <Input
                id="payment-ref"
                type="text"
                placeholder={t("finance.record.paymentRefPlaceholder")}
                className="min-h-11"
                {...form.register("paymentReference")}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField name="assetId">
          <FormItem>
            <FormLabel htmlFor="asset">{t("finance.record.assetLabel")}</FormLabel>
            <FormControl>
              <Input
                id="asset"
                type="text"
                placeholder={t("finance.record.assetPlaceholder")}
                className="min-h-11"
                {...form.register("assetId")}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">
            {t("finance.record.evidenceLabel")}
          </span>
          <FileUpload
            accept="image/*"
            onChange={setArtifactIds}
            onUploadingChange={setAttachmentsUploading}
          />
        </div>

        <Button
          type="submit"
          className="min-h-11"
          disabled={!isValid || form.formState.isSubmitting || attachmentsUploading}
        >
          {form.formState.isSubmitting
            ? t("finance.record.submitting")
            : t("finance.record.submit")}
        </Button>
      </form>
    </Form>
  );
}

function paymentMethodKey(method: RecordFormValues["paymentMethod"]) {
  return method.toLowerCase() as Lowercase<RecordFormValues["paymentMethod"]>;
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
