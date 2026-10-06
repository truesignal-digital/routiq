import { useMemo, useRef, useState } from "react";
import { DateField } from "@/components/date-field";
import { zodResolver } from "@hookform/resolvers/zod";
import type { CommandResult, FinancialEntryDetail } from "@routiq/contracts";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import { z } from "zod";
import {
  CommandForm,
  type CommandFormBack,
  type CommandSurface,
} from "@/components/command-form.js";
import { MoneyInput } from "@/components/money-input.js";
import { RecordText } from "@/components/record-number";
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
import { PinnedAssetField } from "../assets/PinnedAssetField.js";
import { useAssetRegistrationReference } from "../assets/reference.js";
import { useAssetOptions } from "../assets/useAssetOptions.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { useCategories } from "../documents/useCategories.js";
import { localizedLabel } from "../lib/format.js";
import { notifyCommandSuccess } from "../lib/notify.js";
import { ALL_BRANCHES } from "../shell/branch-context.js";
import {
  useCreatedElsewhereNotice,
  useFollowShellBranch,
} from "../shell/branch-scope.js";
import {
  parseMoneyXaf,
  toRecordExpensePayload,
  toRecordRevenuePayload,
  toUpdatePendingEntryPayload,
  type FinanceFormState,
} from "./model.js";

export type EntryDirection = "EXPENSE" | "REVENUE";

/** What else the entry's line is attributed to, besides the vehicle. */
export type EntryLink = { workOrderId: string } | { activityId: string };

export interface RecordEntryFormProps {
  surface: CommandSurface;
  initialDirection?: EntryDirection | undefined;
  /** A form opened as "record an expense" does not offer revenue. */
  lockDirection?: boolean | undefined;
  /** Opened from a vehicle: the line is charged to it, shown instead of picked. */
  pinnedAssetId?: string | undefined;
  pinnedAssetLabel?: string | undefined;
  link?: EntryLink | undefined;
  defaultCategoryCode?: string | undefined;
  /**
   * The branch the entry is booked to when the host knows it — a vehicle's
   * home branch. Without one the field follows the shell's agency.
   */
  defaultBranchCode?: string | undefined;
  client?: CommandClient | undefined;
  back?: CommandFormBack | undefined;
  /**
   * After the entry committed and its toast was shown. The form reads nothing
   * back, so the host refreshes whatever it displays.
   */
  onRecorded: (outcome: CommandResult, branchCode: string) => void;
  onDismiss?: (() => void) | undefined;
  /**
   * The author's own pending entry (#85): the same form, pre-filled, saving
   * with update-pending-entry at the version shown. Direction and branch stay
   * as recorded, files go through "attach a receipt", and the host offers
   * this only for a single-line entry, which is all this form writes.
   */
  editing?: FinancialEntryDetail | undefined;
}

type RecordPayload = ReturnType<typeof toRecordExpensePayload>;
type UpdatePayload = ReturnType<typeof toUpdatePendingEntryPayload>;

/** What an entry's single line is attributed to besides the vehicle. */
function lineLink(entry: FinancialEntryDetail): EntryLink | undefined {
  const line = entry.postings[0];
  if (line?.workOrderId) return { workOrderId: line.workOrderId };
  if (line?.activityId) return { activityId: line.activityId };
  return undefined;
}

/** An approver who acted first moves the version or the status: both mean "decided". */
function editErrorCode(code: string): string {
  return code === "INVALID_STATE_TRANSITION" ? "VERSION_CONFLICT" : code;
}

const PAYMENT_METHODS = ["CASH", "MOMO", "OM", "BANK", "OTHER"] as const;

interface RecordFormValues {
  direction: EntryDirection;
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

/** The recorded entry's server status decides which success line the toast carries. */
function successKey(outcome: CommandResult): string {
  if (outcome.recordStatus === "POSTED") return "posted";
  if (outcome.recordStatus === "SUBMITTED") return "submitted";
  return "recorded";
}

/**
 * One expense or revenue entry, from the finance record page or from a
 * vehicle. The entry is a single line equal to its amount; the vehicle, trip
 * and work order it names are dimensions on that line.
 */
export function RecordEntryForm({
  surface,
  initialDirection = "EXPENSE",
  lockDirection = false,
  pinnedAssetId,
  pinnedAssetLabel,
  link,
  defaultCategoryCode,
  defaultBranchCode,
  client = commandClient,
  back,
  onRecorded,
  onDismiss,
  editing,
}: RecordEntryFormProps) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const [entryId] = useState(() => editing?.id ?? crypto.randomUUID());
  // Created on first submit, not on render: cancelling opens no intent.
  const intentExpenseRef = useRef<CommandIntent<RecordPayload> | undefined>(undefined);
  const intentRevenueRef = useRef<CommandIntent<RecordPayload> | undefined>(undefined);
  const intentUpdateRef = useRef<CommandIntent<UpdatePayload> | undefined>(undefined);
  const entryLink = editing === undefined ? link : lineLink(editing);
  const directionLocked = lockDirection || editing !== undefined;
  const reference = useAssetRegistrationReference();
  const branches = reference.data?.branches ?? [];
  const createdElsewhereNotice = useCreatedElsewhereNotice();

  const formSchema = useMemo(
    () =>
      z.object({
        direction: z.enum(["EXPENSE", "REVENUE"]),
        // An edit keeps the branch it was recorded in and never sends one.
        branchCode: editing === undefined ? z.string().min(1, t("form.errors.required")) : z.string(),
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
    [t, editing],
  );
  const form = useForm<RecordFormValues>({
    resolver: zodResolver(formSchema),
    // Validate as the user edits, matching the eager `shouldValidate` the
    // hand-wired setValue calls used to pass.
    mode: "onChange",
    defaultValues:
      editing === undefined
        ? {
            direction: initialDirection,
            branchCode: defaultBranchCode ?? "",
            categoryCode: defaultCategoryCode ?? "",
            amountInput: "",
            paymentMethod: "CASH",
            economicDate: new Date().toISOString().split("T")[0]!,
            counterpartyName: "",
            description: "",
            paymentReference: "",
            assetId: pinnedAssetId ?? "",
          }
        : {
            direction: editing.direction,
            branchCode: "",
            categoryCode: editing.category.code,
            amountInput: String(editing.amountMinor),
            paymentMethod: editing.paymentMethod,
            economicDate: editing.economicDate,
            counterpartyName: editing.counterpartyName ?? "",
            description: editing.description ?? "",
            paymentReference: editing.paymentReference ?? "",
            assetId: editing.postings[0]?.assetId ?? pinnedAssetId ?? "",
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
  // Every asset in scope, not the shell's current agency: an entry may charge a
  // cost to a truck the operator is not currently looking at, and the server
  // does not require the entry's branch to match the asset's.
  const assetOptions = useAssetOptions(ALL_BRANCHES);

  const [errorCode, setErrorCode] = useState<string>();
  const [artifactIds, setArtifactIds] = useState<string[]>([]);
  const [attachmentsUploading, setAttachmentsUploading] = useState(false);

  // A branch the host named stands; only an open form follows the shell.
  const followsShell = defaultBranchCode === undefined && editing === undefined;
  useFollowShellBranch(
    followsShell ? branches : [],
    branchCode,
    (code) => {
      if (followsShell) {
        form.setValue("branchCode", code, { shouldValidate: true });
      }
    },
  );
  const editedBranch =
    editing === undefined ? undefined : branches.find((branch) => branch.id === editing.branchId);

  const amountMinor = parseMoneyXaf(amountInput);
  const isValid = Boolean(
    (branchCode || editing !== undefined) &&
      categoryCode &&
      amountMinor !== null &&
      amountMinor > 0 &&
      economicDate &&
      paymentMethod,
  );

  async function onValid(values: RecordFormValues) {
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
      ...entryLink,
    };

    if (editing !== undefined) {
      intentUpdateRef.current ??= createCommandIntent<UpdatePayload>(
        client,
        "update-pending-entry",
        1,
      );
      const result = await intentUpdateRef.current.submit(
        toUpdatePendingEntryPayload(financeForm),
        { expectedVersion: editing.rowVersion },
      );
      if (!result.ok) {
        setErrorCode(editErrorCode(result.code));
        return;
      }
      notifyCommandSuccess(
        "finance",
        result.outcome.recordStatus === "POSTED" ? "updatedPosted" : "updated",
        result.outcome.warnings,
      );
      onRecorded(result.outcome, editedBranch?.code ?? "");
      return;
    }

    const payload =
      values.direction === "EXPENSE"
        ? toRecordExpensePayload(financeForm)
        : toRecordRevenuePayload(financeForm);

    const intentRef =
      values.direction === "EXPENSE" ? intentExpenseRef : intentRevenueRef;
    intentRef.current ??= createCommandIntent<RecordPayload>(
      client,
      values.direction === "EXPENSE" ? "record-expense" : "record-revenue",
      1,
    );

    const result = await intentRef.current.submit(
      payload,
      artifactIds.length > 0 ? { sourceArtifactIds: artifactIds } : {},
    );

    if (!result.ok) {
      setErrorCode(result.code);
      return;
    }

    // A transaction recorded into another agency would land off the list the
    // shell is showing, with nothing said about it.
    notifyCommandSuccess(
      "finance",
      successKey(result.outcome),
      result.outcome.warnings,
      createdElsewhereNotice({ branchCode: values.branchCode }) ?? {},
    );
    onRecorded(result.outcome, values.branchCode);
  }

  const title = editing !== undefined
    ? <RecordText text={t("finance.edit.title", { number: editing.entryNumber })} numbers={[editing.entryNumber]} />
    : !lockDirection
    ? t("finance.record.title")
    : label(direction === "EXPENSE" ? "record-expense" : "record-revenue");
  const chrome =
    surface === "page"
      ? { surface, hideCancel: true, className: "mt-6" }
      : { surface, title, back };

  return (
    <Form {...form}>
      <CommandForm
        {...chrome}
        error={errorCode}
        {...(editing === undefined
          ? {}
          : {
              description: t("finance.edit.description"),
              conflict: {
                title: t("finance.edit.decidedTitle"),
                body: t("finance.edit.decidedBody"),
              },
            })}
        command={
          editing !== undefined
            ? "update-pending-entry"
            : direction === "EXPENSE"
              ? "record-expense"
              : "record-revenue"
        }
        ready={isValid && !attachmentsUploading}
        submitting={form.formState.isSubmitting}
        onSubmit={() => void form.handleSubmit(onValid)()}
        onDismiss={onDismiss ?? (() => {})}
      >
        {!directionLocked && (
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
                  <TabsList className="w-full">
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
        )}

        {pinnedAssetId !== undefined && (
          <PinnedAssetField assetId={pinnedAssetId} label={pinnedAssetLabel} />
        )}

        {editing !== undefined ? (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t("finance.record.branchLabel")}</span>
            <p className="text-sm text-muted-foreground">
              {editedBranch === undefined
                ? t("finance.edit.branchUnknown")
                : `${editedBranch.name} (${editedBranch.code})`}
            </p>
          </div>
        ) : (
        <FormField
          control={form.control}
          name="branchCode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("finance.record.branchLabel")}</FormLabel>
              {reference.isError && (
                <FormDescription role="alert" className="text-destructive">
                  {t("finance.record.branchesFailed")}
                </FormDescription>
              )}
              <Select
                value={field.value || null}
                onValueChange={(value) => field.onChange(value ?? "")}
                disabled={reference.isPending || reference.isError}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
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
        )}

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
                  <SelectTrigger className="w-full">
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
              <FormControl>
                <MoneyInput
                  name={field.name}
                  ref={field.ref}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder={t("finance.record.amountPlaceholder")}
                />
              </FormControl>
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
                  <SelectTrigger className="w-full">
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
                <DateField {...field} />
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
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {pinnedAssetId === undefined && (
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
                    <SelectTrigger className="w-full">
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
        )}

        {editing === undefined && (
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
        )}
      </CommandForm>
    </Form>
  );
}
