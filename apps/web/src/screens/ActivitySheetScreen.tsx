import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { DateTimeField } from "@/components/date-field";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { legEndpoint } from "@routiq/contracts";
import { Gauge, Plus, Route as RouteIcon, Trash2, Truck } from "lucide-react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import { z } from "zod";
import { PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { PermissionDenied } from "@/components/permission-denied.js";
import { ErrorBanner } from "@/components/error-banner.js";
import { Button } from "@/components/ui/button";
import { FormPage, type FormPageSummaryRow } from "@/components/form-page.js";
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
import { useAssetOptions } from "@/assets/useAssetOptions.js";
import { useAssetRegistrationReference } from "@/reference/asset-registration.js";
import { ALL_BRANCHES } from "@/shell/branch-context.js";
import { useFollowShellBranch } from "@/shell/branch-scope.js";
import { useCategories } from "@/categories/useCategories.js";
import { formatMoney, localizedLabel } from "@/lib/format.js";
import { notifyCommandSuccess } from "@/lib/notify.js";
import { canRecordActivities, canRecordSheetRevenue } from "@/activities/permissions.js";
import { usePersons } from "@/activities/usePersons.js";
import {
  pendingChildrenCount,
  SHEET_TEMPLATE_PRESET,
  sheetTemplatesFor,
  toHaulageSheetPayload,
  toJourneySheetPayload,
  type HaulageSheetPayload,
  type JourneySheetPayload,
  type SheetIds,
  type SheetTemplate,
} from "@/activities/sheet-model.js";
import { CrewRows } from "@/activities/sheet/CrewRows.js";
import { EntryRows, type Option } from "@/activities/sheet/EntryRows.js";
import { LegRows } from "@/activities/sheet/LegRows.js";
import {
  defaultSheetValues,
  endpointText,
  isBlankEntry,
  isBlankLeg,
  isBlankSegment,
  LOAD_STATES,
  newSegmentRow,
  PAYMENT_METHODS,
  READING_TYPES,
  SEGMENT_ROLES,
  toSheetFormState,
  type SheetFormValues,
} from "@/activities/sheet/form.js";
import { parseMoneyXaf } from "@/lib/format.js";
import {
  missingInRows,
  missingRequired,
  sheetSectionStates,
  sheetTotals,
  SHEET_SECTION_FIELDS,
  SHEET_SECTIONS,
  type SheetRequiredField,
  type SheetRowGap,
  type SheetSectionId,
} from "@/activities/sheet/progress.js";

function isTemplate(value: unknown): value is SheetTemplate {
  return value === "journey" || value === "haulage";
}

export function ActivitySheetScreen() {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const me = useMeContext();
  const canRecord = canRecordActivities(me?.role, me?.enabledModules);
  const search = useSearch({ strict: false }) as { template?: unknown; assetId?: unknown };
  const templates = useMemo(
    () => sheetTemplatesFor(me?.enabledPresets),
    [me?.enabledPresets],
  );
  // A link naming a flavour this workspace does not run falls back to one it does.
  const initialTemplate: SheetTemplate =
    isTemplate(search.template) && templates.includes(search.template)
      ? search.template
      : (templates[0] ?? "journey");

  if (me !== undefined && !canRecord) {
    return (
      <PermissionDenied
        title={label("record-journey-sheet")}
        icon={<RouteIcon className="size-7" aria-hidden />}
        code="ROLE_FORBIDDEN"
      />
    );
  }

  // The form's defaults read the role (a driver's sheet opens with no revenue
  // line), so it waits for /v1/me instead of opening with a guess.
  if (me === undefined) {
    return (
      <PageContainer>
        <PageHeader title={label("record-journey-sheet")} description={t("activities.record.subtitle")} />
      </PageContainer>
    );
  }

  return (
    <SheetForm
      initialTemplate={initialTemplate}
      templates={templates}
      initialAssetId={typeof search.assetId === "string" ? search.assetId : undefined}
      canAddRevenue={canRecordSheetRevenue(me.role)}
    />
  );
}

function SheetForm({
  initialTemplate,
  templates,
  initialAssetId,
  canAddRevenue,
}: {
  initialTemplate: SheetTemplate;
  templates: SheetTemplate[];
  /** "Start a trip" on a vehicle opens the sheet with that vehicle as primary. */
  initialAssetId?: string | undefined;
  /** role-config: a driver records expenses only (#532). */
  canAddRevenue: boolean;
}) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const navigate = useNavigate();

  /**
   * §5.3: a retry must re-post the identical envelope, so every id the clerk
   * cannot type is minted once when the sheet opens and never again.
   */
  const [ids] = useState<SheetIds>(() => ({
    activityId: crypto.randomUUID(),
    primarySegmentId: crypto.randomUUID(),
    startReadingId: crypto.randomUUID(),
    endReadingId: crypto.randomUUID(),
  }));
  const journeyIntent = useRef(
    createCommandIntent<JourneySheetPayload>(commandClient, "record-journey-sheet", 1),
  );
  const haulageIntent = useRef(
    createCommandIntent<HaulageSheetPayload>(
      commandClient,
      "record-haulage-job-sheet",
      1,
    ),
  );

  const [errorCode, setErrorCode] = useState<string>();
  /** Which of the two submit affordances is running, for its own label. */
  const [closing, setClosing] = useState(false);
  const [showReadings, setShowReadings] = useState(false);
  const [showSegments, setShowSegments] = useState(initialTemplate === "haulage");

  const formSchema = useMemo(() => {
    const required = t("form.errors.required");
    const readingSchema = z.object({
      value: z.string(),
      readingType: z.enum(READING_TYPES),
    });

    return z
      .object({
        template: z.enum(["journey", "haulage"]),
        branchCode: z.string().min(1, required),
        activityTypeCode: z.string().min(1, required),
        customerName: z.string(),
        clientReference: z.string(),
        description: z.string(),
        primaryAssetId: z.string().min(1, required),
        startedAt: z.string().min(1, required),
        endedAt: z.string().min(1, required),
        startReading: readingSchema,
        endReading: readingSchema,
        extraSegments: z.array(
          z
            .object({
              segmentId: z.string(),
              assetId: z.string(),
              role: z.enum(SEGMENT_ROLES),
              startedAt: z.string(),
              endedAt: z.string(),
            })
            .superRefine((row, ctx) => {
              if (isBlankSegment(row) && row.startedAt === "" && row.endedAt === "") {
                return;
              }
              if (row.assetId === "") {
                ctx.addIssue({ code: "custom", path: ["assetId"], message: required });
              }
            }),
        ),
        crew: z.array(
          z.object({
            activityPersonId: z.string(),
            personId: z.string(),
            role: z.enum([
              "DRIVER",
              "CONDUCTOR",
              "ASSISTANT",
              "RELIEF",
              "MECHANIC",
              "OTHER",
            ]),
          }),
        ),
        legs: z.array(
          z
            .object({
              legId: z.string(),
              origin: legEndpoint.optional(),
              destination: legEndpoint.optional(),
              departedAt: z.string(),
              arrivedAt: z.string(),
              distanceKm: z.string(),
              passengerCount: z.string(),
              loadState: z.enum([...LOAD_STATES, ""]),
            })
            .superRefine((row, ctx) => {
              // An untouched row is dropped at submit; a half-filled one is a
              // trip the sheet described and the payload would lose.
              if (isBlankLeg(row)) return;
              if (endpointText(row.origin).trim() === "") {
                ctx.addIssue({
                  code: "custom",
                  path: ["origin"],
                  message: t("activities.record.legs.endpointRequired"),
                });
              }
              if (endpointText(row.destination).trim() === "") {
                ctx.addIssue({
                  code: "custom",
                  path: ["destination"],
                  message: t("activities.record.legs.endpointRequired"),
                });
              }
            }),
        ),
        entries: z.array(
          z
            .object({
              entryId: z.string(),
              direction: z.enum(["REVENUE", "EXPENSE"]),
              categoryCode: z.string(),
              amount: z.string(),
              paymentMethod: z.enum(PAYMENT_METHODS),
              counterpartyName: z.string(),
              description: z.string(),
              reference: z.string(),
              assetId: z.string(),
              personId: z.string(),
              attributeToActivity: z.boolean(),
            })
            .superRefine((row, ctx) => {
              if (isBlankEntry(row)) return;
              if (row.categoryCode === "") {
                ctx.addIssue({
                  code: "custom",
                  path: ["categoryCode"],
                  message: required,
                });
              }
              const amount = parseMoneyXaf(row.amount);
              if (amount === null || amount <= 0) {
                ctx.addIssue({
                  code: "custom",
                  path: ["amount"],
                  message: t("activities.record.entries.amountRequired"),
                });
              }
            }),
        ),
        seatsSold: z.string(),
        seatsAvailable: z.string(),
        cargoDescription: z.string(),
        cargoWeightKg: z.string(),
      })
      .superRefine((values, ctx) => {
        // `datetime-local` strings share one format, so they order as text.
        if (
          values.startedAt !== "" &&
          values.endedAt !== "" &&
          values.endedAt < values.startedAt
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["endedAt"],
            message: t("activities.record.endBeforeStart"),
          });
        }
      });
  }, [t]);

  const [defaultValues] = useState(() => ({
    ...defaultSheetValues(initialTemplate, { revenue: canAddRevenue }),
    ...(initialAssetId === undefined ? {} : { primaryAssetId: initialAssetId }),
  }));
  const form = useForm<SheetFormValues>({
    resolver: zodResolver(formSchema),
    // A sheet is long; validating every field on every keystroke is what makes
    // the form stutter on a low-end phone. Errors appear on submit and clear as
    // the clerk fixes them.
    mode: "onSubmit",
    reValidateMode: "onChange",
    defaultValues,
  });
  const { control, setValue, getValues } = form;

  const template = useWatch({ control, name: "template" });
  const branchCode = useWatch({ control, name: "branchCode" });
  const crew = useWatch({ control, name: "crew" });

  const reference = useAssetRegistrationReference();
  const branches = useMemo(() => reference.data?.branches ?? [], [reference.data]);
  const activityTypes = useCategories("ACTIVITY_TYPE");
  // Every asset in scope. Unlike the crew rows below, the vehicle picker does
  // not follow the sheet's branch: a truck lent from another agency is exactly
  // the trip worth recording, and the ambient branch narrows lists, not what a
  // command may reference.
  const assetOptions = useAssetOptions(ALL_BRANCHES);
  // The sheet's own branch, not the shell's: changing the branch field changes
  // whose people the crew rows offer.
  const sheetBranchId = branches.find((branch) => branch.code === branchCode)?.id;
  const personsQuery = usePersons({
    active: true,
    ...(sheetBranchId === undefined ? {} : { branchId: sheetBranchId }),
  });

  useFollowShellBranch(branches, branchCode, (code) => setValue("branchCode", code));

  const personOptions = useMemo<Option[]>(() => {
    const persons = personsQuery.data?.items ?? [];
    const seen = new Set<string>();
    const options: Option[] = [];
    for (const row of crew ?? []) {
      if (row.personId === "" || seen.has(row.personId)) continue;
      seen.add(row.personId);
      const person = persons.find((candidate) => candidate.id === row.personId);
      options.push({
        value: row.personId,
        label: person?.displayName ?? t(`activities.crewRoles.${row.role}`),
      });
    }
    return options;
  }, [crew, personsQuery.data, t]);

  const segments = useFieldArray({ control, name: "extraSegments" });
  const removeSegment = useCallback(
    (index: number) => segments.remove(index),
    [segments],
  );

  function switchTemplate(next: SheetTemplate) {
    if (next === getValues("template")) return;
    setValue("template", next, { shouldDirty: true });

    // Everything the paper sheet shares survives the flip; only what belongs to
    // the other flavour is dropped, so a mis-tap costs nothing already typed.
    const legs = getValues("legs");
    if (next === "journey") {
      setValue("cargoDescription", "");
      setValue("cargoWeightKg", "");
      legs.forEach((_, index) => setValue(`legs.${index}.loadState`, ""));
    } else {
      setValue("seatsSold", "");
      setValue("seatsAvailable", "");
      legs.forEach((_, index) => setValue(`legs.${index}.passengerCount`, ""));
      if (getValues("extraSegments").length === 0) segments.append(newSegmentRow());
    }
    setShowSegments(next === "haulage");
  }

  /**
   * `/v1/me` may answer after the form mounts, so the flavour chosen without it
   * can turn out to be one this workspace does not run. Correcting it here
   * rather than at mount keeps the single-preset case honest whichever order
   * the two resolve in.
   */
  const soleTemplate = templates.length === 1 ? templates[0] : undefined;
  useEffect(() => {
    if (soleTemplate !== undefined) switchTemplate(soleTemplate);
    // switchTemplate is a no-op when the value already matches, so re-running
    // it on an unrelated render cannot clobber what the clerk has typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soleTemplate]);

  async function onSubmit(values: SheetFormValues, close: boolean) {
    setErrorCode(undefined);
    const state = toSheetFormState(values);

    const result =
      values.template === "journey"
        ? await journeyIntent.current.submit(toJourneySheetPayload(state, ids, { close }))
        : await haulageIntent.current.submit(toHaulageSheetPayload(state, ids, { close }));

    if (!result.ok) {
      setErrorCode(result.code);
      return;
    }

    // The composite command commits whatever the approval rules allow, so the
    // confirmation names what is still waiting instead of implying it all posted.
    const pending = pendingChildrenCount(result.outcome);
    notifyCommandSuccess(
      "activities",
      close ? "sheetRecordedAndClosed" : "sheetRecorded",
      result.outcome.warnings,
      pending > 0
        ? { extraLines: [t("activities.notify.pendingEntries", { count: pending })] }
        : {},
    );
    void navigate({
      to: "/activities/$activityId",
      params: { activityId: ids.activityId },
    });
  }

  /**
   * Recording and closing are two acts, so they are two buttons. The default —
   * and what Enter does — is to record and leave the trip open.
   */
  function submitSheet(close: boolean) {
    setClosing(close);
    return form.handleSubmit((values) => onSubmit(values, close));
  }

  const lead =
    // One preset means one kind of sheet: asking which would be asking a
    // question with a single answer (ADR-0004).
    templates.length > 1 ? (
      <FormField
        control={control}
        name="template"
        render={({ field }) => (
          <FormItem>
            <Tabs
              value={field.value}
              onValueChange={(value) => {
                if (isTemplate(value)) switchTemplate(value);
              }}
            >
              <TabsList
                className="w-full"
                aria-label={t("activities.record.templateLegend")}
              >
                {templates.map((template) => (
                  <TabsTrigger key={template} value={template}>
                    {t(`assets.form.templates.${SHEET_TEMPLATE_PRESET[template]}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </FormItem>
        )}
      />
    ) : undefined;

  const content: Record<SheetSectionId, ReactNode> = {
    references: (
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={control}
          name="branchCode"
          render={({ field }) => (
            <FormItem data-field="branchCode">
              <FormLabel>{t("activities.record.branchLabel")}</FormLabel>
              {reference.isError && (
                <FormDescription role="alert" className="text-destructive">
                  {t("activities.record.branchesFailed")}
                </FormDescription>
              )}
              <Select
                value={field.value || null}
                onValueChange={(value) => field.onChange(value ?? "")}
                disabled={reference.isPending || reference.isError}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("activities.record.chooseBranch")} />
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
          control={control}
          name="activityTypeCode"
          render={({ field }) => (
            <FormItem data-field="activityTypeCode">
              <FormLabel>{t("activities.record.activityTypeLabel")}</FormLabel>
              {activityTypes.isError && (
                <FormDescription role="alert" className="text-destructive">
                  {t("activities.record.activityTypesFailed")}
                </FormDescription>
              )}
              <Select
                value={field.value || null}
                onValueChange={(value) => field.onChange(value ?? "")}
                disabled={activityTypes.isPending || activityTypes.isError}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={t("activities.record.chooseActivityType")}
                    />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {(activityTypes.data ?? []).map((category) => (
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
          name="customerName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("activities.record.customerLabel")}</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  placeholder={t("activities.record.customerPlaceholder")}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="clientReference"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("activities.record.clientReferenceLabel")}</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  placeholder={t("activities.record.clientReferencePlaceholder")}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="description"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>{t("activities.record.descriptionLabel")}</FormLabel>
              <FormControl>
                <Textarea
                  className="min-h-20"
                  placeholder={t("activities.record.descriptionPlaceholder")}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    ),
    vehicle: (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            control={control}
            name="primaryAssetId"
            render={({ field }) => (
              <FormItem data-field="primaryAssetId">
                <FormLabel>{t("activities.record.primaryAssetLabel")}</FormLabel>
                <Select
                  value={field.value || null}
                  onValueChange={(value) => field.onChange(value ?? "")}
                  disabled={assetOptions.length === 0}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("activities.record.chooseAsset")} />
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
            name="startedAt"
            render={({ field }) => (
              <FormItem data-field="startedAt">
                <FormLabel>{t("activities.record.startedAtLabel")}</FormLabel>
                <FormControl>
                  <DateTimeField {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="endedAt"
            render={({ field }) => (
              <FormItem data-field="endedAt">
                <FormLabel>{t("activities.record.endedAtLabel")}</FormLabel>
                <FormControl>
                  <DateTimeField {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {showReadings ? (
          <div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t("activities.record.readings.legend")}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="desktop-sm"
                onClick={() => setShowReadings(false)}
              >
                {t("activities.record.readings.hide")}
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ReadingField control={control} which="startReading" />
              <ReadingField control={control} which="endReading" />
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => setShowReadings(true)}
          >
            <Gauge className="size-4" aria-hidden />
            {t("activities.record.readings.add")}
          </Button>
        )}

        {showSegments ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {template === "haulage"
                  ? t("activities.record.segments.trailerLegend")
                  : t("activities.record.segments.legend")}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="desktop-sm"
                onClick={() => setShowSegments(false)}
              >
                {t("activities.record.segments.hide")}
              </Button>
            </div>

            {segments.fields.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("activities.record.segments.empty")}
              </p>
            )}

            {segments.fields.map((field, index) => (
              <SegmentRow
                key={field.id}
                control={control}
                index={index}
                assetOptions={assetOptions}
                onRemove={removeSegment}
              />
            ))}

            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => segments.append(newSegmentRow())}
            >
              <Plus className="size-4" aria-hidden />
              {t("activities.record.segments.add")}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => {
              setShowSegments(true);
              if (segments.fields.length === 0) segments.append(newSegmentRow());
            }}
          >
            <Truck className="size-4" aria-hidden />
            {t("activities.record.segments.add")}
          </Button>
        )}
      </div>
    ),
    crew: <CrewRows control={control} branchCode={branchCode} branchId={sheetBranchId} />,
    legs: <LegRows control={control} template={template} />,
    flavour: (
      <div className="grid gap-4 sm:grid-cols-2">
        {template === "journey" ? (
          <>
            <FormField
              control={control}
              name="seatsSold"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("activities.record.journey.seatsSoldLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder={t("activities.record.journey.seatsPlaceholder")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name="seatsAvailable"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("activities.record.journey.seatsAvailableLabel")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder={t("activities.record.journey.seatsPlaceholder")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        ) : (
          <>
            <FormField
              control={control}
              name="cargoDescription"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("activities.record.haulage.cargoDescriptionLabel")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder={t(
                        "activities.record.haulage.cargoDescriptionPlaceholder",
                      )}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name="cargoWeightKg"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("activities.record.haulage.cargoWeightLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder={t("activities.record.haulage.cargoWeightPlaceholder")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}
      </div>
    ),
    money: (
      <EntryRows
        control={control}
        assetOptions={assetOptions}
        personOptions={personOptions}
        canAddRevenue={canAddRevenue}
      />
    ),
  };

  const titles: Record<SheetSectionId, string> = {
    references: t("activities.record.sections.references"),
    vehicle: t("activities.record.sections.vehicle"),
    crew: t("activities.record.sections.crew"),
    legs: t("activities.record.sections.legs"),
    flavour:
      template === "journey"
        ? t("activities.record.sections.flavourJourney")
        : t("activities.record.sections.flavourHaulage"),
    money: t(canAddRevenue ? "activities.record.sections.money" : "activities.record.sections.moneyCosts"),
  };

  const submitting = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <SheetPage
        control={control}
        getValues={getValues}
        canAddRevenue={canAddRevenue}
        assetOptions={assetOptions}
        titles={titles}
        content={content}
        lead={lead}
        banner={errorCode ? <ErrorBanner code={errorCode} /> : undefined}
        onSubmit={(event) => void submitSheet(false)(event)}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => void submitSheet(true)()}
            >
              {label(
                { command: "record-journey-sheet", intent: "close" },
                submitting && closing ? "submitting" : "submit",
              )}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && !closing
                ? label("record-journey-sheet", "submitting")
                : label("record-journey-sheet", "submit")}
            </Button>
          </>
        }
      />
    </Form>
  );
}

/**
 * The frame around the sheet: watches every field so "So far", the section
 * states and the footer's count follow the clerk's typing. The sections'
 * fields come in as elements made by `SheetForm`, so a keystroke re-renders
 * this summary, not the fields.
 */
function SheetPage({
  control,
  getValues,
  canAddRevenue,
  assetOptions,
  titles,
  content,
  lead,
  banner,
  onSubmit,
  actions,
}: {
  control: ReturnType<typeof useForm<SheetFormValues>>["control"];
  getValues: ReturnType<typeof useForm<SheetFormValues>>["getValues"];
  canAddRevenue: boolean;
  assetOptions: readonly Option[];
  titles: Record<SheetSectionId, string>;
  content: Record<SheetSectionId, ReactNode>;
  lead: ReactNode;
  banner: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  actions: ReactNode;
}) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  useWatch({ control });
  const values = getValues();

  const states = sheetSectionStates(values);
  const sections = SHEET_SECTIONS.map((id) => ({
    id,
    title: titles[id],
    state: states[id],
    fields: SHEET_SECTION_FIELDS[id],
    children: content[id],
  }));

  const requiredLabel: Record<SheetRequiredField, string> = {
    branchCode: t("activities.record.branchLabel"),
    activityTypeCode: t("activities.record.activityTypeLabel"),
    primaryAssetId: t("activities.record.primaryAssetLabel"),
    startedAt: t("activities.record.startedAtLabel"),
    endedAt: t("activities.record.endedAtLabel"),
  };
  const gapLabel: Record<SheetRowGap["kind"], string> = {
    origin: "activities.record.legs.rowOrigin",
    destination: "activities.record.legs.rowDestination",
    category: "activities.record.entries.rowCategory",
    amount: "activities.record.entries.rowAmount",
  };
  const missing = [
    ...missingRequired(values).map((field) => ({ field, label: requiredLabel[field] })),
    ...missingInRows(values).map((gap) => ({
      field: gap.field,
      label: t(gapLabel[gap.kind], { position: gap.position }),
    })),
  ];

  const totals = sheetTotals(values);
  const summary: FormPageSummaryRow[] = [
    {
      label: t("activities.record.soFar.asset"),
      value: assetOptions.find((option) => option.value === values.primaryAssetId)?.label,
      field: "primaryAssetId",
    },
    {
      label: t("activities.record.soFar.route"),
      value:
        totals.from !== undefined && totals.to !== undefined
          ? t("activities.record.soFar.routeValue", { from: totals.from, to: totals.to })
          : undefined,
      field: "legs",
    },
    {
      label: t("activities.record.soFar.distance"),
      value:
        totals.distanceKm === undefined
          ? undefined
          : t("activities.record.soFar.distanceValue", { km: totals.distanceKm }),
      field: "legs",
    },
  ];
  // role-config: a driver records expenses only and sees no trip profit (#532).
  if (canAddRevenue) {
    summary.push({
      label: t("activities.record.soFar.revenue"),
      value: totals.revenue === undefined ? undefined : formatMoney(totals.revenue),
      field: "entries",
    });
  }
  summary.push({
    label: t("activities.record.soFar.expenses"),
    value: totals.expenses === undefined ? undefined : formatMoney(totals.expenses),
    field: "entries",
  });
  if (canAddRevenue) {
    // Profit needs revenue; with none recorded it is not a loss, it is unknown.
    const profit = totals.revenue === undefined ? undefined : totals.revenue - (totals.expenses ?? 0);
    summary.push({
      label: t(profit !== undefined && profit < 0 ? "activities.record.soFar.loss" : "activities.record.soFar.profit"),
      value: profit === undefined ? undefined : formatMoney(Math.abs(profit)),
      total: true,
    });
  }

  return (
    <FormPage
      title={label("record-journey-sheet")}
      description={t("activities.record.subtitle")}
      onSubmit={onSubmit}
      lead={lead}
      banner={banner}
      sections={sections}
      summary={summary}
      missing={missing}
      actions={actions}
    />
  );
}

function ReadingField({
  control,
  which,
}: {
  control: ReturnType<typeof useForm<SheetFormValues>>["control"];
  which: "startReading" | "endReading";
}) {
  const { t } = useTranslation();

  return (
    <div className="flex gap-2">
      <FormField
        control={control}
        name={`${which}.value`}
        render={({ field }) => (
          <FormItem className="flex-1">
            <FormLabel className="text-xs text-muted-foreground">
              {t(`activities.record.readings.${which}Label`)}
            </FormLabel>
            <FormControl>
              <Input
                type="text"
                inputMode="numeric"
                placeholder={t("activities.record.readings.valuePlaceholder")}
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name={`${which}.readingType`}
        render={({ field }) => (
          <FormItem className="w-36">
            <FormLabel className="text-xs text-muted-foreground">
              {t("activities.record.readings.typeLabel")}
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
                  aria-label={t(`activities.record.readings.${which}Type`)}
                >
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {READING_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`activities.record.readings.types.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function SegmentRow({
  control,
  index,
  assetOptions,
  onRemove,
}: {
  control: ReturnType<typeof useForm<SheetFormValues>>["control"];
  index: number;
  assetOptions: readonly Option[];
  onRemove: (index: number) => void;
}) {
  const { t } = useTranslation();
  const position = index + 1;

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          control={control}
          name={`extraSegments.${index}.assetId`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                {t("activities.record.segments.assetLabel")}
              </FormLabel>
              <Select
                value={field.value || null}
                onValueChange={(value) => field.onChange(value ?? "")}
                disabled={assetOptions.length === 0}
              >
                <FormControl>
                  <SelectTrigger
                    className="w-full"
                    aria-label={t("activities.record.segments.rowAsset", { position })}
                  >
                    <SelectValue placeholder={t("activities.record.chooseAsset")} />
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
          name={`extraSegments.${index}.role`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                {t("activities.record.segments.roleLabel")}
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
                    aria-label={t("activities.record.segments.rowRole", { position })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {SEGMENT_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {t(`activities.roles.${role}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          control={control}
          name={`extraSegments.${index}.startedAt`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                {t("activities.record.segments.startedAtLabel")}
              </FormLabel>
              <FormControl>
                <DateTimeField
                  aria-label={t("activities.record.segments.rowStartedAt", { position })}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name={`extraSegments.${index}.endedAt`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                {t("activities.record.segments.endedAtLabel")}
              </FormLabel>
              <FormControl>
                <DateTimeField
                  aria-label={t("activities.record.segments.rowEndedAt", { position })}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <Button
        type="button"
        variant="ghost"
        size="desktop-sm"
        className="self-start text-muted-foreground"
        onClick={() => onRemove(index)}
      >
        <Trash2 className="size-4" aria-hidden />
        {t("activities.record.segments.remove", { position })}
      </Button>
    </div>
  );
}
