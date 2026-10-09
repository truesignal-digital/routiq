import { memo, useCallback } from "react";
import {
  useFieldArray,
  useFormContext,
  useWatch,
  type Control,
} from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { MoneyInput } from "@/components/money-input.js";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { canRecordSheetRevenue } from "@/activities/permissions.js";
import { useMeContext } from "@/auth/me.js";
import { useCategories } from "@/documents/useCategories.js";
import { localizedLabel } from "@/lib/format.js";
import { newEntryRow, PAYMENT_METHODS, type SheetFormValues } from "./form.js";

export interface Option {
  value: string;
  label: string;
}

export interface EntryRowsProps {
  control: Control<SheetFormValues>;
  assetOptions: readonly Option[];
  /** Only the crew named above — a sheet cannot pay someone who was not on it. */
  personOptions: readonly Option[];
}

interface EntryRowProps {
  control: Control<SheetFormValues>;
  index: number;
  assetOptions: readonly Option[];
  personOptions: readonly Option[];
  onRemove: (index: number) => void;
}

/**
 * One money line of the sheet. Revenue and expense draw from different category
 * lists, so the row watches its own direction and nothing above it.
 */
const EntryRow = memo(function EntryRow({
  control,
  index,
  assetOptions,
  personOptions,
  onRemove,
}: EntryRowProps) {
  const { t } = useTranslation();
  const { setValue } = useFormContext<SheetFormValues>();
  const position = index + 1;
  const direction = useWatch({ control, name: `entries.${index}.direction` });
  const categoriesQuery = useCategories(
    direction === "EXPENSE" ? "EXPENSE_CATEGORY" : "REVENUE_CATEGORY",
  );

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <FormField
          control={control}
          name={`entries.${index}.direction`}
          render={({ field }) => (
            <FormItem className="flex-1">
              <Tabs
                value={field.value}
                onValueChange={(value) => {
                  if (value !== "REVENUE" && value !== "EXPENSE") return;
                  field.onChange(value);
                  // Revenue and expense draw from disjoint category lists, so
                  // the old pick cannot survive the flip.
                  setValue(`entries.${index}.categoryCode`, "", {
                    shouldDirty: true,
                  });
                }}
              >
                <TabsList
                  className="w-full max-w-64"
                  aria-label={t("activities.record.entries.rowDirection", { position })}
                >
                  <TabsTrigger value="REVENUE">
                    {t("activities.record.entries.revenue")}
                  </TabsTrigger>
                  <TabsTrigger value="EXPENSE">
                    {t("activities.record.entries.expense")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </FormItem>
          )}
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          aria-label={t("activities.record.entries.remove", { position })}
          onClick={() => onRemove(index)}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          control={control}
          name={`entries.${index}.categoryCode`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                {t("activities.record.entries.categoryLabel")}
              </FormLabel>
              <Select
                value={field.value || null}
                onValueChange={(value) => field.onChange(value ?? "")}
                disabled={categoriesQuery.isPending || categoriesQuery.isError}
              >
                <FormControl>
                  <SelectTrigger
                    className="w-full"
                    aria-label={t("activities.record.entries.rowCategory", { position })}
                  >
                    <SelectValue
                      placeholder={t("activities.record.entries.chooseCategory")}
                    />
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
          control={control}
          name={`entries.${index}.amount`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                {t("activities.record.entries.amountLabel")}
              </FormLabel>
              <FormControl>
                <MoneyInput
                  name={field.name}
                  ref={field.ref}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder={t("activities.record.entries.amountPlaceholder")}
                  aria-label={t("activities.record.entries.rowAmount", { position })}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          control={control}
          name={`entries.${index}.paymentMethod`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                {t("activities.record.entries.paymentMethodLabel")}
              </FormLabel>
              <Select
                value={field.value}
                onValueChange={(value) => {
                  if (value) field.onChange(value);
                }}
              >
                <FormControl>
                  <SelectTrigger
                    className="w-full"
                    aria-label={t("activities.record.entries.rowPaymentMethod", {
                      position,
                    })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {PAYMENT_METHODS.map((method) => (
                    <SelectItem key={method} value={method}>
                      {t(`activities.record.entries.paymentMethods.${method}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name={`entries.${index}.counterpartyName`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                {t("activities.record.entries.counterpartyLabel")}
              </FormLabel>
              <FormControl>
                <Input
                  type="text"
                  placeholder={t("activities.record.entries.counterpartyPlaceholder")}
                  aria-label={t("activities.record.entries.rowCounterparty", { position })}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          control={control}
          name={`entries.${index}.description`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                {t("activities.record.entries.descriptionLabel")}
              </FormLabel>
              <FormControl>
                <Input
                  type="text"
                  placeholder={t("activities.record.entries.descriptionPlaceholder")}
                  aria-label={t("activities.record.entries.rowDescription", { position })}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name={`entries.${index}.reference`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                {t("activities.record.entries.referenceLabel")}
              </FormLabel>
              <FormControl>
                <Input
                  type="text"
                  placeholder={t("activities.record.entries.referencePlaceholder")}
                  aria-label={t("activities.record.entries.rowReference", { position })}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          control={control}
          name={`entries.${index}.assetId`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                {t("activities.record.entries.assetLabel")}
              </FormLabel>
              <Select
                value={field.value || null}
                onValueChange={(value) => field.onChange(value ?? "")}
                disabled={assetOptions.length === 0}
              >
                <FormControl>
                  <SelectTrigger
                    className="w-full"
                    aria-label={t("activities.record.entries.rowAsset", { position })}
                  >
                    <SelectValue placeholder={t("activities.record.entries.chooseAsset")} />
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

        <FormField
          control={control}
          name={`entries.${index}.personId`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                {t("activities.record.entries.personLabel")}
              </FormLabel>
              <Select
                value={field.value || null}
                onValueChange={(value) => field.onChange(value ?? "")}
                disabled={personOptions.length === 0}
              >
                <FormControl>
                  <SelectTrigger
                    className="w-full"
                    aria-label={t("activities.record.entries.rowPerson", { position })}
                  >
                    <SelectValue
                      placeholder={t("activities.record.entries.choosePerson")}
                    />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {personOptions.map((option) => (
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
      </div>

      <FormField
        control={control}
        name={`entries.${index}.attributeToActivity`}
        render={({ field }) => (
          <FormItem>
            <div className="flex items-start gap-2">
              <Checkbox
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                aria-label={t("activities.record.entries.rowAttribute", { position })}
                className="mt-0.5"
              />
              <div className="flex flex-col gap-0.5">
                <Label className="font-normal">
                  {t("activities.record.entries.attributeLabel")}
                </Label>
                <span className="text-xs text-muted-foreground">
                  {t("activities.record.entries.attributeHint")}
                </span>
              </div>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
});

export function EntryRows({ control, assetOptions, personOptions }: EntryRowsProps) {
  const { t } = useTranslation();
  const { fields, append, remove } = useFieldArray({ control, name: "entries" });
  const onRemove = useCallback((index: number) => remove(index), [remove]);

  return (
    <div className="flex flex-col gap-3">
      {fields.length === 0 && <NoEntries />}

      {fields.map((field, index) => (
        <EntryRow
          key={field.id}
          control={control}
          index={index}
          assetOptions={assetOptions}
          personOptions={personOptions}
          onRemove={onRemove}
        />
      ))}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => append(newEntryRow("REVENUE"))}
        >
          <Plus className="size-4" aria-hidden />
          {t("activities.record.entries.addRevenue")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => append(newEntryRow("EXPENSE"))}
        >
          <Plus className="size-4" aria-hidden />
          {t("activities.record.entries.addExpense")}
        </Button>
      </div>
    </div>
  );
}

/** A driver adds expenses only (#532), so their empty sheet does not mention revenue (#573). */
function NoEntries() {
  const { t } = useTranslation();
  // role-config: the same rule that hides the driver's Add revenue button.
  const expensesOnly = !canRecordSheetRevenue(useMeContext()?.role);
  return (
    <p className="text-sm text-muted-foreground">
      {t(expensesOnly ? "activities.record.entries.emptyExpensesOnly" : "activities.record.entries.empty")}
    </p>
  );
}
