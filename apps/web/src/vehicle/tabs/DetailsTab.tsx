import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Pencil, RotateCw, TriangleAlert } from "lucide-react";
import {
  TEMPLATE_FIELDS,
  type AssetDetail,
  type TemplateCode,
  type UpdateAssetDetailsPayload,
} from "@routiq/contracts";
import { DatePicker } from "@/components/date-picker";
import { ErrorBanner } from "@/components/error-banner.js";
import { MoneyInput } from "@/components/money-input.js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { assetDetailQueryKey } from "@/assets/useAssetDetail.js";
import { useActiveSession } from "@/auth/store.js";
import { applyTemplateFieldMetadata } from "@/commands/field-errors";
import { formatDate, formatDateTime, formatMoney, localizedLabel } from "@/lib/format.js";
import { notifyCommandSuccess, notifyInfo } from "@/lib/notify.js";
import { cn } from "@/lib/utils";
import { commandClient } from "../../commands/instance.js";
import { createCommandIntent } from "../../commands/intent.js";
import { useVehicle } from "../context.js";
import {
  changedDetails,
  CHASSIS_NUMBER_MAX_LENGTH,
  detailsProblems,
  editableSpecifications,
  formValuesOf,
  isDisposed,
  todayIso,
  YEAR_BOUNDS,
  type DetailsFieldName,
  type DetailsFormValues,
  type DetailsProblem,
} from "../details/model.js";
import { makeAndModel } from "../header/IdentityStrip.js";
import { recordReference } from "../model.js";
import { LinkButton } from "../parts.js";

type Row = readonly [string, ReactNode];

/**
 * The Details section: everything the header leaves out, in three columns —
 * right now, the vehicle, its specifications. The fleet managers edit it in
 * place (#84, ADR-0008 level 1): "Modifier" turns the same card's descriptive
 * values into inputs, with one Save for the whole card against one version.
 */
export function DetailsTab() {
  const { t } = useTranslation();
  const { asset, viewer, refresh } = useVehicle();
  /** The vehicle as it stood when editing began: what the edit is compared and versioned against. */
  const [base, setBase] = useState<AssetDetail>();
  const [conflict, setConflict] = useState(false);
  const editing = base !== undefined;
  const queryClient = useQueryClient();
  const session = useActiveSession();

  // A refetch while editing leaves the form alone; only Reload moves it to
  // the vehicle as it now stands.
  async function reload() {
    await refresh();
    setBase(queryClient.getQueryData<AssetDetail>(assetDetailQueryKey(session?.workspaceSlug, asset.id)) ?? asset);
    setConflict(false);
  }
  const nowRows = useNowRows();
  const vehicleRows = useVehicleRows();
  const specificationRows = useSpecificationRows();

  // role-config: editing what a vehicle is follows register-asset — the fleet
  // managers (update-asset-details' default rules). The server decides.
  const mayEdit = viewer.role === "DIRECTOR" || viewer.role === "ADMIN";
  const disposed = isDisposed(asset.lifecycleStatus);
  const editable = mayEdit && !disposed;

  return (
    <section aria-labelledby="vehicle-details-title" className="space-y-3">
      <h2 id="vehicle-details-title" className="sr-only">
        {t("vehicle.tabs.details")}
      </h2>
      {editable && !editing && (
        <div className="flex justify-end">
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="outline" className="h-11" onClick={() => setBase(asset)} />}
            >
              <Pencil aria-hidden />
              {t("vehicle.details.edit.button")}
            </TooltipTrigger>
            <TooltipContent>{t("vehicle.details.edit.tooltip")}</TooltipContent>
          </Tooltip>
        </div>
      )}
      {mayEdit && disposed && (
        <p className="text-sm text-muted-foreground">
          {t("vehicle.details.edit.disposed", { status: asset.lifecycleStatus })}
        </p>
      )}
      {editing && conflict && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg bg-warning/10 px-4 py-3 text-sm text-warning-foreground ring-1 ring-warning/30 sm:flex-row sm:items-center"
        >
          <TriangleAlert className="hidden size-4 shrink-0 sm:block" aria-hidden />
          <p className="flex-1">{t("vehicle.details.edit.conflict")}</p>
          <Button
            variant="outline"
            className="h-11 bg-background"
            onClick={() => void reload()}
          >
            <RotateCw aria-hidden />
            {t("vehicle.details.edit.reload")}
          </Button>
        </div>
      )}
      {base !== undefined ? (
        // Reload brings a new version: the form starts again from it.
        <DetailsEditCard
          key={base.rowVersion}
          base={base}
          nowRows={nowRows}
          onConflict={() => setConflict(true)}
          onClose={() => {
            setConflict(false);
            setBase(undefined);
          }}
        />
      ) : (
        <Card className="gap-0 py-0">
          <Columns>
            <DetailsColumn title={t("vehicle.details.rightNow")} rows={nowRows} />
            <DetailsColumn title={t("vehicle.details.vehicle")} rows={vehicleRows} />
            <DetailsColumn title={t("vehicle.details.specifications")} rows={specificationRows} />
          </Columns>
        </Card>
      )}
    </section>
  );
}

function Columns({ children }: { children: ReactNode }) {
  return (
    <div className="grid divide-y md:grid-cols-[1.25fr_1fr_0.8fr] md:divide-x md:divide-y-0">{children}</div>
  );
}

/** Availability, lifecycle, home, custodian, place, odometer: each changed by its own action. */
function useNowRows(): Row[] {
  const { t, i18n } = useTranslation();
  const { asset, gates, panel } = useVehicle();
  const locale = i18n.language;
  const availability = asset.availability;
  const reading = asset.lastReading;

  const now: Row[] = [
    [
      t("vehicle.details.availability"),
      availability.state === "GROUNDED" ? (
        <>
          {t("vehicle.details.groundedSince", { date: formatDateTime(availability.since, locale) })}
          {" · "}
          <LinkButton onClick={() => panel.openRecord({ kind: "issue", id: availability.issue.id })}>
            {recordReference(availability.issue.id)}
          </LinkButton>
        </>
      ) : availability.state === "AVAILABLE" ? (
        availability.since === null ? (
          t("vehicle.details.available")
        ) : (
          t("vehicle.details.availableSince", { date: formatDateTime(availability.since, locale) })
        )
      ) : (
        t("vehicle.details.notAssessed")
      ),
    ],
    [
      t("vehicle.details.lifecycle"),
      asset.commissionedAt === null
        ? t(`assets.status.${asset.lifecycleStatus}`)
        : t("vehicle.details.lifecycleSince", {
            status: t(`assets.status.${asset.lifecycleStatus}`),
            date: formatDate(asset.commissionedAt, locale),
          }),
    ],
    [t("vehicle.details.homeBranch"), t("vehicle.details.homeBranchValue", { branch: asset.branch.name })],
    [
      t("vehicle.details.custodian"),
      asset.custodian === null ? (
        t("vehicle.details.nobodyAssigned")
      ) : (
        <>
          {asset.custodian.since === null
            ? asset.custodian.displayName
            : t("vehicle.details.custodianSince", {
                name: asset.custodian.displayName,
                date: formatDate(asset.custodian.since, locale),
              })}
          {!asset.custodian.active && (
            <span className="block text-xs font-normal text-muted-foreground">
              {t("vehicle.details.custodianInactive")}
            </span>
          )}
        </>
      ),
    ],
    [t("vehicle.details.reportedLocation"), t("vehicle.details.reportedLocationNone")],
  ];
  if (gates.trips) {
    now.push([
      t("vehicle.details.odometer"),
      reading === null ? (
        t("vehicle.facts.noReading")
      ) : (
        <>
          <LinkButton onClick={() => panel.openRecord({ kind: "readings" })}>
            {t("vehicle.facts.readingValue", { readingType: reading.readingType, value: reading.value })}
          </LinkButton>
          <span className="block text-xs font-normal text-muted-foreground">
            {t("vehicle.details.readingMeta", {
              date: formatDateTime(reading.observedAt, locale),
              source: t(`vehicle.readings.source.${reading.source}`),
              by: reading.recordedBy.displayName ?? t("history.actor.unknown"),
            })}
          </span>
        </>
      ),
    ]);
  }
  return now;
}

function useVehicleRows(): Row[] {
  const { t, i18n } = useTranslation();
  const { asset, gates } = useVehicle();
  const locale = i18n.language;
  const notRecorded = t("vehicle.details.notRecorded");
  return [
    [t("vehicle.details.fleetCode"), asset.assetCode],
    [t("vehicle.details.plate"), asset.registrationNumber ?? notRecorded],
    [t("vehicle.details.makeModel"), makeAndModel(asset) || notRecorded],
    [t("vehicle.details.year"), asset.modelYear === null ? notRecorded : String(asset.modelYear)],
    [t("vehicle.details.class"), localizedLabel(asset.category, locale)],
    [t("vehicle.details.chassis"), <span className="break-all">{asset.chassisNumber ?? notRecorded}</span>],
    [
      t("vehicle.details.acquired"),
      asset.acquisitionDate === null
        ? notRecorded
        : // Money is shown only to those who read the books.
          gates.money && asset.acquisitionAmountMinor !== null
          ? t("vehicle.details.acquiredWithAmount", {
              date: formatDate(asset.acquisitionDate, locale),
              amount: formatMoney(asset.acquisitionAmountMinor, { currency: asset.currency, locale }),
            })
          : formatDate(asset.acquisitionDate, locale),
    ],
  ];
}

function useSpecificationRows(): Row[] {
  const { t } = useTranslation();
  const { asset } = useVehicle();
  const notRecorded = t("vehicle.details.notRecorded");
  const fields = TEMPLATE_FIELDS[asset.templateCode as TemplateCode] ?? [];
  return fields.map((field) => {
    const value = asset.customValues[field.key];
    return [
      t(`assets.form.custom.${field.key}`),
      value === undefined || value === null || value === "" ? notRecorded : String(value),
    ];
  });
}

function DetailsColumn({ title, note, rows }: { title: string; note?: string; rows: readonly Row[] }) {
  const { t } = useTranslation();
  return (
    <section className="p-4">
      <h3 className={cn("text-xs font-medium text-muted-foreground", note === undefined && "mb-2.5")}>{title}</h3>
      {note !== undefined && <p className="mt-0.5 mb-2.5 text-xs text-muted-foreground">{note}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("vehicle.details.noSpecifications")}</p>
      ) : (
        <dl className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 font-medium">{value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </section>
  );
}

const PROBLEM_KEY: Record<DetailsProblem, string> = {
  yearRange: "vehicle.details.edit.errors.yearRange",
  dateInFuture: "vehicle.details.edit.errors.dateInFuture",
  amountWhole: "vehicle.details.edit.errors.amountWhole",
  amountNeedsDate: "vehicle.details.edit.errors.amountNeedsDate",
  chassisTooLong: "vehicle.details.edit.errors.chassisTooLong",
  notANumber: "vehicle.details.edit.errors.notANumber",
  invalid: "form.errors.invalid",
};

/** The server's reasons for a refused field, answered with the card's own messages. */
const SERVER_REASON: Record<string, DetailsProblem> = {
  IN_FUTURE: "dateInFuture",
  REQUIRED_WITH_AMOUNT: "amountNeedsDate",
};

const formShape = z.object({
  registrationNumber: z.string(),
  manufacturer: z.string(),
  model: z.string(),
  modelYear: z.string(),
  chassisNumber: z.string(),
  acquisitionDate: z.string(),
  acquisitionAmount: z.string(),
  customValues: z.record(z.string(), z.string()),
});

function DetailsEditCard({
  base: asset,
  nowRows,
  onConflict,
  onClose,
}: {
  base: AssetDetail;
  nowRows: readonly Row[];
  onConflict: () => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { gates, refresh } = useVehicle();
  const locale = i18n.language;
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string>();
  // One intent per edit of one version: a retry of the same save replays.
  const intent = useRef(
    createCommandIntent<UpdateAssetDetailsPayload>(commandClient, "update-asset-details", 1),
  );
  const today = todayIso();
  const specifications = editableSpecifications(asset.templateCode);

  const problemMessage = (problem: DetailsProblem) =>
    t(PROBLEM_KEY[problem], {
      min: YEAR_BOUNDS.min,
      max: problem === "chassisTooLong" ? CHASSIS_NUMBER_MAX_LENGTH : YEAR_BOUNDS.max(),
    });

  const schema = formShape.superRefine((values, ctx) => {
    const problems = detailsProblems(values, {
      locale,
      templateCode: asset.templateCode,
      money: gates.money,
      today,
    });
    for (const { field, problem } of problems) {
      ctx.addIssue({ code: "custom", path: field.split("."), message: problemMessage(problem) });
    }
  });

  const form = useForm<DetailsFormValues>({
    resolver: zodResolver(schema),
    defaultValues: formValuesOf(asset, locale),
  });
  const hasErrors = Object.keys(form.formState.errors).length > 0;

  useEffect(() => {
    form.setFocus("registrationNumber");
  }, [form]);

  const setFieldError = (field: string, message: string) =>
    form.setError(field as DetailsFieldName, { type: "server", message });

  async function save(values: DetailsFormValues) {
    setErrorCode(undefined);
    const changes = changedDetails(values, asset, { locale, money: gates.money });
    if (changes === undefined) {
      notifyInfo("vehicle", "nothingToSave");
      onClose();
      return;
    }
    setSubmitting(true);
    const result = await intent.current.submit(
      { assetId: asset.id, ...changes },
      { expectedVersion: asset.rowVersion },
    );
    if (result.ok) {
      notifyCommandSuccess("vehicle", "detailsSaved", result.outcome.warnings);
      await refresh();
      setSubmitting(false);
      onClose();
      return;
    }
    setSubmitting(false);
    if (result.code === "VERSION_CONFLICT") {
      onConflict();
      return;
    }
    if (result.code === "DUPLICATE_REGISTRATION_NUMBER") {
      setFieldError("registrationNumber", t("errors.DUPLICATE_REGISTRATION_NUMBER"));
      return;
    }
    if (
      result.code === "TEMPLATE_FIELD_INVALID" &&
      applyTemplateFieldMetadata(result.metadata, t, setFieldError) > 0
    ) {
      return;
    }
    if (result.code === "VALIDATION_FAILED") {
      let applied = 0;
      const issues = result.metadata?.["issues"];
      for (const issue of Array.isArray(issues) ? issues : []) {
        const { path, reason } = issue as { path?: unknown; reason?: unknown };
        if (!Array.isArray(path) || path.length === 0) continue;
        const field = path[0] === "acquisitionAmountMinor" ? "acquisitionAmount" : path.join(".");
        const problem = typeof reason === "string" ? SERVER_REASON[reason] : undefined;
        setFieldError(field, problemMessage(problem ?? "invalid"));
        applied += 1;
      }
      if (applied > 0) return;
    }
    setErrorCode(result.code);
  }

  const textField = (
    name: DetailsFieldName,
    label: string,
    options: { maxLength?: number; numeric?: boolean } = {},
  ) => (
    <FormField
      key={name}
      control={form.control}
      name={name}
      render={({ field }) => (
        <EditRow label={label}>
          <FormControl>
            <Input
              {...field}
              value={typeof field.value === "string" ? field.value : ""}
              {...(options.maxLength === undefined ? {} : { maxLength: options.maxLength })}
              {...(options.numeric === true ? { inputMode: "decimal" as const } : {})}
              className={cn("h-11 md:h-9", options.numeric === true && "md:max-w-28")}
            />
          </FormControl>
        </EditRow>
      )}
    />
  );

  return (
    <Form {...form}>
      <form noValidate onSubmit={(event) => void form.handleSubmit(save)(event)}>
        <Card className="gap-0 py-0">
          {errorCode !== undefined && (
            <div className="border-b p-4">
              <ErrorBanner code={errorCode} />
            </div>
          )}
          <Columns>
            <DetailsColumn
              title={t("vehicle.details.rightNow")}
              note={t("vehicle.details.edit.ownActions")}
              rows={nowRows}
            />
            <section className="grid content-start gap-3 p-4 md:grid-cols-[minmax(7.5rem,auto)_1fr] md:gap-x-4">
              <h3 className="text-xs font-medium text-muted-foreground md:col-span-2">{t("vehicle.details.vehicle")}</h3>
              <StaticRow label={t("vehicle.details.fleetCode")} value={asset.assetCode} />
              {textField("registrationNumber", t("vehicle.details.plate"), { maxLength: 40 })}
              {textField("manufacturer", t("vehicle.details.edit.make"), { maxLength: 80 })}
              {textField("model", t("vehicle.details.edit.model"), { maxLength: 80 })}
              {textField("modelYear", t("vehicle.details.year"), { numeric: true })}
              <StaticRow label={t("vehicle.details.class")} value={localizedLabel(asset.category, locale)} />
              {textField("chassisNumber", t("vehicle.details.chassis"))}
              <FormField
                control={form.control}
                name="acquisitionDate"
                render={({ field }) => (
                  <EditRow label={t("vehicle.details.edit.acquisitionDate")}>
                    <FormControl>
                      <DatePicker
                        value={field.value}
                        onChange={field.onChange}
                        max={today}
                        clearable
                        placeholder={t("vehicle.details.notRecorded")}
                        className="md:min-h-9"
                      />
                    </FormControl>
                  </EditRow>
                )}
              />
              {gates.money && (
                <FormField
                  control={form.control}
                  name="acquisitionAmount"
                  render={({ field }) => (
                    <EditRow label={t("vehicle.details.edit.acquisitionAmount")}>
                      <FormControl>
                        <MoneyInput
                          value={field.value}
                          onValueChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                          locale={locale}
                          className="md:h-9 md:min-h-9"
                        />
                      </FormControl>
                    </EditRow>
                  )}
                />
              )}
            </section>
            <section className="grid content-start gap-3 p-4 md:grid-cols-[minmax(7.5rem,auto)_1fr] md:gap-x-4">
              <h3 className="text-xs font-medium text-muted-foreground md:col-span-2">{t("vehicle.details.specifications")}</h3>
              {specifications.length === 0 ? (
                <p className="text-sm text-muted-foreground md:col-span-2">{t("vehicle.details.noSpecifications")}</p>
              ) : (
                specifications.map((spec) =>
                  textField(
                    `customValues.${spec.key}`,
                    t(`assets.form.custom.${spec.key}`),
                    spec.type === "number" ? { numeric: true } : { maxLength: 120 },
                  ),
                )
              )}
            </section>
          </Columns>
          <div className="flex flex-col gap-3 border-t p-4 sm:flex-row sm:items-center sm:justify-end">
            {hasErrors && (
              <p role="alert" className="text-sm text-destructive sm:mr-auto">
                {t("vehicle.details.edit.errors.fixFields")}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button type="button" variant="outline" className="h-11" disabled={submitting} onClick={onClose}>
                {t("vehicle.details.edit.cancel")}
              </Button>
              <Button type="submit" className="h-11" disabled={submitting}>
                {submitting ? t("vehicle.details.edit.saving") : t("vehicle.details.edit.save")}
              </Button>
            </div>
          </div>
        </Card>
      </form>
    </Form>
  );
}

/**
 * Label beside the value on a wide screen, above it on a phone. The rows share
 * their column's label width (subgrid), so the inputs line up.
 */
function EditRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <FormItem className="gap-1.5 md:col-span-2 md:grid-cols-subgrid md:items-start">
      <FormLabel className="text-sm font-normal text-muted-foreground md:pt-2">{label}</FormLabel>
      <div className="grid min-w-0 gap-1.5">
        {children}
        <FormMessage className="text-xs" />
      </div>
    </FormItem>
  );
}

function StaticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1.5 text-sm md:col-span-2 md:grid-cols-subgrid">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
