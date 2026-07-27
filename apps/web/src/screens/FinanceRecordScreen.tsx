import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "@tanstack/react-router";
import type { CommandResult } from "@routiq/contracts";
import { WalletCards } from "lucide-react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useMeContext } from "@/auth/me.js";
import { commandClient } from "@/commands/instance.js";
import { createCommandIntent } from "@/commands/intent.js";
import { localizedLabel } from "@/lib/format.js";
import { notifyCommandSuccess } from "@/lib/notify.js";

function normalizeMoneySpacing(value: string): string {
  return value.replace(/ /g, " ");
}
import {
  parseMoneyXaf,
  toRecordExpensePayload,
  toRecordRevenuePayload,
  type FinanceFormState,
} from "@/finance/model.js";
import { canRecordFinance } from "@/finance/permissions.js";
import { useCategories } from "@/documents/useCategories.js";
import { assetDisplayName } from "@/assets/model.js";
import { useAssets } from "@/assets/useAssets.js";
import { useAssetRegistrationReference } from "@/assets/reference.js";
import { FinanceNav } from "@/finance/FinanceNav.js";
import { ErrorBanner } from "@/components/error-banner.js";

type Direction = "EXPENSE" | "REVENUE";

/** The recorded entry's server status decides which success line the toast carries. */
function successKey(outcome: CommandResult): string {
  if (outcome.recordStatus === "POSTED") return "posted";
  if (outcome.recordStatus === "SUBMITTED") return "submitted";
  return "recorded";
}

export function FinanceRecordScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMeContext();
  const canRecord = canRecordFinance(me?.role, me?.enabledModules);
  const reference = useAssetRegistrationReference();

  if (me !== undefined && !canRecord) {
    return (
      <PermissionDenied
        title={t("finance.record.title")}
        icon={<WalletCards className="size-7" aria-hidden />}
        code={deniedCode(me.enabledModules.includes("FINANCE"))}
      />
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t("finance.record.title")}
        onBack={() => void navigate({ to: "/assets" })}
        backLabel={t("finance.record.back")}
      />
      <FinanceNav />

      <RecordForm
        branches={reference.data?.branches ?? []}
        branchesLoading={reference.isPending}
        branchesFailed={reference.isError}
        onRecorded={(outcome) => {
          notifyCommandSuccess("finance", successKey(outcome), outcome.warnings);
          void navigate({ to: "/finance/entries" });
        }}
      />
    </PageContainer>
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
  onRecorded,
}: {
  branches: Array<{ code: string; name: string }>;
  branchesLoading: boolean;
  branchesFailed: boolean;
  onRecorded: (outcome: CommandResult) => void;
}) {
  const { t } = useTranslation();
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
    // Validate as the user edits, matching the eager `shouldValidate` the
    // hand-wired setValue calls used to pass.
    mode: "onChange",
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
  const assetOptions = useAssetOptions();

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

    onRecorded(result.outcome);
  }

  return (
    <Form {...form}>
      <form
        className="mt-6 flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
        onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
      >
        <FormField
          control={form.control}
          name="direction"
          render={({ field }) => (
            <FormItem>
              <Tabs
                value={field.value}
                onValueChange={(value) => {
                  if (value !== "EXPENSE" && value !== "REVENUE") return;
                  field.onChange(value);
                  // Expense and revenue draw from different category lists, so
                  // the old pick cannot survive the flip.
                  form.setValue("categoryCode", "", {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                }}
              >
                <TabsList className="w-full group-data-horizontal/tabs:h-11">
                  <TabsTrigger value="EXPENSE">
                    {t("finance.record.expenseLabel")}
                  </TabsTrigger>
                  <TabsTrigger value="REVENUE">
                    {t("finance.record.revenueLabel")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <FormMessage />
            </FormItem>
          )}
        />

        {errorCode && (
          <ErrorBanner code={errorCode} />
        )}

        <FormField
          control={form.control}
          name="branchCode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("finance.record.branchLabel")}</FormLabel>
              {branchesFailed && (
                <FormDescription role="alert" className="text-destructive">
                  {t("finance.record.branchesFailed")}
                </FormDescription>
              )}
              <Select
                value={field.value || null}
                onValueChange={(value) => field.onChange(value ?? "")}
                disabled={branchesLoading || branchesFailed}
              >
                <FormControl>
                  <SelectTrigger className="min-h-11 w-full">
                    <SelectValue placeholder={t("finance.record.chooseBranch")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.code} value={branch.code}>
                      {branch.name} ({branch.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="categoryCode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("finance.record.categoryLabel")}</FormLabel>
              {categoriesQuery.isError && (
                <FormDescription role="alert" className="text-destructive">
                  {t("finance.record.categoriesFailed")}
                </FormDescription>
              )}
              <Select
                value={field.value || null}
                onValueChange={(value) => field.onChange(value ?? "")}
                disabled={categoriesQuery.isPending || categoriesQuery.isError}
              >
                <FormControl>
                  <SelectTrigger className="min-h-11 w-full">
                    <SelectValue placeholder={t("finance.record.chooseCategory")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {(categoriesQuery.data ?? []).map((category) => (
                    <SelectItem key={category.code} value={category.code}>
                      {localizedLabel(category)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="amountInput"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("finance.record.amountLabel")}</FormLabel>
              <div className="relative">
                <FormControl>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder={t("finance.record.amountPlaceholder")}
                    name={field.name}
                    ref={field.ref}
                    value={field.value}
                    onChange={(event) => {
                      field.onChange(event.target.value.replace(/[^\d\s]/g, ""));
                    }}
                    onBlur={(event) => {
                      const parsed = parseMoneyXaf(event.target.value);
                      if (parsed !== null) {
                        const formatted = new Intl.NumberFormat("fr-CM", {
                          style: "decimal",
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })
                          .format(parsed);
                        field.onChange(normalizeMoneySpacing(formatted));
                      }
                      field.onBlur();
                    }}
                    className="min-h-11"
                  />
                </FormControl>
                {amountInput && amountMinor !== null && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    XAF
                  </span>
                )}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="paymentMethod"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("finance.record.paymentMethodLabel")}</FormLabel>
              <Select
                value={field.value}
                onValueChange={(value) => {
                  if (value) {
                    field.onChange(value);
                  }
                }}
              >
                <FormControl>
                  <SelectTrigger className="min-h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {PAYMENT_METHODS.map((method) => (
                    <SelectItem key={method} value={method}>
                      {t(`finance.record.paymentMethods.${method.toLowerCase()}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="economicDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("finance.record.economicDateLabel")}</FormLabel>
              <FormControl>
                <Input type="date" className="min-h-11" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="counterpartyName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("finance.record.counterpartyLabel")}</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  placeholder={t("finance.record.counterpartyPlaceholder")}
                  className="min-h-11"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("finance.record.descriptionLabel")}</FormLabel>
              <FormControl>
                <Textarea
                  placeholder={t("finance.record.descriptionPlaceholder")}
                  className="min-h-24"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="paymentReference"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("finance.record.paymentRefLabel")}</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  placeholder={t("finance.record.paymentRefPlaceholder")}
                  className="min-h-11"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="assetId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("finance.record.assetLabel")}</FormLabel>
              <Select
                value={field.value || null}
                onValueChange={(value) => field.onChange(value ?? "")}
                disabled={assetOptions.length === 0}
              >
                <FormControl>
                  <SelectTrigger className="min-h-11 w-full">
                    <SelectValue placeholder={t("finance.record.assetPlaceholder")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {assetOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

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


/**
 * The whole fleet, labelled as the entries filter labels it. Stopping at the
 * first keyset page would hide assets an operator needs to charge a cost to;
 * pilot fleets are tens of rows, so draining the cursor costs a request or two.
 */
function useAssetOptions(): Array<{ value: string; label: string }> {
  const { t } = useTranslation();
  const assetsQuery = useAssets();
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = assetsQuery;

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return useMemo(
    () =>
      (assetsQuery.data?.pages.flatMap((page) => page.items) ?? []).map((asset) => {
        const name = assetDisplayName(asset);
        return {
          value: asset.id,
          label:
            name === asset.assetCode
              ? asset.assetCode
              : t("finance.entries.filters.assetOption", {
                  code: asset.assetCode,
                  name,
                }),
        };
      }),
    [assetsQuery.data, t],
  );
}
