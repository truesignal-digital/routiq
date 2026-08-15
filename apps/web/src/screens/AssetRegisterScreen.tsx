import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  registerAssetPayload,
  templateFieldIssues,
  TEMPLATE_CODES,
  TEMPLATE_FIELDS,
} from "@routiq/contracts";
import type { z } from "zod";
import { useForm, type ControllerRenderProps, type FieldPath } from "react-hook-form";
import { localizedLabel } from "@/lib/format";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAssetRegistrationReference } from "@/assets/reference";
import { useCurrentBranchCode } from "@/shell/branch-context.js";
import { useCreatedElsewhereNotice } from "@/shell/branch-scope.js";
import { useActiveSession } from "@/auth/store";
import { useMeContext } from "@/auth/me.js";
import { applyTemplateFieldMetadata, applyValidationMetadata } from "@/commands/field-errors";
import { commandClient, commandStatusStore } from "@/commands/instance";
import { createCommandIntent } from "@/commands/intent";
import { FileUpload } from "@/components/ui/file-upload";
import { notifyCommandSuccess } from "@/lib/notify.js";
import { formatXAF } from "@routiq/domain";
import { ErrorBanner } from "@/components/error-banner.js";

type FormInput = z.input<typeof registerAssetPayload>;
type FormOutput = z.output<typeof registerAssetPayload>;

const CAPACITY_UNITS = ["KG", "TONNE", "M3", "SEAT"] as const;

export function AssetRegisterScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useActiveSession();
  const reference = useAssetRegistrationReference();

  const [assetId] = useState(() => crypto.randomUUID());
  const intentRef = useRef(createCommandIntent<FormOutput>(commandClient, "register-asset", 1));
  const [activeCommandId, setActiveCommandId] = useState<string>();
  const [artifactIds, setArtifactIds] = useState<string[]>([]);
  const [errorCode, setErrorCode] = useState<string>();
  const me = useMeContext();

  const statuses = useSyncExternalStore(
    (onChange) => commandStatusStore.subscribe(onChange),
    () => commandStatusStore.getSnapshot(),
  );
  const submitting =
    activeCommandId !== undefined && statuses.get(activeCommandId)?.state === "submitting";

  const formSchema = useMemo(
    () =>
      registerAssetPayload.superRefine((data, ctx) => {
        for (const issue of templateFieldIssues(data.templateCode, data.customValues)) {
          ctx.addIssue({
            code: "custom",
            path: ["customValues", issue.key],
            message: t(`assets.form.fieldErrors.${issue.kind}`),
          });
        }
      }),
    [t],
  );

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      assetId,
      assetCode: "",
      assetClassCode: "",
      templateCode: "TRUCKING",
      branchCode: "",
      customValues: {},
    },
  });
  const templateCode = form.watch("templateCode");
  const acquisitionAmount = form.watch("acquisitionAmountMinor");
  const branchCode = form.watch("branchCode");

  // The shell's current agency, or the only branch in scope — still editable,
  // and the server authorizes the branch either way.
  const branches = reference.data?.branches ?? [];
  const currentBranchCode = useCurrentBranchCode();
  const preselectedBranchCode =
    currentBranchCode ?? (branches.length === 1 ? branches[0]?.code : undefined);
  // Followed, not latched. Filling a blank field is the preselect; re-filling
  // it when the shell's agency *moves* is the part that matters — an operator
  // who sets this once and keeps registering would otherwise go on filing into
  // the agency the shell has since left. Between moves the effect only repairs
  // a blank, so an explicit pick here stands.
  const lastPreselectedBranchCode = useRef<string>(undefined);
  useEffect(() => {
    if (preselectedBranchCode === undefined) return;
    const shellMoved = preselectedBranchCode !== lastPreselectedBranchCode.current;
    lastPreselectedBranchCode.current = preselectedBranchCode;
    if (shellMoved || branchCode === "") {
      form.setValue("branchCode", preselectedBranchCode);
    }
  }, [preselectedBranchCode, branchCode, form]);
  // The assets list this navigates to is narrowed by the shell, so an asset
  // registered into another agency would land off screen unannounced.
  const createdElsewhereNotice = useCreatedElsewhereNotice();

  /**
   * ADR-0004: a workspace runs the presets it enabled. Undefined means /v1/me
   * has not answered, in which case offering all of them matches today's
   * behaviour and the server stays the enforcement point.
   */
  const enabledPresets = me?.enabledPresets;
  const templateChoices = enabledPresets ?? [...TEMPLATE_CODES];
  useEffect(() => {
    // Also corrects the default when /v1/me lands after the form mounts.
    const [sole] = templateChoices;
    if (sole !== undefined && !templateChoices.includes(templateCode)) {
      form.setValue("templateCode", sole);
    }
  }, [templateChoices, templateCode, form]);
  const templateFields = useMemo(() => TEMPLATE_FIELDS[templateCode] ?? [], [templateCode]);

  async function onSubmit(values: FormOutput) {
    setErrorCode(undefined);
    const options = artifactIds.length > 0 ? { sourceArtifactIds: artifactIds } : {};
    setActiveCommandId(intentRef.current.current(values, options).envelope.commandId);
    const result = await intentRef.current.submit(values, options);
    if (!result.ok) {
      const setFieldError = (field: string, message: string) =>
        form.setError(field as Parameters<typeof form.setError>[0], { type: "server", message });
      if (result.code === "TEMPLATE_FIELD_INVALID") {
        applyTemplateFieldMetadata(result.metadata, t, setFieldError);
      } else if (result.code === "VALIDATION_FAILED") {
        applyValidationMetadata(result.metadata, t, setFieldError);
      } else if (result.code === "DUPLICATE_ASSET_CODE") {
        setFieldError("assetCode", t("errors.DUPLICATE_ASSET_CODE"));
      }
      setErrorCode(result.code);
      return;
    }
    notifyCommandSuccess(
      "assets",
      "registered",
      result.outcome.warnings,
      createdElsewhereNotice({ branchCode: values.branchCode }) ?? {},
    );
    await queryClient.invalidateQueries({
      queryKey: ["ws", session?.workspaceSlug, "assets"],
    });
    void navigate({ to: "/assets" });
  }

  const labelFor = (item: { labelFr: string; labelEn: string }) =>
    localizedLabel(item);

  return (
    <PageContainer width="narrow">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {t("assets.form.eyebrow")}
      </p>
      <PageHeader className="mt-1" title={t("assets.form.title")} />

      <Form {...form}>
        <form
          className="mt-6 flex flex-col gap-5"
          onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
        >
          <FormField
            control={form.control}
            name="assetCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("assets.form.assetCode")}</FormLabel>
                <FormControl>
                  <Input className="min-h-11" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="assetClassCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.assetClass")}</FormLabel>
                  <FormControl>
                    <Select value={field.value || null} onValueChange={(value) => field.onChange(value ?? "")}>
                      <SelectTrigger className="min-h-11 w-full">
                        <SelectValue placeholder={t("assets.form.choose")} />
                      </SelectTrigger>
                      <SelectContent>
                        {reference.data?.assetClasses.map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {labelFor(c)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="branchCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.branch")}</FormLabel>
                  <FormControl>
                    <Select value={field.value || null} onValueChange={(value) => field.onChange(value ?? "")}>
                      <SelectTrigger className="min-h-11 w-full">
                        <SelectValue placeholder={t("assets.form.choose")} />
                      </SelectTrigger>
                      <SelectContent>
                        {reference.data?.branches.map((b) => (
                          <SelectItem key={b.code} value={b.code}>
                            {b.name} ({b.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* A single-preset workspace has nothing to choose: the effect above
              keeps the field on the one preset it runs (ADR-0004). */}
          {templateChoices.length > 1 && (
            <FormField
              control={form.control}
              name="templateCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.template")}</FormLabel>
                  <FormControl>
                    <Select value={field.value || null} onValueChange={(value) => field.onChange(value ?? "")}>
                      <SelectTrigger className="min-h-11 w-full">
                        <SelectValue placeholder={t("assets.form.choose")} />
                      </SelectTrigger>
                      <SelectContent>
                        {templateChoices.map((code) => (
                          <SelectItem key={code} value={code}>
                            {t(`assets.form.templates.${code}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}


          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="registrationNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.registrationNumber")}</FormLabel>
                  <FormControl>
                    <Input
                      className="min-h-11"
                      {...textFieldProps(field)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="modelYear"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.modelYear")}</FormLabel>
                  <FormControl>
                    <Input
                      className="min-h-11"
                      type="number"
                      inputMode="numeric"
                      {...numberFieldProps(field)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="manufacturer"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.manufacturer")}</FormLabel>
                  <FormControl>
                    <Input className="min-h-11" {...textFieldProps(field)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="model"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.model")}</FormLabel>
                  <FormControl>
                    <Input className="min-h-11" {...textFieldProps(field)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="chassisNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.chassisNumber")}</FormLabel>
                  <FormControl>
                    <Input className="min-h-11" {...textFieldProps(field)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="acquisitionDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.acquisitionDate")}</FormLabel>
                  <FormControl>
                    <Input
                      className="min-h-11"
                      type="date"
                      {...textFieldProps(field)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="acquisitionAmountMinor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.acquisitionAmount")}</FormLabel>
                  <FormControl>
                    <Input
                      className="min-h-11"
                      type="number"
                      inputMode="numeric"
                      step="1"
                      {...numberFieldProps(field)}
                    />
                  </FormControl>
                  {typeof acquisitionAmount === "number" && Number.isFinite(acquisitionAmount) ? (
                    <FormDescription>{formatXAF(acquisitionAmount)}</FormDescription>
                  ) : undefined}
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="capacityValue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.capacityValue")}</FormLabel>
                  <FormControl>
                    <Input
                      className="min-h-11"
                      type="number"
                      inputMode="decimal"
                      {...numberFieldProps(field)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="capacityUnit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("assets.form.capacityUnit")}</FormLabel>
                  <FormControl>
                    <Select value={field.value || null} onValueChange={(value) => field.onChange(value ?? "")}>
                      <SelectTrigger className="min-h-11 w-full">
                        <SelectValue placeholder={t("assets.form.choose")} />
                      </SelectTrigger>
                      <SelectContent>
                        {CAPACITY_UNITS.map((unit) => (
                          <SelectItem key={unit} value={unit}>
                            {t(`assets.form.units.${unit}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {templateFields.length > 0 && (
            <fieldset className="rounded-xl border border-border p-4">
              <legend className="px-1 text-sm font-medium">
                {t("assets.form.templateFields")}
              </legend>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {templateFields.map((templateField) => (
                  <FormField
                    key={templateField.key}
                    control={form.control}
                    name={`customValues.${templateField.key}`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t(`assets.form.custom.${templateField.key}`)}
                          {templateField.required === true ? " *" : ""}
                        </FormLabel>
                        <FormControl>
                          <Input
                            className="min-h-11"
                            type={templateField.type === "number" ? "number" : "text"}
                            inputMode={templateField.type === "number" ? "decimal" : undefined}
                            {...(templateField.type === "number"
                              ? numberFieldProps(field)
                              : textFieldProps(field))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
            </fieldset>
          )}

          <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t("finance.record.evidenceLabel")}</span>
          <FileUpload onChange={setArtifactIds} accept="image/jpeg,image/png,image/webp,application/pdf" />
        </div>

          {errorCode !== undefined && (
            <ErrorBanner code={errorCode} />
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" className="min-h-11 flex-1" disabled={submitting}>
              {submitting ? t("assets.form.submitting") : t("assets.form.submit")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => void navigate({ to: "/assets" })}
            >
              {t("assets.form.cancel")}
            </Button>
          </div>
        </form>
      </Form>
    </PageContainer>
  );
}

function emptyToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

function emptyToNumber(value: unknown): unknown {
  if (value === "" || value === undefined || value === null) return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? value : n;
}

// The payload schema wants `undefined` (not "") for unset optionals and real
// numbers for numeric fields, so the controller stores the coerced value while
// the control keeps rendering the raw text.
type OptionalField<TName extends FieldPath<FormInput>> = ControllerRenderProps<
  FormInput,
  TName
>;

function toControlValue(value: unknown): string | number {
  return typeof value === "string" || typeof value === "number" ? value : "";
}

function textFieldProps<TName extends FieldPath<FormInput>>(
  field: OptionalField<TName>,
) {
  return {
    name: field.name,
    ref: field.ref,
    onBlur: field.onBlur,
    value: toControlValue(field.value),
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      field.onChange(emptyToUndefined(event.target.value)),
  };
}

function numberFieldProps<TName extends FieldPath<FormInput>>(
  field: OptionalField<TName>,
) {
  return {
    name: field.name,
    ref: field.ref,
    onBlur: field.onBlur,
    value: toControlValue(field.value),
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      field.onChange(emptyToNumber(event.target.value)),
  };
}
